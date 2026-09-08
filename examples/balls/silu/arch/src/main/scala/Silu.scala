package examples.balls.silu

import chisel3._
import chisel3.experimental.hierarchy.{instantiable, public}
import chisel3.util._
import framework.balldomain.blink.{BallStatus, BankRead, BankWrite}
import framework.balldomain.rs.{BallRsComplete, BallRsIssue}
import framework.top.GlobalConfig

/**
 * SILU compute unit: y = x * sigmoid(x), the exact form (reference:
 * torch.nn.functional.silu / transformers LlamaMLP hidden_act silu). fp32 in
 * / fp32 out, 4 fp32 lanes per 16B bank row, one row read -> compute -> write
 * per iteration into a distinct output bank (in-place never happens).
 *
 * Region geometry: single-group (cols = 1) in/out bank allocations of up to
 * bankEntries lines each; n = iter fp32 elements, n in [4, 4*bankEntries]
 * with n % 4 == 0, in/out banks distinct.
 *
 * Datapath (per lane, Q24 fixed point): sigma(a) = 1/(1+exp(-a)) for a = |x|
 * is evaluated by a piecewise cubic fit on 64 uniform segments of width 0.25
 * over a in [0, 16) (coefficients below, Q24); y = x * sigma(a) on the
 * positive side and y = -a * (1 - sigma(a)) on the negative side (exact
 * identity sigma(-a) = 1 - sigma(a)).  Saturation: |x| >= 16 returns x
 * exactly (x > 0; the golden y = x - x*exp(-a) rounds to x in fp32 there)
 * or -0.0 (x < 0; golden |y| <= max(a*exp(-a), a*exp(-100)) with a = |x|:
 * 16*exp(-16) ~ 1.8e-6 in the computed band, the emu a=100 clamp bounds the
 * rest by FLT_MAX*exp(-100) ~ 1.3e-5); exp == 255 (inf/NaN) passes x
 * passes x through unchanged (inf behaves like the emu saturation, NaN is
 * outside the contract).  The integer pipeline below is bit-identical to the
 * offline validator (silu_hw_check.c mirror), which checked every fp32 bit
 * pattern against the ctest/emu golden silu_ref(): worst |hw - golden| =
 * 1.27e-5 < 1e-4 (the saturation step at x = -FLT_MAX itself), sigma_q stays
 * in [2^23 - 2, 2^24 - 2].
 *
 * The fail-hard table mirrors emu/src/59_silu.rs decode_validate (identical
 * panic semantics: reserved fields, N domain, bank range, single-group
 * cols, distinct in/out); an undeclared funct7 never reaches this unit (the
 * framework decoder asserts on it and the dispatch chain panics).
 */
@instantiable
class Silu(val b: GlobalConfig) extends Module {
  private val bankIdBits = log2Up(b.memDomain.bankNum)
  private val addrBits   = log2Up(b.memDomain.bankEntries)
  private val countWidth = log2Up(b.memDomain.bankEntries + 1)

  private val mapping = b.ballDomain.ballIdMappings
    .find(_.ballName == "SiluBall")
    .getOrElse(throw new IllegalArgumentException("SiluBall not found in config"))

  private val funct = b.ballDomain.ballISA
    .find(_.mnemonic == "SILU")
    .map(_.funct7)
    .getOrElse(throw new IllegalArgumentException("SILU not found in ballISA"))

  require(mapping.inBW == 1, "SiluBall requires one SRAM read port")
  require(mapping.outBW == 1, "SiluBall requires one SRAM write port")
  require(b.memDomain.bankWidth == 128, "SiluBall requires 128-bit SRAM rows")
  require(b.memDomain.bankMaskLen == 16, "SiluBall requires sixteen byte enables")

