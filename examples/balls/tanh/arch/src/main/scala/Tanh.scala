package examples.balls.tanh

import chisel3._
import chisel3.experimental.hierarchy.{instantiable, public}
import chisel3.util._
import framework.balldomain.blink.{BallStatus, BankRead, BankWrite}
import framework.balldomain.rs.{BallRsComplete, BallRsIssue}
import framework.top.GlobalConfig

/**
 * TANH compute unit: y = tanh(x), the exact form (reference: torch.tanh).
 * fp32 in / fp32 out, 4 fp32 lanes per 16B bank row, one row
 * read -> compute -> write per iteration into a distinct output bank.
 *
 * The datapath is the Q20 fixed-point pipeline validated offline: a
 * 20-segment quartic fit of tanh on |x| in [0, 10) (segment 0.5, Horner with
 * arithmetic >>20 at every step), a bit-accurate fp32 decode/encode, and the
 * exact pass-through clamp |x| >= 10 (golden rounds to bit-exact +-1.0 in
 * fp32 from |x| >= 9.0104 up, so the clamp step is error-free). Worst
 * absolute error against the C golden tanh_ref() over every fp32 point with
 * exponent field 107..130 (the whole region where any lane can disagree,
 * swept as every xq bin with the golden evaluated at the bin's extreme fp32
 * points), both signs (odd symmetry is exact in golden and datapath), plus
 * clamp-band sampling: 5.722e-06 (the segment-0 constant offset at |x| = 0),
 * far below the 1e-4 ctest tolerance.
 *
 * The fail-hard table is identical to examples/balls/tanh/emu/src/58_tanh.rs;
 * an undeclared funct7 never reaches this unit (the framework decoder asserts
 * on it and the dispatch chain panics in simulation).
 */
@instantiable
class Tanh(val b: GlobalConfig) extends Module {
  private val bankIdLen    = b.frontend.bank_id_len
  private val bankIdBits   = log2Up(b.memDomain.bankNum)
  private val addressWidth = log2Up(b.memDomain.bankEntries)
  private val countWidth   = log2Up(b.memDomain.bankEntries + 1)

  private val mapping = b.ballDomain.ballIdMappings
    .find(_.ballName == "TanhBall")
    .getOrElse(throw new IllegalArgumentException("TanhBall not found in config"))

  private val funct = b.ballDomain.ballISA
    .find(_.mnemonic == "TANH")
    .map(_.funct7)
    .getOrElse(throw new IllegalArgumentException("TANH not found in ballISA"))

  require(mapping.inBW == 1, "TanhBall requires one SRAM read port")
  require(mapping.outBW == 1, "TanhBall requires one SRAM write port")
  require(b.memDomain.bankWidth == 128, "TanhBall requires 128-bit SRAM rows")
  require(b.memDomain.bankMaskLen == 16, "TanhBall requires sixteen byte enables")

  @public
  val io = IO(new Bundle {
    val cmdReq       = Flipped(Decoupled(new BallRsIssue(b)))
    val cmdResp      = Decoupled(new BallRsComplete(b))
    val channelReady = Input(Bool())
    val bankRead     = Vec(1, Flipped(new BankRead(b)))
    val bankWrite    = Vec(1, Flipped(new BankWrite(b)))
    val status       = new BallStatus
  })

  // ------------------------------------------------------------------
  // Q20 fixed-point constants, bit-identical to the offline-validated
  // integer model (every fp32 point with exponent 107..130, both signs,
  // swept per xq bin with golden evaluated at the bin extremes:
  // worst |hw - tanh_ref| = 5.722e-06, tolerance 1e-4).
  // ------------------------------------------------------------------
  private val Q       = 20
  // The clamp constants are UInt literals used directly: no asSInt
  // bitcast of a canonicalized UInt literal anywhere in this unit
  // (the Gelu.scala PR #10 lesson).
  private val TH      = "h41200000".U // 10.0f: smallest fp32 with |x| >= 10
  private val ONE     = "h3f800000".U // 1.0f, the positive-side clamp value
  private val NEG_ONE = "hbf800000".U // -1.0f, the negative-side clamp value

