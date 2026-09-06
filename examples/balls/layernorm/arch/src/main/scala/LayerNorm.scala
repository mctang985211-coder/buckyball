package examples.balls.layernorm

import chisel3._
import chisel3.experimental.hierarchy.{instantiable, public}
import chisel3.util._
import hardfloat.{fNFromRecFN, recFNFromFN, AddRecFN, MulRecFN}
import hardfloat.consts.round_near_even

import framework.balldomain.blink.{BallStatus, BankRead, BankWrite}
import framework.balldomain.rs.{BallRsComplete, BallRsIssue}
import framework.top.GlobalConfig

/**
 * LayerNorm compute unit: row-wise fp32 layer normalization of a dense
 * R x C block held in SRAM banks (torch semantics, eps = 1e-12, biased
 * variance):
 *   mu    = sum(row) / C
 *   var   = sum((x - mu)^2) / C
 *   rstd  = 1 / sqrt(var + eps)
 *   y     = (x - mu) * rstd * gamma + beta
 *
 * Region geometry (16B bank lines, 4 f32 lanes per line):
 *   - x/out regions: row r occupies flat lines [r*C/4, (r+1)*C/4); flat
 *     line L lives in bank group L / 64 at line offset L % 64.
 *   - param region: gamma at flat lines [0, C/4), beta at [C/4, C/2).
 * C in {4, 64, 256, 512}; every C is a multiple of 4 lanes, so rows and
 * the gamma/beta boundary are 16B aligned.
 *
 * Datapath: hardfloat fp32 add/mul primitives (combinational), one element
 * per cycle per accumulator.  Rows are processed in three passes (mean,
 * variance, normalize) with x re-read from the banks per pass; the row
 * statistic latches (mu, rstd) are taken one cycle after the last
 * accumulator update of the pass.  Numeric precision of this datapath is
 * validated in the phase: rtl round; this file fixes the interface, the
 * fail-hard issue checks and the bank/FSM structure.
 */
@instantiable
class LayerNorm(val b: GlobalConfig) extends Module {
  private val bankIdBits = log2Up(b.memDomain.bankNum)                   // logical bank id / group
  private val addrBits   = log2Up(b.memDomain.bankEntries)               // line offset within group
  private val rowsMax    = b.memDomain.bankNum * b.memDomain.bankEntries // flat lines
  private val rowsBits   = log2Up(rowsMax + 1)
  private val lineBits   = log2Up(b.memDomain.bankEntries * 2 + 1)       // C/4 <= 2*bankEntries
  private val colsBits   = 10                                            // cols <= 512
  private val recW       = 33                                            // recoded fp32 width (expWidth + sigWidth + 1)
  private val lanes      = b.memDomain.bankWidth / 32                    // 4 f32 lanes per line

  private val mapping = b.ballDomain.ballIdMappings
    .find(_.ballName == "LayerNormBall")
    .getOrElse(throw new IllegalArgumentException("LayerNormBall not found in config"))

  private val funct = b.ballDomain.ballISA
    .find(_.mnemonic == "LAYERNORM")
    .map(_.funct7)
    .getOrElse(throw new IllegalArgumentException("LAYERNORM not found in ballISA"))

  require(mapping.inBW == 2, "LayerNormBall requires two SRAM read ports")
  require(mapping.outBW == 1, "LayerNormBall requires one SRAM write port")
  require(b.memDomain.bankWidth == 128, "LayerNormBall requires 128-bit SRAM rows")
  require(b.memDomain.bankMaskLen == 16, "LayerNormBall requires sixteen byte enables")
  require(isPow2(b.memDomain.bankEntries), "LayerNormBall requires power-of-two bank entries")

  @public
  val io = IO(new Bundle {
    val cmdReq       = Flipped(Decoupled(new BallRsIssue(b)))
    val cmdResp      = Decoupled(new BallRsComplete(b))
    val channelReady = Input(Bool())
    val bankRead     = Vec(2, Flipped(new BankRead(b)))
    val bankWrite    = Vec(1, Flipped(new BankWrite(b)))
    val status       = new BallStatus
  })

  // Recoded-float helpers (fp32: expWidth 8, sigWidth 24).
  private def f2r(v: UInt): UInt = recFNFromFN(8, 24, v)
  private def r2f(v: UInt): UInt = fNFromRecFN(8, 24, v)

  private val rm  = round_near_even
  private val tny = false.B

  private val epsIeee = "h2B8CBCCC".U(32.W) // fp32(1e-12)
  private val cHalf   = "h3f000000".U(32.W) // fp32(0.5)
  private val c15     = "h3fc00000".U(32.W) // fp32(1.5)