  @public
  val io = IO(new Bundle {
    val cmdReq       = Flipped(Decoupled(new BallRsIssue(b)))
    val cmdResp      = Decoupled(new BallRsComplete(b))
    val channelReady = Input(Bool())
    val bankRead     = Vec(1, Flipped(new BankRead(b)))
    val bankWrite    = Vec(1, Flipped(new BankWrite(b)))
    val status       = new BallStatus
  })

  private val Q  = 24
  private val Q1 = 1 << Q // 2^24: Q24 unit, also 1.0 in sigma scale

  // Piecewise-cubic sigma table, segment s covers a in [s*0.25, (s+1)*0.25),
  // sigma(a) = c0 + dz*(c1 + dz*(c2 + dz*c3))>>24>>24>>24 with dz in
  // [0, 2^22) = Q24 units of (a - s*0.25); coefficients Q24 (see class doc
  // for the offline validation evidence).
  private val Coefs = VecInit(Seq(
    Seq(8388606, 4194384, -1287, -343508),
    Seq(9431751, 4129697, -261165, -302300),
    Seq(10443128, 3943071, -489293, -230010),
    Seq(11394721, 3656069, -662171, -142815),
    Seq(12265121, 3298964, -768766, -57164),
    Seq(13040922, 2904503, -810577, 14805),
    Seq(13716619, 2502457, -798235, 67087),
    Seq(14293394, 2116205, -746777, 99139),
    Seq(14777321, 1761539, -671521, 113925),
    Seq(15177518, 1447158, -585453, 115890),
    Seq(15504526, 1176106, -498159, 109498),
    Seq(15769129, 947460, -415850, 98453),
    Seq(15981543, 757879, -341957, 85461),
    Seq(16150974, 602808, -277888, 72296),
    Seq(16285438, 477310, -223737, 59993),
    Seq(16391719, 376593, -178832, 49063),
    Seq(16475457, 296292, -142128, 39680),
    Seq(16541267, 232598, -112455, 31820),
    Seq(16592885, 182279, -88668, 25349),
    Seq(16633309, 142651, -69723, 20093),
    Seq(16664928, 111519, -54709, 15863),
    Seq(16689636, 87108, -42857, 12486),
    Seq(16708931, 67997, -33530, 9805),
    Seq(16723986, 53051, -26206, 7685),
    Seq(16735731, 41374, -20466, 6015),
    Seq(16744890, 32258, -15973, 4703),
    Seq(16752029, 25144, -12461, 3674),
    Seq(16757594, 19595, -9717, 2868),
    Seq(16761930, 15268, -7575, 2238),
    Seq(16765310, 11896, -5904, 1745),
    Seq(16767941, 9267, -4601, 1361),
    Seq(16769991, 7219, -3585, 1061),
    Seq(16771589, 5623, -2793, 827),
    Seq(16772833, 4380, -2176, 644),
    Seq(16773802, 3412, -1695, 502),
    Seq(16774557, 2657, -1320, 391),
    Seq(16775146, 2070, -1028, 305),
    Seq(16775604, 1612, -801, 237),
    Seq(16775959, 1255, -624, 185),
    Seq(16776237, 978, -486, 144),
    Seq(16776453, 761, -378, 112),
    Seq(16776622, 593, -295, 87),
    Seq(16776753, 462, -230, 68),
    Seq(16776855, 360, -179, 53),
    Seq(16776935, 280, -139, 41),
    Seq(16776997, 218, -108, 32),
    Seq(16777045, 170, -84, 25),
    Seq(16777084, 132, -66, 19),
    Seq(16777112, 103, -51, 15),
    Seq(16777135, 80, -40, 12),
    Seq(16777152, 63, -31, 9),
    Seq(16777166, 49, -24, 7),
    Seq(16777177, 38, -19, 6),
    Seq(16777185, 30, -15, 4),
    Seq(16777192, 23, -11, 3),
    Seq(16777197, 18, -9, 3),
    Seq(16777201, 14, -7, 2),
    Seq(16777204, 11, -5, 2),
    Seq(16777208, 8, -4, 1),
    Seq(16777208, 7, -3, 1),
    Seq(16777210, 5, -3, 1),
    Seq(16777211, 4, -2, 1),
    Seq(16777213, 3, -2, 0),
    Seq(16777214, 2, -1, 0)
  ).map(r => VecInit(r.map(_.S(32.W)))))

