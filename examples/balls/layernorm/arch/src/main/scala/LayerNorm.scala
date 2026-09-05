package examples.balls.layernorm

import chisel3._
import chisel3.experimental.hierarchy.{instantiable, public}
import chisel3.util._
import framework.balldomain.blink.{BallStatus, BankRead, BankWrite}
import framework.balldomain.rs.{BallRsComplete, BallRsIssue}
import framework.top.GlobalConfig
import hardfloat._

/**
 * LayerNorm compute unit: row-wise fp32 layer normalization over a dense
 * R x C row-major block in SRAM banks (reference:
 * torch.nn.LayerNorm(C, eps=1e-12), biased variance, two-step form):
 *   mu  = sum(row) / C
 *   var = sum((x - mu)^2) / C
 *   rstd = rsqrt(var + 1e-12)             (eps fixed in the op semantics)
 *   y[j] = (x[j] - mu) * rstd * gamma[j] + beta[j]
 * x_bank (read port 0) and param_bank (gamma in [0,C), beta in [C,2C),
 * read port 1) are inputs, out_bank (write port 0) is the distinct output;
 * a bank row is 16 bytes = 4 fp32 lanes, C is a multiple of 4 so every row
 * is 16B-aligned and gamma/beta line offsets are integral.
 *
 * Datapath: hardfloat combinational fp32 add/mul primitives, one element
 * per cycle per stage (time-multiplexed over the 4 lanes of a 16B word).
 * The row mean uses 1/C from a 5-iteration Newton reciprocal of an
 * exponent-only seed; the row rstd uses a 6-iteration Newton rsqrt
 * (y' = y*(1.5 - 0.5*v*y*y)) from an exponent-only seed.  Offline fp32
 * emulation of this exact datapath over the ctest vectors lands below
 * 0.4% of the |got - golden| <= 1e-4 * (1 + |golden|) budget; the ctest
 * and bemu golden evaluate in IEEE double.
 *
 * The fail-hard table is identical to examples/balls/layernorm/emu/src/
 * 69_layernorm.rs; an undeclared funct7 never reaches this unit (the
 * framework decoder asserts on it and the dispatch chain panics in
 * simulation).
 */
@instantiable
class LayerNorm(val b: GlobalConfig) extends Module {
  private val bankIdBits   = log2Up(b.memDomain.bankNum)
  private val addressWidth = log2Up(b.memDomain.bankEntries)
  private val countWidth   = log2Up(b.memDomain.bankEntries + 1)

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

  @public
  val io = IO(new Bundle {
    val cmdReq       = Flipped(Decoupled(new BallRsIssue(b)))
    val cmdResp      = Decoupled(new BallRsComplete(b))
    val channelReady = Input(Bool())
    val bankRead     = Vec(2, Flipped(new BankRead(b)))
    val bankWrite    = Vec(1, Flipped(new BankWrite(b)))
    val status       = new BallStatus
  })

  private val rm  = consts.round_near_even
  private val tny = false.B

  private val epsIeee = "h2B8CBCCC".U(32.W) // fp32(1e-12)
  private val f2r     = hardfloat.recFNFromFN(8, 24, _: UInt)
  private val r2f     = hardfloat.fNFromRecFN(8, 24, _: UInt)

  // FSM: idle -> waitForChannels -> per-row pass A (mean, variance, two
  // x scans) -> per-row rstd -> pass B (normalize, gamma/beta per output
  // word) -> next row -> complete.
  val Seq(
    idle,
    waitForChannels,
    a1Read,
    a1Resp,
    a1Add,
    rowMu,
    a2Read,
    a2Resp,
    a2Add,
    rowVar,
    bRead,
    bRespG,
    bBetaReq,
    bBetaResp,
    bLanes,
    bWrite,
    bWriteResp,
    bRowEnd,
    complete
  ) = Enum(19)

  val state = RegInit(idle)

  val robId    = RegInit(0.U(log2Up(b.frontend.rob_entries).W))
  val isSub    = RegInit(false.B)
  val subRobId = RegInit(0.U(log2Up(b.frontend.sub_rob_depth * 4).W))
  val xBank    = RegInit(0.U(bankIdBits.W))
  val pBank    = RegInit(0.U(bankIdBits.W))
  val oBank    = RegInit(0.U(bankIdBits.W))
  val cU       = RegInit(0.U(32.W))           // columns per row (xs2[31:0])
  val lines    = RegInit(0.U(addressWidth.W)) // L = C / 4 lines per row
  val rows     = RegInit(0.U(countWidth.W))   // R = N / C
  val rIdx     = RegInit(0.U(countWidth.W))
  val wIdx     = RegInit(0.U(countWidth.W))
  val lane     = RegInit(0.U(2.W))

