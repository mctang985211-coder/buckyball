package sims.p2e

import org.chipsalliance.cde.config.Config

class P2ELegacyClampV1Config
    extends Config(
      new P2EBaseConfig ++
        new examples.legacy_clamp_v1.BuckyballLegacyClampV1Config
    )

class P2ELegacyClampV1LinuxConfig
    extends Config(
      new WithLinuxBootROM ++
        new P2EBaseConfig ++
        new examples.legacy_clamp_v1.BuckyballLegacyClampV1Config
    )
