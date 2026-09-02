package examples.balls.sigmoid

import chisel3._
import chisel3.experimental.hierarchy.{instantiable, public}
import chisel3.util._
import framework.balldomain.blink.{BallStatus, BankRead, BankWrite}
import framework.balldomain.rs.{BallRsComplete, BallRsIssue}
import framework.top.GlobalConfig

/**
 * SIGMOID compute unit: y = 1 / (1 + exp(-x)), the exact form (reference:
 * torch.sigmoid). fp32 in / fp32 out, 4 fp32 lanes per 16B bank row, one row
 * read -> compute -> write per iteration into a distinct output bank.
 *
 * The datapath is the Q20 fixed-point pipeline validated offline: sigmoid is
 * computed through its odd symmetry sigmoid(x) = 0.5 * (1 + tanh(x / 2)), a
 * 20-segment quartic fit of tanh(z) on z in [0, 5) (segment 0.25, Horner with
 * arithmetic >>20 at every step), a bit-accurate fp32 decode/encode, and the
 * exact pass-through clamp |x| >= 10 (golden 1 - sigmoid(10) = 4.54e-5, far
 * below the 1e-4 ctest tolerance). Worst absolute error against the C golden
 * sigmoid_ref() over every fp32 point with exponent field 107..131 (the whole
 * region where any lane can disagree), plus dense segment-boundary and clamp
 * sweeps: 4.542e-05 (the clamp step at |x| = 10 itself).
 *
 * The fail-hard table is identical to examples/balls/sigmoid/emu/src/57_sigmoid.rs;
 * an undeclared funct7 never reaches this unit (the framework decoder asserts
 * on it and the dispatch chain panics in simulation).
 */
@instantiable
class Sigmoid(val b: GlobalConfig) extends Module {
  private val bankIdLen    = b.frontend.bank_id_len
  private val bankIdBits   = log2Up(b.memDomain.bankNum)
  private val addressWidth = log2Up(b.memDomain.bankEntries)
  private val countWidth   = log2Up(b.memDomain.bankEntries + 1)

  private val mapping = b.ballDomain.ballIdMappings
    .find(_.ballName == "SigmoidBall")
    .getOrElse(throw new IllegalArgumentException("SigmoidBall not found in config"))

  private val funct = b.ballDomain.ballISA
    .find(_.mnemonic == "SIGMOID")
    .map(_.funct7)
    .getOrElse(throw new IllegalArgumentException("SIGMOID not found in ballISA"))

  require(mapping.inBW == 1, "SigmoidBall requires one SRAM read port")
  require(mapping.outBW == 1, "SigmoidBall requires one SRAM write port")
  require(b.memDomain.bankWidth == 128, "SigmoidBall requires 128-bit SRAM rows")
  require(b.memDomain.bankMaskLen == 16, "SigmoidBall requires sixteen byte enables")

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
  // integer model (every fp32 point with exponent 107..131, both signs,
  // plus dense boundary/clamp sweeps: worst |hw - sigmoid_ref| = 4.542e-5,
  // tolerance 1e-4).
  // ------------------------------------------------------------------
  private val Q   = 20
  // The constant 2^20 must be a signed literal: asSInt on a UInt literal is
  // a bitcast of the canonicalized minWidth pattern ("h100000".U is 21 bits,
  // so asSInt yields -2^20 and pad(lit) is folded away as a value-preserving
  // no-op before the bitcast is re-applied). This was the Gelu.scala round-2
  // bug (PR #10); the netlist constants must be checked against this table.
  private val QB  = 1048576.S(22.W) // +2^20 as a signed literal, sign bit clear
  private val TH  = "h41200000".U   // 10.0f: smallest fp32 with |x| >= 10
  private val ONE = "h3f800000".U   // 1.0f, the positive-side clamp value

  // tanh(z) ~= c0 + c1*dz + c2*dz^2 + c3*dz^3 + c4*dz^4 on segment s,
  // z in [s*0.25, (s+1)*0.25), dz = z - s*0.25, all in Q20.
  private val Coefs = VecInit(Seq(
    Seq(1, 1048530, 1539, -367097, 82696),
    Seq(256817, 985666, -241033, -274291, 174817),
    Seq(484566, 824669, -381720, -91883, 144094),
    Seq(666003, 625587, -398094, 52550, 64019),
    Seq(798590, 440389, -335832, 113793, 3811),
    Seq(889490, 294041, -249569, 115291, -22161),
    Seq(949117, 189487, -171503, 92023, -26357),
    Seq(987104, 119340, -112288, 65346, -21864),
    Seq(1010857, 74081, -71360, 43498, -15717),
    Seq(1025535, 45576, -44530, 27891, -10509),
    Seq(1034541, 27883, -27480, 17492, -6750),
    Seq(1040041, 17001, -16843, 10826, -4236),
    Seq(1043391, 10346, -10283, 6647, -2623),
    Seq(1045428, 6288, -6260, 4061, -1611),
    Seq(1046666, 3818, -3807, 2471, -984),
    Seq(1047417, 2318, -2311, 1505, -600),
    Seq(1047873, 1407, -1403, 914, -365),
    Seq(1048150, 853, -852, 555, -222),
    Seq(1048318, 517, -517, 337, -135),
    Seq(1048419, 314, -313, 204, -82)
  ).map(row => VecInit(row.map(_.S(32.W)))))