  /** One fp32 -> fp32 silu lane, the validated integer pipeline. */
  private def siluLane(in: UInt): UInt = {
    val sign = in(31)
    val exp  = in(30, 23)

    val zero   = Cat(sign, 0.U(31.W))             // +/-0.0
    val infNan = exp === 255.U
    val big    = exp >= 131.U                     // |x| >= 16.0
    // a_q = floor(|x| * 2^24) for |x| < 16: v = 1.mantissa decoded by the
    // exponent field (exp <= 102 or subnormal: a_q = 0, |y| < 1e-4 there).
    val v      = Cat(1.U(1.W), in(22, 0))
    val shR    = 126.U(8.W) - exp                 // right shifts for exp in [1, 126]
    val aR     = (v.pad(32) >> Mux(shR >= 24.U, 24.U, shR))(27, 0)
    val aL     = Mux(
      exp === 127.U,
      v << 1,
      Mux(exp === 128.U, v << 2, Mux(exp === 129.U, v << 3, Mux(exp === 130.U, v << 4, 0.U(28.W))))
    )
    val aQ     = Mux(exp >= 127.U, aL(27, 0), aR) // exp <= 102: aR = 0
    val s      = aQ(27, 22)
    val dz     = aQ(21, 0)
    val dzS    = dz.zext
    val c      = Coefs(s)
    var acc    = c(3)
    acc = ((acc * dzS) >> Q) + c(2)
    acc = ((acc * dzS) >> Q) + c(1)
    acc = ((acc * dzS) >> Q) + c(0)
    val sigmaQ = acc.asUInt                       // >= 2^23 - 2, <= 2^24 - 2 (validated range)

    val yq = Mux(
      sign,
      (aQ * (Q1.U - sigmaQ)) >> Q, // -a * (1 - sigma(a))
      (aQ * sigmaQ) >> Q           // +a * sigma(a)
    )

    // fp32 encode of |y| = yq * 2^-24 with round-half-up at the 24th
    // mantissa bit; yq in [0, 2^28).
    val nz       = yq =/= 0.U
    val pe       = PriorityEncoder(Reverse(yq(27, 0)))
    val m        = 27.U - pe                         // msb index of yq
    val e8       = (103.U +& m)(7, 0)
    val bigF     = m >= 23.U
    val hi       = (yq.pad(32) >> (m - 23.U))(23, 0) // m >= 23: bits m-1..m-23
    val sm       = (yq.pad(32) << (23.U - m))(22, 0) // m <= 23: exact mantissa
    val mant0    = Mux(bigF, hi(22, 0), sm)
    val rbit     = (m >= 24.U) && (yq >> (m - 24.U))(0)
    val manC     = mant0 +& rbit
    val e8f      = (e8 +& manC(23))(7, 0)
    val computed = Mux(nz, Cat(sign, e8f(7, 0), manC(22, 0)), zero)

    // Clamp path: |x| >= 16 with x > 0 returns x exactly (golden rounds to
    // x for a >= 16.6); x < 0 returns -0.0 (golden |y| <= 1.8e-6 in the
    // [16,100) band and <= 1.3e-5 beyond it via the emu a=100 clamp);
    // inf/NaN pass through unchanged (inf mirrors the emu saturation, NaN
    // is outside the contract).
    Mux(infNan, in, Mux(big, Mux(sign, zero, in), computed))
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
  val line     = RegInit(0.U(countWidth.W))
  val wordIn   = Reg(UInt(128.W))
  val wordOut  = Reg(UInt(128.W))

  val lanesIn  = Seq.tabulate(4)(i => wordIn(32 * i + 31, 32 * i))
  val lanesOut = lanesIn.map(siluLane)
  val siluWord = Cat(lanesOut.reverse)

  io.cmdReq.ready            := state === idle
  io.cmdResp.valid           := state === complete
  io.cmdResp.bits.rob_id     := robId
  io.cmdResp.bits.is_sub     := isSub
  io.cmdResp.bits.sub_rob_id := subRobId

  io.bankRead(0).rob_id           := robId
  io.bankRead(0).ball_id          := 0.U
  io.bankRead(0).bank_id          := inBank
  io.bankRead(0).group_id         := 0.U // single-group allocation
  io.bankRead(0).io.req.valid     := false.B
  io.bankRead(0).io.req.bits.addr := line(addrBits - 1, 0)
  io.bankRead(0).io.resp.ready    := false.B

  io.bankWrite(0).rob_id           := robId
  io.bankWrite(0).ball_id          := 0.U
  io.bankWrite(0).bank_id          := outBank
  io.bankWrite(0).group_id         := 0.U // single-group allocation
  io.bankWrite(0).io.req.valid     := false.B
  io.bankWrite(0).io.req.bits.addr := line(addrBits - 1, 0)
  io.bankWrite(0).io.req.bits.data := wordOut
  io.bankWrite(0).io.req.bits.mask := VecInit(Seq.fill(b.memDomain.bankMaskLen)(true.B))
  io.bankWrite(0).io.resp.ready    := false.B

  switch(state) {
    is(idle) {
      when(io.cmdReq.fire) {
        val command = io.cmdReq.bits.cmd
        // Fail-hard table, identical to emu/src/59_silu.rs decode_validate.
        assert(command.funct7 === funct.U(7.W), "SiluBall funct7 must be SILU")
        assert(command.rs2 === 0.U, "silu: reserved xs2 must be zero")
        assert(command.rs1(19, 10) === 0.U, "silu: reserved rs1 BANK1 field must be zero")
        assert(command.rs1(9, 0) < b.memDomain.bankNum.U, "silu: invalid in_bank id")
        assert(command.rs1(29, 20) < b.memDomain.bankNum.U, "silu: invalid out_bank id")
        assert(command.iter =/= 0.U, "silu: N must be positive")
        assert(command.iter(1, 0) === 0.U, "silu: N must be a multiple of 4 (16B bank row)")
        assert(
          command.iter <= (4 * b.memDomain.bankEntries).U(b.frontend.iter_len.W),
          "silu: N exceeds bank capacity (4 * bank lines)"
        )
        assert(command.op1_bank =/= command.wr_bank, "silu: in_bank and out_bank must be distinct")
        assert(command.op1_col === 1.U, "silu: in_bank not a single-group allocated bank")
        assert(command.wr_col === 1.U, "silu: out_bank not a single-group allocated bank")

        // Latch every cmdReq field on fire (incl. rob_id).
        robId    := io.cmdReq.bits.rob_id
        isSub    := io.cmdReq.bits.is_sub
        subRobId := io.cmdReq.bits.sub_rob_id
        inBank   := command.op1_bank
        outBank  := command.wr_bank
        rows     := (command.iter >> 2)(countWidth - 1, 0) // n/4 lines
        line     := 0.U
        state    := waitForChannels
      }
    }

    is(waitForChannels) {
      when(io.channelReady)(state := readRequest)
    }

    is(readRequest) {
      when(io.channelReady) {
        io.bankRead(0).io.req.valid            := true.B
        when(io.bankRead(0).io.req.fire)(state := readResponse)
      }
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
      wordOut := siluWord
      state   := writeRequest
    }

    is(writeRequest) {
      when(io.channelReady) {
        io.bankWrite(0).io.req.valid            := true.B
        when(io.bankWrite(0).io.req.fire)(state := writeResponse)
      }
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