  val xWord     = Reg(UInt(128.W))
  val gammaWord = Reg(UInt(128.W))
  val betaWord  = Reg(UInt(128.W))
  val xLanes    = VecInit(Seq.tabulate(4)(i => xWord(32 * i + 31, 32 * i)))
  val gLanes    = VecInit(Seq.tabulate(4)(i => gammaWord(32 * i + 31, 32 * i)))
  val bLanes    = VecInit(Seq.tabulate(4)(i => betaWord(32 * i + 31, 32 * i)))
  val yLaneIeee = RegInit(VecInit(Seq.fill(4)(0.U(32.W))))

  // RecFN(8,24) state: row accumulators and derived row statistics.
  private val recW = 33
  val sAcc         = RegInit(0.U(recW.W)) // pass A1: sum(row)
  val ssAcc        = RegInit(0.U(recW.W)) // pass A2: sum((x - mu)^2)
  val muReg        = RegInit(0.U(recW.W))
  val rstdReg      = RegInit(0.U(recW.W))
  val recipCReg    = RegInit(0.U(recW.W)) // 1/C, computed once per command

  // ---------------------------------------------------------------------
  // hardfloat fp32 add/mul primitives (combinational, one instance per
  // operation site; results are only sampled in the owning FSM state).
  // ---------------------------------------------------------------------
  val addS   = Module(new AddRecFN(8, 24)) // A1 accumulator
  val subD   = Module(new AddRecFN(8, 24)) // A2: d = x - mu
  val mulDD  = Module(new MulRecFN(8, 24)) // A2: d * d
  val addSS  = Module(new AddRecFN(8, 24)) // A2 accumulator
  val mulMu  = Module(new MulRecFN(8, 24)) // mu = sum * (1/C)
  val mulVar = Module(new MulRecFN(8, 24)) // var = ss * (1/C)
  val addEps = Module(new AddRecFN(8, 24)) // v = var + eps
  val subD2  = Module(new AddRecFN(8, 24)) // B: d = x - mu
  val mulR   = Module(new MulRecFN(8, 24)) // B: d * rstd
  val mulG   = Module(new MulRecFN(8, 24)) // B: * gamma
  val addY   = Module(new AddRecFN(8, 24)) // B: + beta
  for (u <- Seq(addS, subD, addSS, addEps, subD2, addY)) {
    u.io.roundingMode   := rm
    u.io.detectTininess := tny
  }
  for (u <- Seq(mulDD, mulMu, mulVar, mulR, mulG)) {
    u.io.roundingMode   := rm
    u.io.detectTininess := tny
  }

  addS.io.subOp   := false.B
  addS.io.a       := sAcc
  addS.io.b       := f2r(xLanes(lane))
  subD.io.subOp   := true.B
  subD.io.a       := f2r(xLanes(lane))
  subD.io.b       := muReg
  mulDD.io.a      := subD.io.out
  mulDD.io.b      := subD.io.out
  addSS.io.subOp  := false.B
  addSS.io.a      := ssAcc
  addSS.io.b      := mulDD.io.out
  mulMu.io.a      := sAcc
  mulMu.io.b      := recipCReg
  mulVar.io.a     := ssAcc
  mulVar.io.b     := recipCReg
  addEps.io.subOp := false.B
  addEps.io.a     := mulVar.io.out
  addEps.io.b     := f2r(epsIeee)
  subD2.io.subOp  := true.B
  subD2.io.a      := f2r(xLanes(lane))
  subD2.io.b      := muReg
  mulR.io.a       := subD2.io.out
  mulR.io.b       := rstdReg
  mulG.io.a       := mulR.io.out
  mulG.io.b       := f2r(gLanes(lane))
  addY.io.subOp   := false.B
  addY.io.a       := mulG.io.out
  addY.io.b       := f2r(bLanes(lane))