  /** One fp32 -> fp32 sigmoid lane, the validated integer pipeline. */
  private def sigmoidLane(in: UInt): UInt = {
    val sign = in(31)
    val abs  = in(30, 0) // 31 bits
    val big  = abs >= TH // |x| >= 10.0f (also catches inf/nan bit patterns)

    val exp = abs(30, 23)             // 8 bits
    val man = abs(22, 0)              // 23 bits
    val v   = Cat(1.U(1.W), man)      // 24-bit 1.mantissa
    val xq  = v >> (130.U(8.W) - exp) // |x| * 2^20, floor
    // exp < 107 shifts the 24-bit v by >= 24 -> 0 (subnormals and
    // |x| < 2^-22 flush to zero, |sigmoid - 0.5| < 2^-22 there); exp in
    // 107..130 inside the clamp keeps the shift in 0..23 (exp == 130 is
    // exactly the [8,10) band below the clamp).

    val u   = xq >> 1                                // |x|/2, Q20, 23 bits
    val seg = Mux(u(22, 18) > 19.U, 19.U, u(22, 18)) // segment, saturated to 19
    val dz  = u - (seg << 18)                        // 23 bits

    val dzS = dz.asSInt
    val c   = Coefs(seg)
    def mul20(a: SInt, k: SInt): SInt = (a * k) >> Q // arithmetic shift = floor, as in validation
    val t = mul20(mul20(mul20(mul20(c(4), dzS) +& c(3), dzS) +& c(2), dzS) +& c(1), dzS) +& c(0)

    // sigmoid = 0.5 * (1 +/- tanh) in Q20; the table bounds keep
    // 0 <= t <= 2^20 for every non-clamped input, and QB is an explicitly
    // signed +2^20 literal, used directly.
    val phiS = Mux(sign, QB -& t, QB +& t) >> 1
    val yq   = phiS.asUInt(21, 0) // bounded by 2^21; see table bounds above

    val zeroY = 0.U(32.W)  // +0.0: sigmoid is strictly positive, never -0.0
    val nz    = phiS > 0.S // exact +0.0 otherwise (never taken in range)
    val msb   = WireInit(0.U(6.W))
    for (i <- 0 until yq.getWidth) { when(yq(i))(msb := i.U) }
    val mant     = (yq << (23.U(6.W) - msb))(22, 0)
    val normal   = Cat(0.U(1.W), (107.U +& msb)(7, 0), mant) // sign bit clear
    val computed = Mux(nz, normal, zeroY)

    // Clamp path: x >= 10 returns 1.0f exactly (golden 1 - 4.54e-5),
    // x <= -10 returns +0.0f (golden <= 4.54e-5); worst boundary error
    // 4.542e-5, inside the 1e-4 contract.
    Mux(big, Mux(sign, zeroY, ONE), computed)
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

  val lanesIn     = Seq.tabulate(4)(i => wordIn(32 * i + 31, 32 * i))
  val lanesOut    = lanesIn.map(sigmoidLane)
  val sigmoidWord = Cat(lanesOut.reverse)

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
        // Fail-hard table, identical to emu/src/57_sigmoid.rs decode_validate.
        assert(command.funct7 === funct.U(7.W), "SigmoidBall funct7 must be SIGMOID")
        assert(command.rs2 === 0.U, "sigmoid: reserved xs2 must be zero")
        assert(command.rs1(bankIdLen + 9, bankIdLen) === 0.U, "sigmoid: reserved rs1 BANK1 field must be zero")
        assert(command.rs1(bankIdLen - 1, bankIdBits) === 0.U, "sigmoid: invalid in_bank id")
        assert(command.rs1(2 * bankIdLen + 9, 2 * bankIdLen + bankIdBits) === 0.U, "sigmoid: invalid out_bank id")
        assert(command.iter =/= 0.U, "sigmoid: N must be positive")
        assert(command.iter(1, 0) === 0.U, "sigmoid: N must be a multiple of 4 (16B bank row)")
        assert(
          command.iter <= (4 * b.memDomain.bankEntries).U(b.frontend.iter_len.W),
          "sigmoid: N exceeds bank capacity (4 * bank lines)"
        )
        assert(command.op1_bank =/= command.wr_bank, "sigmoid: in_bank and out_bank must be distinct")
        assert(command.op1_col === 1.U, "sigmoid: in_bank not a single-group allocated bank")
        assert(command.wr_col === 1.U, "sigmoid: out_bank not a single-group allocated bank")

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
      wordOut := sigmoidWord
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
