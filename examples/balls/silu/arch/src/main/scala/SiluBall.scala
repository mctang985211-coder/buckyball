package examples.balls.silu

import chisel3._
import chisel3.experimental.hierarchy.{instantiable, public, Instance, Instantiate}
import framework.balldomain.blink.{BlinkIO, HasBallStatus, HasBlink, SubRobRow}
import framework.balldomain.blink.mmio.MmioRead
import framework.top.GlobalConfig

/**
 * SiluBall wrapper: y = x * sigmoid(x) elementwise fp32 (SwiGLU gate
 * activation, torch.nn.functional.silu semantics).  One SRAM read port and
 * one SRAM write port (inBW = 1 / outBW = 1); in_bank and out_bank must be
 * distinct single-group banks.  FQCN == the registered ballClass
 * "examples.balls.silu.SiluBall" (BBus instantiates by reflection).
 */
@instantiable
class SiluBall(val b: GlobalConfig) extends Module with HasBlink with HasBallStatus {

  private val mapping = b.ballDomain.ballIdMappings
    .find(_.ballName == "SiluBall")
    .getOrElse(throw new IllegalArgumentException("SiluBall not found in config"))

  @public
  val io = IO(new BlinkIO(b, mapping.inBW, mapping.outBW))

  def blink: BlinkIO = io
  def status = io.status
  dontTouch(io)

  val unit: Instance[Silu] = Instantiate(new Silu(b))
  unit.io.cmdReq <> io.cmdReq
  unit.io.cmdResp <> io.cmdResp
  unit.io.channelReady := io.channelReady
  unit.io.bankRead(0) <> io.bankRead(0)
  unit.io.bankWrite(0) <> io.bankWrite(0)
  io.status <> unit.io.status
  io.subRobReq.valid   := false.B
  io.subRobReq.bits    := SubRobRow.tieOff(b)
  MmioRead.tieOff(io.mmioRead)
}