  // ---------------------------------------------------------------------
  // Newton reciprocal of C (IEEE input, RecFN output).  Seed 2^-E-1
  // (mantissa 1.0) from the exponent field: C * y0 in [0.5, 1), five fp32
  // iterations land at ~1e-7 relative (offline-validated).
  // ---------------------------------------------------------------------
  private def cIeee: UInt = {
    val v   = cU(11, 0) // c <= 2 * bank lines (2048 on toy) asserted at issue
    val msb = WireInit(0.U(5.W))
    for (i <- 0 until 12) { when(v(i))(msb := i.U) }
    val exp  = (msb +& 127.U)(7, 0)
    val mask = (1.U(12.W) << msb) - 1.U
    val mant = ((v & mask) << (23.U - msb))(22, 0)
    Cat(0.U(1.W), exp, mant)
  }

  private def recipNewton(inIeee: UInt): UInt = {
    val e        = inIeee(30, 23)
    val seedIeee = Cat(0.U(1.W), (253.U - e)(7, 0), 0.U(23.W))
    val vR       = f2r(inIeee)
    var y        = f2r(seedIeee)
    for (_ <- 0 until 5) {
      val m1 = Module(new MulRecFN(8, 24))
      m1.io.a := vR; m1.io.b := y; m1.io.roundingMode := rm; m1.io.detectTininess := tny
      val s = Module(new AddRecFN(8, 24))
      s.io.subOp        := true.B
      s.io.a            := f2r("h40000000".U(32.W)); s.io.b := m1.io.out
      s.io.roundingMode := rm; s.io.detectTininess          := tny
      val m2 = Module(new MulRecFN(8, 24))
      m2.io.a := y; m2.io.b := s.io.out; m2.io.roundingMode := rm; m2.io.detectTininess := tny
      y = m2.io.out
    }
    y
  }

  // ---------------------------------------------------------------------
  // Newton rsqrt (RecFN output).  Seed from the exponent field:
  // y0 = 2^-ceil(E/2), |relative error| < 0.42; six fp32 iterations
  // (y' = y * (1.5 - k * y^2), k = v/2) land at ~1.3e-7 relative
  // (offline-validated over 2^-40..2^40).
  // ---------------------------------------------------------------------
  private def rsqrtNewton(inIeee: UInt): UInt = {
    val e        = inIeee(30, 23)
    val half     = (e.zext(9).asSInt - 126.S) >> 1 // floor((e-126)/2) = ceil(E/2)
    val seedIeee = Cat(0.U(1.W), (127.S - half)(7, 0), 0.U(23.W))
    val vR       = f2r(inIeee)
    val k = {
      val m = Module(new MulRecFN(8, 24))
      m.io.a            := f2r("h3f000000".U(32.W)); m.io.b := vR // 0.5 * v
      m.io.roundingMode := rm; m.io.detectTininess          := tny
      m.io.out
    }
    var y        = f2r(seedIeee)
    for (_ <- 0 until 6) {
      val m1 = Module(new MulRecFN(8, 24))
      m1.io.a := y; m1.io.b := y; m1.io.roundingMode := rm; m1.io.detectTininess := tny
      val m2 = Module(new MulRecFN(8, 24))
      m2.io.a := k; m2.io.b := m1.io.out; m2.io.roundingMode := rm; m2.io.detectTininess := tny
      val s = Module(new AddRecFN(8, 24))
      s.io.subOp        := true.B
      s.io.a            := f2r("h3fc00000".U(32.W)); s.io.b := m2.io.out // 1.5 - k*y*y
      s.io.roundingMode := rm; s.io.detectTininess          := tny
      val m3 = Module(new MulRecFN(8, 24))
      m3.io.a := y; m3.io.b := s.io.out; m3.io.roundingMode := rm; m3.io.detectTininess := tny
      y = m3.io.out
    }
    y
  }

  private val recipCWire = recipNewton(cIeee)
  private val rstdWire   = rsqrtNewton(r2f(addEps.io.out))

  // ---------------------------------------------------------------------
  // SRAM port static fields and defaults
  // ---------------------------------------------------------------------
  private val xAddr = (rIdx * lines + wIdx)(addressWidth - 1, 0)
  io.bankRead(0).rob_id           := robId
  io.bankRead(0).ball_id          := 0.U
  io.bankRead(0).bank_id          := xBank
  io.bankRead(0).group_id         := 0.U
  io.bankRead(0).io.req.valid     := false.B
  io.bankRead(0).io.req.bits.addr := xAddr
  io.bankRead(0).io.resp.ready    := false.B