  /**
   * tanh(z) ~= c0 + c1*dz + c2*dz^2 + c3*dz^3 + c4*dz^4 on segment s,
   * z in [s*0.5, (s+1)*0.5), dz = z - s*0.5, all in Q20. Segments 16..19
   * are the saturated tail: tanh rounds to exactly 2^20 there.
   */
  private val Coefs = VecInit(Seq(
    Seq(6, 1048018, 9210, -404510, 140927),
    Seq(484561, 825036, -387180, -65759, 104464),
    Seq(798588, 440527, -337913, 123936, -11959),
    Seq(949117, 189466, -171236, 90766, -24495),
    Seq(1010856, 74056, -70989, 41710, -12980),
    Seq(1034540, 27871, -27297, 16608, -5392),
    Seq(1043391, 10340, -10207, 6288, -2072),
    Seq(1046665, 3816, -3778, 2338, -774),
    Seq(1047873, 1405, -1393, 863, -286),
    Seq(1048317, 517, -513, 318, -106),
    Seq(1048481, 190, -189, 117, -39),
    Seq(1048541, 70, -69, 43, -14),
    Seq(1048563, 26, -26, 16, -5),
    Seq(1048571, 9, -9, 6, -2),
    Seq(1048574, 3, -3, 2, -1),
    Seq(1048575, 1, -1, 1, 0),
    Seq(1048576, 0, 0, 0, 0),
    Seq(1048576, 0, 0, 0, 0),
    Seq(1048576, 0, 0, 0, 0),
    Seq(1048576, 0, 0, 0, 0)
  ).map(row => VecInit(row.map(_.S(32.W)))))

  /** One fp32 -> fp32 tanh lane, the validated integer pipeline. */
  private def tanhLane(in: UInt): UInt = {
    val sign = in(31)
    val abs  = in(30, 0) // 31 bits
    val big  = abs >= TH // |x| >= 10.0f (also catches inf/nan bit patterns)

    val exp = abs(30, 23)             // 8 bits
    val man = abs(22, 0)              // 23 bits
    val v   = Cat(1.U(1.W), man)      // 24-bit 1.mantissa
    val xq  = v >> (130.U(8.W) - exp) // |x| * 2^20, floor
    // exp < 107 shifts the 24-bit v by >= 24 -> 0 (subnormals and
    // |x| < 2^-22 flush to zero, |tanh - x| < 2^-20 there, inside the 1e-4
    // contract); exp in 107..130 inside the clamp keeps the shift in 0..23
    // (exp == 130 is exactly the [8,10) band below the clamp).

    val u   = xq                                     // |x|, Q20, 24 bits
    val seg = Mux(u(23, 19) > 19.U, 19.U, u(23, 19)) // segment, saturated to 19
    val dz  = u - (seg << 19)                        // 24 bits; bit 23 is set only
    // in the clamp-discarded band
    // (big == 0 forces dz < 2^19)

    val dzS = dz.asSInt // sign bit clear whenever the result is used
    val c   = Coefs(seg)
    def mul20(a: SInt, k: SInt): SInt = (a * k) >> Q // arithmetic shift = floor, as in validation
    val t = mul20(mul20(mul20(mul20(c(4), dzS) +& c(3), dzS) +& c(2), dzS) +& c(1), dzS) +& c(0)

    // |tanh| = t / 2^20 with 0 <= t <= 2^20 for every non-clamped input
    // (exhaustively validated: t < 0 never, t >= 2^21 never), so the 22-bit
    // slice below never truncates a used value. t = 2^20 encodes to 1.0f
    // exactly (msb 20 -> biased exponent 127, mantissa 0).
    val yq = t.asUInt(21, 0)

    val zeroY = 0.U(31.W) // magnitude +0.0; the input sign is applied at the end
    val nz    = t > 0.S   // exact +-0.0 otherwise (only t = 0 could reach it)
    val msb   = WireInit(0.U(6.W))
    for (i <- 0 until yq.getWidth) { when(yq(i))(msb := i.U) }
    val mant     = (yq << (23.U(6.W) - msb))(22, 0)
    val normal   = Cat(sign, (107.U +& msb)(7, 0), mant)
    val computed = Mux(nz, normal, Cat(sign, zeroY))

    // Clamp path: |x| >= 10 returns exactly +-1.0f; the golden rounds to
    // bit-exact +-1.0f from |x| >= 9.0104, so the clamp step is error-free.
    Mux(big, Mux(sign, NEG_ONE, ONE), computed)
  }

  // ------------------------------------------------------------------
  // FSM: idle -> waitForChannels -> readRequest -> readResponse ->
  //      compute -> writeRequest -> writeResponse -> complete -> idle
  // ------------------------------------------------------------------
  val Seq(idle, waitForChannels, readRequest, readResponse, compute, writeRequest, writeResponse, complete) = Enum(8)
  val state                                                                                                 = RegInit(idle)

  val robId    = RegInit(0.U(log2Up(b.frontend.rob_entries).W))
  val isSub    = RegInit(false.B)
  val subRobId = RegInit(0.U(log2Up(b.frontend.sub_rob_depth * 4).W))
  val inBank   = RegInit(0.U(bankIdBits.W))
  val outBank  = RegInit(0.U(bankIdBits.W))
  val rows     = RegInit(0.U(countWidth.W))
  val line     = RegInit(0.U(addressWidth.W))
  val wordIn   = Reg(UInt(128.W))
  val wordOut  = Reg(UInt(128.W))