  // FSM: idle -> read -> compute -> write -> complete.  The three per-row
  // passes are selected by `phase`; `drain` adds the single statistic-latch
  // cycle that ends the mean/variance passes.
  val Seq(idle, read, compute, write, complete) = Enum(5)
  val state                                     = RegInit(idle)
  val phase                                     = RegInit(0.U(2.W)) // 0 mean, 1 var, 2 norm
  val drain                                     = RegInit(false.B)

  val robId     = RegInit(0.U(log2Up(b.frontend.rob_entries).W))
  val isSub     = RegInit(false.B)
  val subRobId  = RegInit(0.U(log2Up(b.frontend.sub_rob_depth * 4).W))
  val xBank     = RegInit(0.U(bankIdBits.W))
  val pBank     = RegInit(0.U(bankIdBits.W))
  val oBank     = RegInit(0.U(bankIdBits.W))
  val rowsReg   = RegInit(0.U(rowsBits.W))
  val colsReg   = RegInit(0.U(colsBits.W))
  val rIdx      = RegInit(0.U(rowsBits.W)) // current row
  val tIdx      = RegInit(0.U(lineBits.W)) // current line within the row
  val lane      = RegInit(0.U(2.W))
  val rdStage   = RegInit(0.U(1.W))        // norm pass: 0 = x+gamma, 1 = beta
  val xPend     = RegInit(false.B)
  val gPend     = RegInit(false.B)
  val bPend     = RegInit(false.B)
  val xGot      = RegInit(false.B)
  val gGot      = RegInit(false.B)
  val wrPend    = RegInit(false.B)
  val xWord     = Reg(UInt(b.memDomain.bankWidth.W))
  val gammaWord = Reg(UInt(b.memDomain.bankWidth.W))
  val betaWord  = Reg(UInt(b.memDomain.bankWidth.W))
  val yLaneIeee = RegInit(VecInit(Seq.fill(lanes)(0.U(32.W))))

  // RecFN(8,24) row statistics.
  val sAcc    = RegInit(0.U(recW.W)) // mean pass accumulator
  val ssAcc   = RegInit(0.U(recW.W)) // variance pass accumulator
  val muReg   = RegInit(0.U(recW.W))
  val rstdReg = RegInit(0.U(recW.W))

  private val rowLines = colsReg >> 2                                // C / 4 lines per row
  private val kc       =
    Mux(colsReg === 4.U, 2.U(4.W), Mux(colsReg === 64.U, 6.U(4.W), Mux(colsReg === 256.U, 8.U(4.W), 9.U(4.W))))
  private val invCIeee = Cat(0.U(1.W), (127.U(8.W) - kc), 0.U(23.W)) // exact 1/C

  // Flat-line decomposition: x/out row r line t sits at flat line
  // L = r*rowLines + t with group L/64 and offset L%64 (regions are
  // single-bank-contiguous across groups).  Valid L <= rowsMax - 1.
  private val xFlat     = ((rIdx << (kc - 2.U)) | tIdx)(rowsBits - 1, 0)
  private val xCol      = xFlat(rowsBits - 1, addrBits)
  private val xAddr     = xFlat(addrBits - 1, 0)
  private val gammaCol  = (tIdx >> addrBits)(1, 0)
  private val gammaAddr = tIdx(addrBits - 1, 0)
  private val betaFlat  = rowLines + tIdx
  private val betaCol   = (betaFlat >> addrBits)(1, 0)
  private val betaAddr  = betaFlat(addrBits - 1, 0)

  private val xLanes     = VecInit(Seq.tabulate(lanes)(i => xWord(32 * i + 31, 32 * i)))
  private val gammaLanes = VecInit(Seq.tabulate(lanes)(i => gammaWord(32 * i + 31, 32 * i)))
  private val betaLanes  = VecInit(Seq.tabulate(lanes)(i => betaWord(32 * i + 31, 32 * i)))

  // hardfloat fp32 add/mul primitives (combinational; sampled only by the
  // owning FSM state).
  val addAcc = Module(new AddRecFN(8, 24)) // mean accumulator
  val subMu  = Module(new AddRecFN(8, 24)) // d = x - mu
  val mulDD  = Module(new MulRecFN(8, 24)) // d * d
  val addSS  = Module(new AddRecFN(8, 24)) // variance accumulator
  val mulMu  = Module(new MulRecFN(8, 24)) // mu = sum * (1/C)
  val mulVar = Module(new MulRecFN(8, 24)) // var = ss * (1/C)
  val addEps = Module(new AddRecFN(8, 24)) // v = var + eps
  val subD2  = Module(new AddRecFN(8, 24)) // normalize: d = x - mu
  val mulR   = Module(new MulRecFN(8, 24)) // d * rstd
  val mulG   = Module(new MulRecFN(8, 24)) // * gamma
  val addY   = Module(new AddRecFN(8, 24)) // + beta