  io.bankRead(1).rob_id           := robId
  io.bankRead(1).ball_id          := 0.U
  io.bankRead(1).bank_id          := pBank
  io.bankRead(1).group_id         := 0.U
  io.bankRead(1).io.req.valid     := false.B
  io.bankRead(1).io.req.bits.addr := wIdx(addressWidth - 1, 0) // gamma word
  io.bankRead(1).io.resp.ready    := false.B

  io.bankWrite(0).rob_id           := robId
  io.bankWrite(0).ball_id          := 0.U
  io.bankWrite(0).bank_id          := oBank
  io.bankWrite(0).group_id         := 0.U
  io.bankWrite(0).io.req.valid     := false.B
  io.bankWrite(0).io.req.bits.addr := xAddr
  io.bankWrite(0).io.req.bits.data := Cat(yLaneIeee(3), yLaneIeee(2), yLaneIeee(1), yLaneIeee(0))
  io.bankWrite(0).io.req.bits.mask := VecInit(Seq.fill(16)(true.B))
  io.bankWrite(0).io.resp.ready    := false.B

  io.cmdReq.ready            := state === idle
  io.cmdResp.valid           := state === complete
  io.cmdResp.bits.rob_id     := robId
  io.cmdResp.bits.is_sub     := isSub
  io.cmdResp.bits.sub_rob_id := subRobId

  val lastWord = wIdx + 1.U === lines
  val lastRow  = rIdx + 1.U === rows

