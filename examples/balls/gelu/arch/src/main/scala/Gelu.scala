package examples.balls.gelu

import chisel3._
import chisel3.experimental.hierarchy.{instantiable, public}
import chisel3.util._
import framework.balldomain.blink.{BallStatus, BankRead, BankWrite}
import framework.balldomain.rs.{BallRsComplete, BallRsIssue}
import framework.top.GlobalConfig

/**
 * GELU compute unit: y = x * Phi(x), Phi(x) = 0.5 * (1 + erf(x / sqrt(2)))
 * with the exact-erf form (reference: torch.nn.functional.gelu(approximate=
 * 'none'), never the tanh approximation). fp32 in / fp32 out, 4 fp32 lanes
 * per 16B bank row, one row read -> compute -> write per iteration into a
 * distinct output bank.
 *
 * The datapath is the Q20 fixed-point pipeline validated offline: a 16-segment
 * quartic fit of erf(z) on z in [0, 4) (segment 0.25, Horner with arithmetic
 * >>20 at every step), a bit-accurate fp32 decode/encode, and the exact-
 * pass-through clamp |x| >= 4*sqrt(2) (golden erfc there is < 1.6e-8, far
 * below the 1e-4 ctest tolerance). Worst absolute error against the C golden
 * gelu_ref() over 542M exhaustive fp32 points plus dense boundary/threshold
 * sweeps: 7.2e-6.
 *
 * The fail-hard table is identical to examples/balls/gelu/emu/src/56_gelu.rs;
 * an undeclared funct7 never reaches this unit (the framework decoder asserts
 * on it and the dispatch chain panics in simulation).
 */
@instantiable
class Gelu(val b: GlobalConfig) extends Module {
  private val bankIdLen    = b.frontend.bank_id_len
  private val bankIdBits   = log2Up(b.memDomain.bankNum)
  private val addressWidth = log2Up(b.memDomain.bankEntries)
  private val countWidth   = log2Up(b.memDomain.bankEntries + 1)

  private val mapping = b.ballDomain.ballIdMappings
    .find(_.ballName == "GeluBall")
    .getOrElse(throw new IllegalArgumentException("GeluBall not found in config"))

  private val funct = b.ballDomain.ballISA
    .find(_.mnemonic == "GELU")
    .map(_.funct7)
    .getOrElse(throw new IllegalArgumentException("GELU not found in ballISA"))

  require(mapping.inBW == 1, "GeluBall requires one SRAM read port")
  require(mapping.outBW == 1, "GeluBall requires one SRAM write port")
  require(b.memDomain.bankWidth == 128, "GeluBall requires 128-bit SRAM rows")
  require(b.memDomain.bankMaskLen == 16, "GeluBall requires sixteen byte enables")

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
  // integer model (542M exhaustive fp32 points plus dense boundary and
  // threshold sweeps: worst |hw - gelu_ref| = 7.2e-6, tolerance 1e-4).
  // ------------------------------------------------------------------
  private val Q   = 20
  private val QB  = "h100000".U   // 2^20
  private val CR2 = 741455.U      // round(2^20 / sqrt(2))
  private val TH  = "h40b504f3".U // smallest fp32 with |x| >= 4*sqrt(2)

  // erf(z) ~= c0 + c1*dz + c2*dz^2 + c3*dz^3 + c4*dz^4 on
  // z in [16*0.25, 16*0.25 + 0.25), dz = z - seg*0.25, all in Q20.
  private val Coefs = VecInit(Seq(
    Seq(0, 1183155, 1262, -409303, 70736),
    Seq(289749, 1111487, -277226, -332014, 173325),
    Seq(545784, 921480, -461022, -150870, 183876),
    Seq(745701, 674188, -506465, 37324, 117538),
    Seq(883636, 435298, -436079, 154219, 29784),
    Seq(967731, 248024, -310443, 180670, -31339),
    Seq(1013035, 124708, -187111, 146223, -51694),
    Seq(1034600, 55333, -96702, 93043, -44195),
    Seq(1043671, 21666, -43178, 48739, -27694),
    Seq(1047042, 7486, -16738, 21495, -13861),
    Seq(1048149, 2283, -5652, 8083, -5742),
    Seq(1048470, 614, -1667, 2613, -2006),
    Seq(1048553, 146, -430, 731, -597),
    Seq(1048571, 31, -97, 177, -153),
    Seq(1048575, 6, -19, 37, -34),
    Seq(1048576, 1, -3, 7, -6)
  ).map(row => VecInit(row.map(_.S(32.W)))))