  for (u <- Seq(addAcc, subMu, addSS, addEps, subD2, addY)) {
    u.io.roundingMode   := rm
    u.io.detectTininess := tny
  }
  for (u <- Seq(mulDD, mulMu, mulVar, mulR, mulG)) {
    u.io.roundingMode   := rm
    u.io.detectTininess := tny
  }

  addAcc.io.subOp := false.B
  addAcc.io.a     := sAcc
  addAcc.io.b     := f2r(xLanes(lane))
  subMu.io.subOp  := true.B
  subMu.io.a      := f2r(xLanes(lane))
  subMu.io.b      := muReg
  mulDD.io.a      := subMu.io.out
  mulDD.io.b      := subMu.io.out
  addSS.io.subOp  := false.B
  addSS.io.a      := ssAcc
  addSS.io.b      := mulDD.io.out
  mulMu.io.a      := sAcc
  mulMu.io.b      := f2r(invCIeee)
  mulVar.io.a     := ssAcc
  mulVar.io.b     := f2r(invCIeee)
  addEps.io.subOp := false.B
  addEps.io.a     := mulVar.io.out
  addEps.io.b     := f2r(epsIeee)
  subD2.io.subOp  := true.B
  subD2.io.a      := f2r(xLanes(lane))
  subD2.io.b      := muReg
  mulR.io.a       := subD2.io.out
  mulR.io.b       := rstdReg
  mulG.io.a       := mulR.io.out
  mulG.io.b       := f2r(gammaLanes(lane))
  addY.io.subOp   := false.B
  addY.io.a       := mulG.io.out
  addY.io.b       := f2r(betaLanes(lane))

  // rsqrt(v) = 1/sqrt(v) by Newton iteration from the classic bit-level
  // seed; 5 iterations from a < 4% initial error land at fp32 precision.
  // Combinational chain; the result is latched once per row (variance
  // drain cycle), never sampled while v is still accumulating.
  private val rsqrtV = r2f(addEps.io.out)

  private def rsqrtChain(v: UInt): UInt = {
    val vR   = f2r(v)
    val half = Module(new MulRecFN(8, 24))
    half.io.a            := f2r(cHalf); half.io.b      := vR
    half.io.roundingMode := rm; half.io.detectTininess := tny
    val seed = f2r(("h5F3759DF".U(32.W) - (v >> 1))(31, 0))
    var y    = seed
    for (_ <- 0 until 5) {
      val y2 = Module(new MulRecFN(8, 24))
      y2.io.a            := y; y2.io.b               := y
      y2.io.roundingMode := rm; y2.io.detectTininess := tny
      val t = Module(new MulRecFN(8, 24))
      t.io.a            := half.io.out; t.io.b     := y2.io.out
      t.io.roundingMode := rm; t.io.detectTininess := tny
      val s = Module(new AddRecFN(8, 24))
      s.io.subOp        := true.B
      s.io.a            := f2r(c15); s.io.b        := t.io.out
      s.io.roundingMode := rm; s.io.detectTininess := tny
      val ny = Module(new MulRecFN(8, 24))
      ny.io.a            := y; ny.io.b               := s.io.out
      ny.io.roundingMode := rm; ny.io.detectTininess := tny
      y = ny.io.out
    }
    y
  }

  private val rstdComb = rsqrtChain(rsqrtV)

  // SRAM port static fields and defaults.
  io.bankRead(0).rob_id           := robId
  io.bankRead(0).ball_id          := 0.U
  io.bankRead(0).bank_id          := xBank
  io.bankRead(0).group_id         := xCol
  io.bankRead(0).io.req.valid     := false.B
  io.bankRead(0).io.req.bits.addr := xAddr
  io.bankRead(0).io.resp.ready    := false.B

  io.bankRead(1).rob_id           := robId
  io.bankRead(1).ball_id          := 0.U
  io.bankRead(1).bank_id          := pBank
  io.bankRead(1).group_id         := Mux(rdStage === 0.U, gammaCol, betaCol)
  io.bankRead(1).io.req.valid     := false.B
  io.bankRead(1).io.req.bits.addr := Mux(rdStage === 0.U, gammaAddr, betaAddr)
  io.bankRead(1).io.resp.ready    := false.B

