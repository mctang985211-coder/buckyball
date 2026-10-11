package examples.balls.clamp

import chisel3._
import chisel3.experimental.hierarchy.{instantiable, public}
import chisel3.util._
import framework.balldomain.blink.{BallStatus, BankRead, BankWrite}
import framework.balldomain.rs.{BallRsComplete, BallRsIssue}
import framework.top.GlobalConfig

@instantiable
class Clamp(val b: GlobalConfig) extends Module {
  private val addressWidth = log2Up(b.memDomain.bankEntries)
  private val countWidth   = log2Up(b.memDomain.bankEntries + 1)
  private val bankIdWidth  = b.memDomain.vbankIdWidth

  private val mapping = b.ballDomain.ballIdMappings
    .find(_.ballName == "ClampBall")
    .getOrElse(throw new IllegalArgumentException("ClampBall not found in config"))

  private val funct = b.ballDomain.ballISA
    .find(_.mnemonic == "CLAMP")
    .map(_.funct7)
    .getOrElse(throw new IllegalArgumentException("CLAMP not found in ballISA"))

  require(mapping.inBW == 1 && mapping.outBW == 1, "ClampBall requires one read and one write port")
  require(b.memDomain.bankWidth == 128, "ClampBall requires 128-bit SRAM rows")
  require(b.memDomain.bankMaskLen == 16, "ClampBall requires sixteen byte enables")
  require(b.memDomain.bankEntries > 1, "ClampBall requires a usable bank depth")
  require(b.frontend.iter_len == 34, "ClampBall requires the public 34-bit element-count encoding")

  @public
  val io = IO(new Bundle {
    val cmdReq       = Flipped(Decoupled(new BallRsIssue(b)))
    val cmdResp      = Decoupled(new BallRsComplete(b))
    val channelReady = Input(Bool())
    val bankRead     = Vec(1, Flipped(new BankRead(b)))
    val bankWrite    = Vec(1, Flipped(new BankWrite(b)))
    val status       = new BallStatus
  })

  val Seq(idle, waitForChannels, readRequest, readResponse, writeRequest, writeResponse, complete) = Enum(7)
  val state                                                                                        = RegInit(idle)
  val robId                                                                                        = RegInit(0.U(log2Up(b.frontend.rob_entries).W))
  val isSub                                                                                        = RegInit(false.B)
  val subRobId                                                                                     = RegInit(0.U(log2Up(b.frontend.sub_rob_depth * 4).W))
  // Blink bank IDs are virtual; physical allocation remains backend-owned.
  val inputBank                                                                                    = RegInit(0.U(bankIdWidth.W))
  val outputBank                                                                                   = RegInit(0.U(bankIdWidth.W))
  val rows                                                                                         = RegInit(0.U(countWidth.W))
  val line                                                                                         = RegInit(0.U(addressWidth.W))
  val lo                                                                                           = RegInit(0.S(32.W))
  val hi                                                                                           = RegInit(0.S(32.W))
  val word                                                                                         = Reg(UInt(128.W))

  val lanes = Wire(Vec(4, UInt(32.W)))
  for (lane <- 0 until 4) {
    val x = word(32 * lane + 31, 32 * lane).asSInt
    lanes(lane) := Mux(x < lo, lo, Mux(x > hi, hi, x)).asUInt
  }

  io.cmdReq.ready            := state === idle
  io.cmdResp.valid           := state === complete
  io.cmdResp.bits.rob_id     := robId
  io.cmdResp.bits.is_sub     := isSub
  io.cmdResp.bits.sub_rob_id := subRobId

  io.bankRead(0).rob_id           := robId
  io.bankRead(0).ball_id          := 0.U
  io.bankRead(0).bank_id          := inputBank
  io.bankRead(0).group_id         := 0.U
  io.bankRead(0).io.req.valid     := state === readRequest
  io.bankRead(0).io.req.bits.addr := line
  io.bankRead(0).io.resp.ready    := state === readResponse

  io.bankWrite(0).rob_id           := robId
  io.bankWrite(0).ball_id          := 0.U
  io.bankWrite(0).bank_id          := outputBank
  io.bankWrite(0).group_id         := 0.U
  io.bankWrite(0).io.req.valid     := state === writeRequest
  io.bankWrite(0).io.req.bits.addr := line
  io.bankWrite(0).io.req.bits.data := Cat(lanes.reverse)
  io.bankWrite(0).io.req.bits.mask := VecInit(Seq.fill(16)(true.B))
  io.bankWrite(0).io.resp.ready    := state === writeResponse

  switch(state) {
    is(idle) {
      when(io.cmdReq.fire) {
        val command   = io.cmdReq.bits.cmd
        val rawInput  = command.rs1(9, 0)
        val rawOutput = command.rs1(29, 20)
        val n         = command.rs1(63, 30)
        val lower     = command.rs2(31, 0).asSInt
        val upper     = command.rs2(63, 32).asSInt
        assert(command.funct7 === funct.U(7.W), "ClampBall funct7 must be CLAMP")
        assert(command.op1_en && !command.op2_en && command.wr_spad_en, "clamp: requires one input and one output")
        assert(command.rs1(19, 10) === 0.U, "clamp: reserved BANK1 must be zero")
        // Check the full fields before narrowed virtual IDs enter registers.
        assert(rawInput < b.memDomain.bankNum.U, "clamp: input bank out of range")
        assert(rawOutput < b.memDomain.bankNum.U, "clamp: output bank out of range")
        assert(rawInput =/= rawOutput && command.op1_bank =/= command.wr_bank, "clamp: banks must be distinct")
        assert(n =/= 0.U, "clamp: N must be positive")
        assert(n(1, 0) === 0.U, "clamp: N must be a multiple of 4")
        assert(n <= (4 * b.memDomain.bankEntries).U, "clamp: N exceeds bank capacity")
        assert(command.iter === n, "clamp: decoded N must match raw encoding")
        assert(
          command.op1_bank === rawInput && command.wr_bank === rawOutput,
          "clamp: decoded bank IDs must match raw encoding"
        )
        assert(lower <= upper, "clamp: lo must not exceed hi")
        assert(command.op1_col =/= 0.U, "clamp: input bank not allocated")
        assert(command.wr_col =/= 0.U, "clamp: output bank not allocated")
        assert(command.op1_col === 1.U, "clamp: input bank must be single group")
        assert(command.wr_col === 1.U, "clamp: output bank must be single group")

        robId      := io.cmdReq.bits.rob_id
        isSub      := io.cmdReq.bits.is_sub
        subRobId   := io.cmdReq.bits.sub_rob_id
        inputBank  := command.op1_bank
        outputBank := command.wr_bank
        rows       := n >> 2
        lo         := lower
        hi         := upper
        line       := 0.U
        state      := waitForChannels
      }
    }
    is(waitForChannels) {
      when(io.channelReady)(state := readRequest)
    }
    is(readRequest) {
      when(io.bankRead(0).io.req.fire)(state := readResponse)
    }
    is(readResponse) {
      when(io.bankRead(0).io.resp.fire) {
        word  := io.bankRead(0).io.resp.bits.data
        state := writeRequest
      }
    }
    is(writeRequest) {
      when(io.bankWrite(0).io.req.fire)(state := writeResponse)
    }
    is(writeResponse) {
      when(io.bankWrite(0).io.resp.fire) {
        assert(io.bankWrite(0).io.resp.bits.ok, "clamp: SRAM write failed")
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