  /** One fp32 -> fp32 gelu lane, the validated integer pipeline. */
  private def geluLane(in: UInt): UInt = {
    val sign = in(31)
    val abs  = in(30, 0) // 31 bits
    val big  = abs >= TH // |x| >= 4*sqrt(2) (also catches inf/nan bit patterns)

    val exp = abs(30, 23)             // 8 bits
    val man = abs(22, 0)              // 23 bits
    val v   = Cat(1.U(1.W), man)      // 24-bit 1.mantissa
    val xq  = v >> (130.U(8.W) - exp) // |x| * 2^20, floor
    // exp < 107 shifts the 24-bit v by >= 24 -> 0 (subnormals and
    // |x| < 2^-22 flush to zero, |gelu| < 6e-7 there); exp <= 129 inside
    // the clamp keeps the shift in 1..23.

    val zq  = (xq * CR2) >> Q                          // z = x/sqrt(2), Q20, 24 bits
    val seg = Mux(zq(23, 18) > 15.U, 15.U, zq(23, 18)) // segment, saturated to 15
    val dz  = zq - (seg << 18)                         // 24 bits

    val dzS = dz.asSInt
    val c   = Coefs(seg)
    def mul20(a: SInt, k: SInt): SInt = (a * k) >> Q // arithmetic shift = floor, as in validation
    val e = mul20(mul20(mul20(mul20(c(4), dzS) +& c(3), dzS) +& c(2), dzS) +& c(1), dzS) +& c(0)

    // Phi = 0.5*(1 + sign*erf) in Q20; |erf| <= 1 so Phi in [0, 2^20].
    // QB is a 21-bit literal of 2^20: asSInt would reinterpret it as
    // -2^20, so pad one 0 bit first to keep the value signed-positive.
    val qbS = QB.pad(1).asSInt
    val phi = Mux(sign, qbS -& e, qbS +& e) >> 1
    val yq  = (xq * phi.asUInt) >> Q // |y| in Q20, 24 bits

    val zeroY = Cat(sign, 0.U(31.W)) // +/-0.0
    val nz    = yq =/= 0.U
    val msb   = WireInit(0.U(6.W))
    for (i <- 0 until yq.getWidth) { when(yq(i))(msb := i.U) }
    val mant     = (yq << (23.U(6.W) - msb))(22, 0)
    val normal   = Cat(sign, (107.U +& msb)(7, 0), mant)
    val computed = Mux(nz, normal, zeroY)

    // Clamp path: positive x returns x exactly (golden Phi = 1 - <1.6e-8),
    // negative x returns -0.0 (golden |x*Phi| < 5e-8).
    Mux(big, Mux(sign, zeroY, in), computed)
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
  val lanesOut = lanesIn.map(geluLane)
  val geluWord = Cat(lanesOut.reverse)

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
        // Fail-hard table, identical to emu/src/56_gelu.rs decode_validate.
        assert(command.funct7 === funct.U(7.W), "GeluBall funct7 must be GELU")
        assert(command.rs2 === 0.U, "gelu: reserved xs2 must be zero")
        assert(command.rs1(bankIdLen + 9, bankIdLen) === 0.U, "gelu: reserved rs1 BANK1 field must be zero")
        assert(command.rs1(bankIdLen - 1, bankIdBits) === 0.U, "gelu: invalid in_bank id")
        assert(command.rs1(2 * bankIdLen + 9, 2 * bankIdLen + bankIdBits) === 0.U, "gelu: invalid out_bank id")
        assert(command.iter =/= 0.U, "gelu: N must be positive")
        assert(command.iter(1, 0) === 0.U, "gelu: N must be a multiple of 4 (16B bank row)")
        assert(
          command.iter <= (4 * b.memDomain.bankEntries).U(b.frontend.iter_len.W),
          "gelu: N exceeds bank capacity (4 * bank lines)"
        )
        assert(command.op1_bank =/= command.wr_bank, "gelu: in_bank and out_bank must be distinct")
        assert(command.op1_col === 1.U, "gelu: in_bank not a single-group allocated bank")
        assert(command.wr_col === 1.U, "gelu: out_bank not a single-group allocated bank")

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
      wordOut := geluWord
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