  switch(state) {
    is(idle) {
      when(io.cmdReq.fire) {
        val command = io.cmdReq.bits.cmd
        // Fail-hard table, identical to emu/src/69_layernorm.rs.
        assert(command.funct7 === funct.U(7.W), "LayerNormBall funct7 must be LAYERNORM")
        assert(command.rs2(63, 32) === 0.U, "layernorm: reserved xs2[63:32] must be zero")
        assert(
          command.op1_en && command.op2_en && command.wr_spad_en,
          "layernorm: requires x, param reads and one output write"
        )
        assert(command.iter =/= 0.U, "layernorm: N must be positive")
        assert(command.rs2(31, 0) =/= 0.U, "layernorm: C must be positive")
        assert(command.rs2(1, 0) === 0.U, "layernorm: C must be a multiple of 4 (16B bank row)")
        assert(
          command.rs2(31, 0) <= (2 * b.memDomain.bankEntries).U(32.W),
          "layernorm: C exceeds 2 * bank lines (2C gamma+beta bank capacity)"
        )
        assert(
          command.iter <= (4 * b.memDomain.bankEntries).U(b.frontend.iter_len.W),
          "layernorm: N exceeds bank capacity (4 * bank lines)"
        )
        val cSafe   = Mux(command.rs2(31, 0) === 0.U, 1.U, command.rs2(31, 0))
        assert(command.iter % cSafe === 0.U, "layernorm: N must be whole rows of C")
        assert(
          command.op1_bank =/= command.op2_bank && command.op1_bank =/= command.wr_bank &&
            command.op2_bank =/= command.wr_bank,
          "layernorm: x/param/out banks must be pairwise distinct"
        )
        assert(
          command.op1_col === 1.U && command.op2_col === 1.U && command.wr_col === 1.U,
          "layernorm: x/param/out banks must be single-group allocated"
        )

        robId    := io.cmdReq.bits.rob_id
        isSub    := io.cmdReq.bits.is_sub
        subRobId := io.cmdReq.bits.sub_rob_id
        xBank    := command.op1_bank
        pBank    := command.op2_bank
        oBank    := command.wr_bank
        cU       := command.rs2(31, 0)
        lines    := command.rs2(31, 2)(addressWidth - 1, 0)
        rows     := (command.iter / cSafe)(countWidth - 1, 0)
        sAcc     := 0.U
        ssAcc    := 0.U
        rIdx     := 0.U
        wIdx     := 0.U
        lane     := 0.U
        state    := waitForChannels
      }
    }

    is(waitForChannels) {
      // 1/C converges combinationally from the latched C; latch it here.
      recipCReg                   := recipCWire
      when(io.channelReady)(state := a1Read)
    }

    // ---- pass A1: sum(row) over lines 0..L-1 of row rIdx ----
    is(a1Read) {
      io.bankRead(0).io.req.valid            := true.B
      when(io.bankRead(0).io.req.fire)(state := a1Resp)
    }
    is(a1Resp) {
      io.bankRead(0).io.resp.ready := true.B
      when(io.bankRead(0).io.resp.fire) {
        xWord := io.bankRead(0).io.resp.bits.data
        lane  := 0.U
        state := a1Add
      }
    }
    is(a1Add) {
      sAcc := addS.io.out
      when(lane === 3.U) {
        lane  := 0.U
        wIdx  := wIdx + 1.U
        state := Mux(lastWord, rowMu, a1Read)
      }.otherwise {
        lane := lane + 1.U
      }
    }

    // ---- mu = sum * (1/C); reset accumulators for the variance pass ----
    is(rowMu) {
      muReg := mulMu.io.out
      sAcc  := 0.U
      ssAcc := 0.U
      wIdx  := 0.U
      state := a2Read
    }

    // ---- pass A2: ss += (x - mu)^2 over the row ----
    is(a2Read) {
      io.bankRead(0).io.req.valid            := true.B
      when(io.bankRead(0).io.req.fire)(state := a2Resp)
    }
    is(a2Resp) {
      io.bankRead(0).io.resp.ready := true.B
      when(io.bankRead(0).io.resp.fire) {
        xWord := io.bankRead(0).io.resp.bits.data
        lane  := 0.U
        state := a2Add
      }
    }
    is(a2Add) {
      ssAcc := addSS.io.out
      when(lane === 3.U) {
        lane  := 0.U
        wIdx  := wIdx + 1.U
        state := Mux(lastWord, rowVar, a2Read)
      }.otherwise {
        lane := lane + 1.U
      }
    }

    // ---- rstd = rsqrt(var + eps) for this row ----
    is(rowVar) {
      rstdReg := rstdWire
      wIdx    := 0.U
      state   := bRead
    }

    // ---- pass B: y = ((x - mu) * rstd) * gamma + beta, write word ----
    is(bRead) {
      io.bankRead(0).io.req.valid                                          := true.B
      io.bankRead(1).io.req.valid                                          := true.B
      io.bankRead(1).io.req.bits.addr                                      := wIdx(addressWidth - 1, 0)
      when(io.bankRead(0).io.req.fire && io.bankRead(1).io.req.fire)(state := bRespG)
    }
    is(bRespG) {
      io.bankRead(0).io.resp.ready := true.B
      io.bankRead(1).io.resp.ready := true.B
      when(io.bankRead(0).io.resp.fire && io.bankRead(1).io.resp.fire) {
        xWord     := io.bankRead(0).io.resp.bits.data
        gammaWord := io.bankRead(1).io.resp.bits.data
        state     := bBetaReq
      }
    }
    is(bBetaReq) {
      io.bankRead(1).io.req.valid            := true.B
      io.bankRead(1).io.req.bits.addr        := (lines + wIdx)(addressWidth - 1, 0)
      when(io.bankRead(1).io.req.fire)(state := bBetaResp)
    }
    is(bBetaResp) {
      io.bankRead(1).io.resp.ready := true.B
      when(io.bankRead(1).io.resp.fire) {
        betaWord := io.bankRead(1).io.resp.bits.data
        lane     := 0.U
        state    := bLanes
      }
    }
    is(bLanes) {
      yLaneIeee(lane) := r2f(addY.io.out)
      when(lane === 3.U) {
        lane  := 0.U
        state := bWrite
      }.otherwise {
        lane := lane + 1.U
      }
    }
    is(bWrite) {
      io.bankWrite(0).io.req.valid            := true.B
      when(io.bankWrite(0).io.req.fire)(state := bWriteResp)
    }
    is(bWriteResp) {
      io.bankWrite(0).io.resp.ready := true.B
      when(io.bankWrite(0).io.resp.fire) {
        wIdx  := wIdx + 1.U
        state := Mux(lastWord, bRowEnd, bRead)
      }
    }
    is(bRowEnd) {
      rIdx  := rIdx + 1.U
      wIdx  := 0.U
      state := Mux(lastRow, complete, a1Read)
    }

    is(complete) {
      when(io.cmdResp.fire)(state := idle)
    }
  }

  io.status.idle    := state === idle
  io.status.running := state =/= idle
}
