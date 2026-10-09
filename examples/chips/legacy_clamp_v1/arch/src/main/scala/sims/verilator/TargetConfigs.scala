package sims.verilator

import org.chipsalliance.cde.config.Config

class BuckyballLegacyClampV1VerilatorConfig
    extends Config(
      new BBSimConfig ++
        new WithCustomBootROM ++
        new examples.legacy_clamp_v1.BuckyballLegacyClampV1Config
    )

class BuckyballLegacyClampV1RushBVerilatorConfig
    extends Config(
      new WithBuckyballRushB ++
        new BBSimConfig ++
        new WithCustomBootROM ++
        new examples.legacy_clamp_v1.BuckyballLegacyClampV1Config
    )