  io.bankWrite(0).rob_id           := robId
  io.bankWrite(0).ball_id          := 0.U
  io.bankWrite(0).bank_id          := oBank
  io.bankWrite(0).group_id         := xCol
  io.bankWrite(0).io.req.valid     := false.B
  io.bankWrite(0).io.req.bits.addr := xAddr
  io.bankWrite(0).io.req.bits.data := Cat(yLaneIeee(3), yLaneIeee(2), yLaneIeee(1), yLaneIeee(0))
  io.bankWrite(0).io.req.bits.mask := VecInit(Seq.fill(b.memDomain.bankMaskLen)(true.B))
  io.bankWrite(0).io.resp.ready    := false.B

  io.cmdReq.ready            := state === idle
  io.cmdResp.valid           := state === complete
  io.cmdResp.bits.rob_id     := robId
  io.cmdResp.bits.is_sub     := isSub
  io.cmdResp.bits.sub_rob_id := subRobId

  switch(state) {
    is(idle) {
      when(io.cmdReq.fire) {
        val command      = io.cmdReq.bits.cmd
        val colsCmd      = command.rs2(31, 0)
        // Fail-hard issue table, mirroring emu/src/73_layernorm.rs.
        assert(command.funct7 === funct.U(7.W), "LayerNormBall funct7 must be LAYERNORM")
        assert(
          command.op1_en && command.op2_en && command.wr_spad_en,
          "layernorm: requires x/param reads and one output write"
        )
        assert(
          colsCmd === 4.U || colsCmd === 64.U ||
            colsCmd === 256.U || colsCmd === 512.U,
          "layernorm: unsupported cols"
        )
        assert(command.rs2(63, 32) === 0.U, "layernorm: reserved rs2[63:32] must be zero")
        assert(command.iter =/= 0.U, "layernorm: rows (iter) must be positive")
        assert(
          command.op1_bank =/= command.op2_bank && command.op1_bank =/= command.wr_bank &&
            command.op2_bank =/= command.wr_bank,
          "layernorm: x/param/out banks must be pairwise distinct"
        )
        assert(
          command.op1_bank < b.memDomain.bankNum.U && command.op2_bank < b.memDomain.bankNum.U &&
            command.wr_bank < b.memDomain.bankNum.U,
          "layernorm: bank ids must be in range"
        )
        assert(
          command.op1_col =/= 0.U && command.op1_col <= b.memDomain.bankNum.U,
          "layernorm: x bank groups out of range"
        )
        assert(
          command.op2_col =/= 0.U && command.op2_col <= b.memDomain.bankNum.U,
          "layernorm: param bank groups out of range"
        )
        assert(command.wr_col === command.op1_col, "layernorm: x and out bank groups must match")
        // x/out region: rows*rowLines flat lines across op1_col groups of
        // bankEntries lines; rowLines = C/4 = 2^(log2(C) - 2).
        val rowsPerCol   = MuxCase(
          0.U(rowsBits.W),
          Seq(
            (colsCmd === 4.U)   -> (Cat(0.U(rowsBits.W), command.op1_col) << 6),
            (colsCmd === 64.U)  -> (Cat(0.U(rowsBits.W), command.op1_col) << 2),
            (colsCmd === 256.U) -> Cat(0.U(rowsBits.W), command.op1_col),
            (colsCmd === 512.U) -> Cat(0.U(rowsBits.W), command.op1_col(4, 1))
          )
        )
        assert(command.iter <= rowsPerCol, "layernorm: row region exceeds x bank capacity")
        // param region: C/2 flat lines across op2_col groups (gamma C/4,
        // beta C/4); needs op2_col >= ceil(C / 2 / bankEntries).
        val paramColsMin = MuxCase(
          0.U(5.W),
          Seq(
            (colsCmd === 4.U)   -> 1.U,
            (colsCmd === 64.U)  -> 1.U,
            (colsCmd === 256.U) -> 2.U,
            (colsCmd === 512.U) -> 4.U
          )
        )
        assert(command.op2_col >= paramColsMin, "layernorm: param region exceeds param bank capacity")

        robId    := io.cmdReq.bits.rob_id
        isSub    := io.cmdReq.bits.is_sub
        subRobId := io.cmdReq.bits.sub_rob_id
        xBank    := command.op1_bank
        pBank    := command.op2_bank
        oBank    := command.wr_bank
        rowsReg  := command.iter(rowsBits - 1, 0)
        colsReg  := colsCmd(colsBits - 1, 0)
        rIdx     := 0.U
        tIdx     := 0.U
        lane     := 0.U
        rdStage  := 0.U
        xPend    := false.B
        gPend    := false.B
        bPend    := false.B
        xGot     := false.B
        gGot     := false.B
        wrPend   := false.B
        drain    := false.B
        phase    := 0.U
        sAcc     := 0.U
        ssAcc    := 0.U
        state    := read
      }
    }

    is(read) {
      when(io.channelReady) {
        when(phase === 2.U) {
          when(rdStage === 0.U) {
            // One x line (port 0) plus one gamma line (port 1).  Requests
            // are issued once per line (never re-issued after a response);
            // responses may land on different cycles, so stage advance waits
            // for both latched words.
            io.bankRead(0).io.req.valid            := !xPend && !xGot
            io.bankRead(1).io.req.valid            := !gPend && !gGot
            io.bankRead(0).io.resp.ready           := xPend
            io.bankRead(1).io.resp.ready           := gPend
            when(io.bankRead(0).io.req.fire)(xPend := true.B)
            when(io.bankRead(1).io.req.fire)(gPend := true.B)
            when(io.bankRead(0).io.resp.fire) {
              xWord := io.bankRead(0).io.resp.bits.data
              xPend := false.B
              xGot  := true.B
            }
            when(io.bankRead(1).io.resp.fire) {
              gammaWord := io.bankRead(1).io.resp.bits.data
              gPend     := false.B
              gGot      := true.B
            }
            when(xGot && gGot) {
              xGot    := false.B
              gGot    := false.B
              rdStage := 1.U
            }
          }.otherwise {
            // Beta line for the same x line (port 1).
            io.bankRead(1).io.req.valid            := !bPend
            io.bankRead(1).io.resp.ready           := bPend
            when(io.bankRead(1).io.req.fire)(bPend := true.B)
            when(io.bankRead(1).io.resp.fire) {
              betaWord := io.bankRead(1).io.resp.bits.data
              bPend    := false.B
              rdStage  := 0.U
              state    := compute
            }
          }
        }.otherwise {
          // One x line (port 0) for the mean or variance pass.
          io.bankRead(0).io.req.valid            := !xPend
          io.bankRead(0).io.resp.ready           := xPend
          when(io.bankRead(0).io.req.fire)(xPend := true.B)
          when(io.bankRead(0).io.resp.fire) {
            xWord := io.bankRead(0).io.resp.bits.data
            xPend := false.B
            state := compute
          }
        }
      }
    }

    is(compute) {
      when(drain) {
        // One-cycle statistic latch between passes.
        drain := false.B
        when(phase === 0.U) {
          muReg := mulMu.io.out
          sAcc  := 0.U
          phase := 1.U
          tIdx  := 0.U
          state := read
        }.otherwise {
          rstdReg := rstdComb
          ssAcc   := 0.U
          phase   := 2.U
          tIdx    := 0.U
          state   := read
        }
      }.otherwise {
        when(phase === 2.U) {
          // Normalize four lanes of the current x/gamma/beta words.
          yLaneIeee(lane) := r2f(addY.io.out)
          when(lane === (lanes - 1).U) {
            lane  := 0.U
            state := write
          }.otherwise {
            lane := lane + 1.U
          }
        }.otherwise {
          // Mean or variance accumulation, one element per cycle.
          when(phase === 0.U)(sAcc  := addAcc.io.out)
          when(phase === 1.U)(ssAcc := addSS.io.out)
          when(lane === (lanes - 1).U) {
            lane := 0.U
            when(tIdx + 1.U === rowLines) {
              drain := true.B
            }.otherwise {
              tIdx  := tIdx + 1.U
              state := read
            }
          }.otherwise {
            lane := lane + 1.U
          }
        }
      }
    }

    is(write) {
      when(io.channelReady) {
        when(wrPend) {
          io.bankWrite(0).io.resp.ready := true.B
          when(io.bankWrite(0).io.resp.fire) {
            wrPend := false.B
            when(tIdx + 1.U === rowLines) {
              tIdx := 0.U
              when(rIdx + 1.U === rowsReg) {
                state := complete
              }.otherwise {
                rIdx  := rIdx + 1.U
                phase := 0.U
                state := read
              }
            }.otherwise {
              tIdx  := tIdx + 1.U
              state := read
            }
          }
        }.otherwise {
          io.bankWrite(0).io.req.valid             := true.B
          when(io.bankWrite(0).io.req.fire)(wrPend := true.B)
        }
      }
    }

    is(complete) {
      when(io.cmdResp.fire)(state := idle)
    }
  }

  io.status.idle    := state === idle
  io.status.running := state =/= idle
}