  val lanesIn  = Seq.tabulate(4)(i => wordIn(32 * i + 31, 32 * i))
  val lanesOut = lanesIn.map(tanhLane)
  val tanhWord = Cat(lanesOut.reverse)

  io.cmdReq.ready            := state === idle
  io.cmdResp.valid           := state === complete
  io.cmdResp.bits.rob_id     := robId
  io.cmdResp.bits.is_sub     := isSub
  io.cmdResp.bits.sub_rob_id := subRobId

  io.bankRead(0).rob_id           := robId
  io.bankRead(0).ball_id          := 0.U
  io.bankRead(0).bank_id          := inBank
  io.bankRead(0).group_id         := 0.U
  io.bankRead(0).io.req.valid     := false.B
  io.bankRead(0).io.req.bits.addr := line
  io.bankRead(0).io.resp.ready    := false.B

  io.bankWrite(0).rob_id           := robId
  io.bankWrite(0).ball_id          := 0.U
  io.bankWrite(0).bank_id          := outBank
  io.bankWrite(0).group_id         := 0.U
  io.bankWrite(0).io.req.valid     := false.B
  io.bankWrite(0).io.req.bits.addr := line
  io.bankWrite(0).io.req.bits.data := wordOut
  io.bankWrite(0).io.req.bits.mask := VecInit(Seq.fill(16)(true.B))
  io.bankWrite(0).io.resp.ready    := false.B

  switch(state) {
    is(idle) {
      when(io.cmdReq.fire) {
        val command = io.cmdReq.bits.cmd
        // Fail-hard table, identical to emu/src/58_tanh.rs decode_validate.
        assert(command.funct7 === funct.U(7.W), "TanhBall funct7 must be TANH")
        assert(command.rs2 === 0.U, "tanh: reserved xs2 must be zero")
        assert(command.rs1(bankIdLen + 9, bankIdLen) === 0.U, "tanh: reserved rs1 BANK1 field must be zero")
        assert(command.rs1(bankIdLen - 1, bankIdBits) === 0.U, "tanh: invalid in_bank id")
        assert(command.rs1(2 * bankIdLen + 9, 2 * bankIdLen + bankIdBits) === 0.U, "tanh: invalid out_bank id")
        assert(command.iter =/= 0.U, "tanh: N must be positive")
        assert(command.iter(1, 0) === 0.U, "tanh: N must be a multiple of 4 (16B bank row)")
        assert(
          command.iter <= (4 * b.memDomain.bankEntries).U(b.frontend.iter_len.W),
          "tanh: N exceeds bank capacity (4 * bank lines)"
        )
        assert(command.op1_bank =/= command.wr_bank, "tanh: in_bank and out_bank must be distinct")
        assert(command.op1_col === 1.U, "tanh: in_bank not a single-group allocated bank")
        assert(command.wr_col === 1.U, "tanh: out_bank not a single-group allocated bank")

        // Latch every cmdReq field on fire (incl. rob_id).
        robId    := io.cmdReq.bits.rob_id
        isSub    := io.cmdReq.bits.is_sub
        subRobId := io.cmdReq.bits.sub_rob_id
        inBank   := command.op1_bank
        outBank  := command.wr_bank
        rows     := command.iter(countWidth + 1, 2) // capacity assert keeps iter <= 4*bankEntries
        line     := 0.U
        state    := waitForChannels
      }
    }

    is(waitForChannels) {
      when(io.channelReady)(state := readRequest)
    }

    is(readRequest) {
      io.bankRead(0).io.req.valid            := true.B
      when(io.bankRead(0).io.req.fire)(state := readResponse)
    }

    is(readResponse) {
      // SRAM read latency is one cycle: resp.valid arrives the cycle after
      // req.fire, never the same cycle.
      io.bankRead(0).io.resp.ready := true.B
      when(io.bankRead(0).io.resp.fire) {
        wordIn := io.bankRead(0).io.resp.bits.data
        state  := compute
      }
    }

    is(compute) {
      wordOut := tanhWord
      state   := writeRequest
    }

    is(writeRequest) {
      io.bankWrite(0).io.req.valid            := true.B
      when(io.bankWrite(0).io.req.fire)(state := writeResponse)
    }

    is(writeResponse) {
      io.bankWrite(0).io.resp.ready := true.B
      when(io.bankWrite(0).io.resp.fire) {
        when(line +& 1.U === rows) {
          state := complete
        }.otherwise {
          line  := line + 1.U
          state := readRequest
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
