package examples.legacy_clamp_v1

import org.chipsalliance.cde.config.Config
import framework.system.tile.WithBuckyballTiles

/**
 * Independent experiment: one tile, one Pebble core, eight explicitly registered Balls.
 */
class BuckyballLegacyClampV1Config
    extends Config(
      new WithBuckyballTiles("../examples/chips/legacy_clamp_v1/configs/generated/chip.pb") ++
        new chipyard.config.WithSystemBusWidth(128) ++
        new sims.base.BuckyballBaseConfig
    )

class RocketOnlyLegacyClampV1Config
    extends Config(
      new WithBuckyballTiles(
        "../examples/chips/legacy_clamp_v1/configs/generated/chip.pb",
        withBuckyball = false
      ) ++
        new chipyard.config.WithSystemBusWidth(128) ++
        new sims.base.BuckyballBaseConfig
    )
