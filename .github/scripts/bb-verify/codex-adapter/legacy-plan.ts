/**
 * `buckyball_bbdev_plan` — the single form that turns (stage, phase, layer,
 * chip, stems, models, probeBudget) into the ordered bbdev command sequence.
 *
 * The command order mirrors the upstream non-rushB chip-check chain of
 * $BB/.github/workflows/check.yaml (config install → compiler build → workload
 * clean → workload build → bemu elf batch → bemu pk batch → verilator
 * clean/verilog/build/elf batch). The sequence is kept as a static mapping in
 * code, NOT parsed from check.yaml at plan time: the plan's stage×phase×layer
 * legs (skeleton/slices/integrate/bind, c-bemu/rtl, probe pairs, the
 * compilerTouched prerequisite) do not exist upstream, a workflow-YAML parser
 * with matrix-expansion would be a large brittle abstraction for the one leg
 * that does, and the lanes are already gated on the tree (`examples/chips/<c>/
 * regression/batch/<backend>/workloads-<elf|pk>.toml` existsSync + the
 * bind leg's KERNEL_MODELS, read at plan time). The mapping's alignment with
 * check.yaml is a documented contract, not a machine assertion — how to
 * re-check it lives in the verification knowledge base (the `bb-knowledge`
 * skill, topic `verify/plan-mapping.md`); line numbers are intentionally not referenced (they move
 * with every commit; the *paths* here are stable).
 *
 * The chip/bind leg mirrors the other upstream chain it is graded against,
 * regression.yml's paired run: per declared model, `workload --build --model`
 * is immediately followed by `kernel --build --model`, and both precede every
 * probe step. The kernel half is gated on the model being one of the kernel
 * lane's own `KERNEL_MODELS` (read from the tree at plan time, path
 * `bbdev/api/steps/kernel/01_build_event.step.py`): `kernel_model()` raises
 * `unknown kernel model` for anything else, so a kernel step off another model
 * is a guaranteed-red run rather than a finding — the pair is skipped and the
 * reason is written into the model's workload step note. The pairing is NOT
 * justified by the probe sims: `--pk` is bemu's IN-PROCESS proxy kernel
 * (`bebop` sources, trap handler / page tables / stack built inside the
 * emulator), it never boots a `fw_payload`; that image's only consumer is the
 * p2e lane (`bebop-p2e --runworkload/--batch`), which this verification surface
 * deliberately does not open. A verilator pk batch is never generated as a
 * SCOPE RULING, not a lane-status claim: upstream runs
 * `bebop-verilator --batch --test elf-tests` in the non-rushB chain and reaches
 * `--test pk-tests` for verilator only inside the rushB step, which is gated on
 * `enable_rushb`. Neither verify-runner layer enters the rushB space, so no
 * verilator pk command is produced. Upstream DOES register the verilator pk
 * lane (`examples/chips/<chip>/regression/batch/verilator/workloads-pk.toml`);
 * that registration is simply outside the space this plan covers.
 *
 * Batch commands are additionally gated on the lane's real availability: the
 * generated `<backend>/<elf|pk>` toml must exist under
 * `examples/chips/<chip>/regression/batch/`. goban/poly carry no `regression/`
 * directory and multi-rocket has no pk toml, so those lanes are dropped from
 * the sequence and reported in `skippedLanes` rather than submitted into a
 * guaranteed-not-found run. Unknown stage/phase combinations throw.
 * @module dsh-verify-runner/tools/bbdev-plan
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source of the kernel lane's own model whitelist, read at plan time (the path
 * is stable; the SET IS NOT — it is upstream data, so it is never copied into
 * this file). `MODEL_LAYOUT` (the workload lane) is the wider set; every model
 * outside this one makes `bbdev kernel --build` raise `unknown kernel model`
 * (the kernel step source's own `kernel_model()`), so the bind leg may only
 * pair a kernel step with models listed here. Mirrors how `scripts/manifest.mjs`
 * reads `MODEL_LAYOUT`/`_MODELS` straight from the checkout: the tree is the
 * fact source, a missing or unparseable literal is an error, never a default.
 */
const KERNEL_MODELS_SOURCE = 'bbdev/api/steps/kernel/01_build_event.step.py'

/** Legal phase values per stage (phased-delivery contract). */
const STAGE_PHASES: Readonly<Record<string, readonly string[]>> = {
  workload: [],
  ball: ['c-bemu', 'rtl'],
  chip: ['skeleton', 'slices', 'integrate', 'bind'],
}

/**
 * Read `KERNEL_MODELS` out of the checked-out bbdev source. Throws on any of the
 * unexpected shapes: an unreadable file, a missing literal, or an empty set.
 */
function readKernelModels(repoPath: string): ReadonlySet<string> {
  const source = join(repoPath, KERNEL_MODELS_SOURCE)
  let text: string
  try {
    text = readFileSync(source, 'utf8')
  } catch (error) {
    // Fail-hard with attribution: the kernel whitelist has no second source, so
    // an unreadable tree is the plan's own error, never a silently different step set.
    throw new Error(
      `buckyball_bbdev_plan: cannot read KERNEL_MODELS from ${source} to gate the bind leg's` +
        ` kernel step: ${(error as Error).message}`,
    )
  }
  const block = text.match(/KERNEL_MODELS\s*=\s*\{([\s\S]*?)\n\}/)
  if (block === null) {
    throw new Error(`buckyball_bbdev_plan: KERNEL_MODELS literal not found in ${source}`)
  }
  const models = new Set([...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]))
  if (models.size === 0) {
    throw new Error(`buckyball_bbdev_plan: KERNEL_MODELS parsed empty from ${source}`)
  }
  return models
}

/**
 * Named phases whose sequence contains probe steps, i.e. the phases that
 * consume a `probe:` declaration. The no-phase v1 baseline consumes probes too,
 * but only alongside declared models (its `modelCoverage` leg) — that case is
 * judged where it happens, not here. Mirrors `PROBE_PHASES` in
 * scripts/manifest.mjs (this module is the built bundle and cannot import the
 * CI scripts, so the two stay in sync by contract, same as `STAGE_PHASES`).
 */
const PROBE_PHASES: ReadonlySet<string> = new Set(['c-bemu', 'bind'])

/** One ordered plan step: exactly what `buckyball_bbdev_submit` consumes. */
interface PlanStep {
  seq: number
  command: string
  operation: string
  args: string
  note?: string
}

/** One batch lane that exists upstream but not for this chip. */
interface SkippedLane {
  lane: string
  toml: string
  reason: string
}

/** One probe declaration the plan did NOT turn into a sim+analysis pair. */
interface SkippedProbe {
  stem: string
  minutes?: number
  reason: string
}

/** The plan tool's whole answer: the ordered sequence plus the pruned lanes. */
interface PlanResult {
  steps: PlanStep[]
  skippedLanes: SkippedLane[]
  /**
   * Declared probes that produced no step, each with its reason. A probe
   * declaration is a purchase of evidence; if no pair is generated the round
   * would report "no probe data" without anyone saying why, so the omission is
   * reported instead of being dropped. `validate-manifest.mjs` PRE-FAILs the
   * known cases at the manifest layer already (its probe-phase whitelist); this
   * is the plan-side defensive record for everything that still arrives.
   */
  skippedProbes: SkippedProbe[]
}

/** One probe declaration of the evidence manifest (`probe: <stem> <分钟>`). */
interface ProbeDecl {
  stem: string
  minutes: number
}

/**
 * Narrow the tool's `probes` parameter (its item schema is author-level `json`,
 * so the runtime value is a JsonValue[]): every entry must be
 * `{stem: non-empty string, minutes?: positive number}`. Anything else is a
 * caller bug and throws — a silently dropped probe declaration would delete a
 * whole sim+analysis pair from the plan.
 */
function validateProbeDeclarations(probes: unknown): ProbeDecl[] | undefined {
  if (probes === undefined) return undefined
  if (!Array.isArray(probes)) {
    throw new Error(`buckyball_bbdev_plan: probes must be an array of {stem, minutes}, got: ${JSON.stringify(probes)}`)
  }
  return probes.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`buckyball_bbdev_plan: probe entry must be {stem, minutes}, got: ${JSON.stringify(entry)}`)
    }
    const row = entry as Record<string, unknown>
    if (typeof row.stem !== 'string' || row.stem === '') {
      throw new Error(`buckyball_bbdev_plan: probe entry needs a non-empty stem, got: ${JSON.stringify(entry)}`)
    }
    if (
      row.minutes !== undefined &&
      (typeof row.minutes !== 'number' || !Number.isFinite(row.minutes) || row.minutes <= 0)
    ) {
      throw new Error(
        `buckyball_bbdev_plan: probe entry minutes must be a positive number, got: ${JSON.stringify(entry)}`,
      )
    }
    return { stem: row.stem, minutes: row.minutes as number | undefined } as ProbeDecl
  })
}

interface PlanInput {
  stage: string
  phase?: string
  layer?: string
  chip: string
  stems?: string[]
  /**
   * The round's bound models, verbatim from the injected `[manifest]` `models=` key.
   * The collection side is `MODEL_DECL` (scripts/manifest.mjs): a model is declared by a
   * line whose whole content is `--model <key>` — a `--model` inside a command string or
   * a prose mention is not a declaration, so the plan never derives models from them.
   */
  models?: string[]
  /**
   * Per-stem probe declarations (the manifest's `probe:` lines, parsed by
   * scripts/manifest.mjs and consumed here — the plan is the single entry that
   * decides what a probe round runs, so the verifier never hand-assembles an
   * analysis command). `budget` is the fallback for a declared stem with no
   * minutes of its own.
   */
  probes?: ProbeDecl[]
  /** Budget default for probe stems without an explicit `minutes` (缺省 3). */
  probeBudget?: number
  /**
   * Round-level `perf: <stem>` declaration: the round that must produce a
   * cycles delta. In `ball/rtl` it adds `--pmctrace` to that stem's verilator
   * sim (upstream passes the flag through, in the verilator sim step source of
   * `bbdev/api/steps/bebop/verilator/`), so the round
   * reports elapsed avg/max/min and the call counts.
   */
  perf?: string
  /**
   * The write-set touches `examples/balls/<b>/compiler/**` or
   * `examples/cores/<c>/compiler/**` (CI `infer-stage.mjs` decides it over the
   * WHOLE PR, not this round, and the plan only consumes the verdict). Every
   * phase whose sequence builds or simulates something out of that compiler
   * (no-phase baseline off a chip stage, `ball/c-bemu`, `ball/rtl`,
   * `chip/slices`, `chip/integrate`) then prepends `config install` +
   * `compiler build`: compiler build success/failure used to live in the
   * out-of-session Provision step, which carries no VERDICT semantics — a
   * broken compiler would otherwise surface as an unattributable
   * workload-build failure.
   */
  compilerTouched?: boolean
}

/** One batch lane: the toml the upstream batch step consumes. */
function batchToml(chip: string, backend: string, test: string): string {
  return `examples/chips/${chip}/regression/batch/${backend}/workloads-${test}.toml`
}

/**
 * Build the ordered command sequence. Throws on any input combination the
 * contract does not define — no fallback sequence is ever invented. Batch
 * commands are pruned against the calling session's checkout.
 */
function buildVerificationPlan(input: PlanInput, repoPath: string): PlanResult {
  const { stage, phase, chip, perf, compilerTouched } = input
  const layer = input.layer ?? 'merge'
  const stems = input.stems ?? []
  const models = input.models ?? []
  const probes = input.probes ?? []
  const defaultBudget = input.probeBudget ?? 3
  const probeOf = (stem: string): ProbeDecl | undefined => probes.find(p => p.stem === stem)
  if (!Object.hasOwn(STAGE_PHASES, stage)) {
    throw new Error(`unknown stage "${stage}" (legal: ${Object.keys(STAGE_PHASES).join('|')})`)
  }
  if (layer !== 'merge' && layer !== 'complete') {
    throw new Error(`unknown layer "${layer}" (legal: merge|complete)`)
  }
  const legalPhases = STAGE_PHASES[stage]
  if (phase !== undefined && !legalPhases.includes(phase)) {
    throw new Error(
      `phase "${phase}" is not legal for stage "${stage}"` +
        ` (legal: ${legalPhases.length === 0 ? 'none' : legalPhases.join('|')})`,
    )
  }

  const steps: PlanStep[] = []
  const skippedLanes: SkippedLane[] = []
  const push = (command: string, operation: string, args = '', note?: string) => {
    steps.push({ seq: steps.length + 1, command, operation, args, ...(note === undefined ? {} : { note }) })
  }
  const configInstall = () =>
    push(
      'config',
      'install',
      '',
      'chip.pb 的唯一生成者，编译器/工作流构建的前置（与 .github/workflows/check.yaml 的 chip-check 链一致）',
    )
  const compilerBuild = () => push('compiler', 'build', `--chip ${chip}`)
  const workloadClean = () => push('workload', 'clean', `--chip ${chip}`, 'build 前的 clean')
  const workloadBuild = () => push('workload', 'build', `--chip ${chip}`)
  /**
   * A nextest batch is only runnable when its toml is in the tree: the batch
   * step reads `examples/chips/<chip>/regression/batch/<backend>/workloads-<test>.toml`
   * and a missing file is a guaranteed failure, not a finding.
   */
  const batch = (backend: 'bemu' | 'verilator', test: 'elf' | 'pk') => {
    const command = backend === 'bemu' ? 'bebop-bemu' : 'bebop-verilator'
    const toml = batchToml(chip, backend, test)
    if (!existsSync(join(repoPath, toml))) {
      skippedLanes.push({
        lane: `${command} batch ${test}-tests`,
        toml,
        reason: `该 chip 无此 batch 清单实物（上游未注册该 lane），命令不生成，不算失败`,
      })
      return
    }
    push(command, 'batch', `--chip ${chip} --test ${test}-tests --clean-before`)
  }
  const bemuSim = (stem: string, extra = '', note?: string) =>
    push('bebop-bemu', 'sim', `--chip ${chip} --binary ${stem}${extra}`, note)
  const verilatorChain = () => {
    push('bebop-verilator', 'clean', `--chip ${chip}`)
    push('bebop-verilator', 'verilog', `--chip ${chip}`)
    push('bebop-verilator', 'build', `--jobs 16 --chip ${chip}`)
    batch('verilator', 'elf')
  }
  /**
   * One probe round = a PAIR, both generated here so the command single-entry
   * rule holds end to end: the `--sim` that collects the traces (budget-cancel
   * expected) and the `--analysis` that reads them back. The analysis log-dir
   * is a placeholder — only the sim's terminal status tells where the trace
   * landed — the verifier backfills it from the ONE candidate that
   * `buckyball_bbdev_probe_logdir` returns for (chip, stem, sim startedAt);
   * no hand glob, no guessing (prompt: 「probe 轮 log-dir 回填」).
   */
  const probedStems = new Set<string>()
  const probeStem = (stem: string) => {
    probedStems.add(stem)
    const budget = probeOf(stem)?.minutes ?? defaultBudget
    bemuSim(
      stem,
      ' --pk --itrace --mtrace',
      `probe 轮：budget ${budget}min，到点 cancel 属预期，不跑到底；终态（success 或 cancelled）后用` +
        ' buckyball_bbdev_probe_logdir（chip+stem+本轮 sim 的 startedAt）定位本轮仿真 log-dir，' +
        '回填配对 analysis 步骤的 --log-dir 占位符——不得手工 glob、不得猜路径',
    )
    push(
      'bebop-bemu',
      'analysis',
      `--chip ${chip} --log-dir <PROBE-LOG-DIR:${stem}> --itrace --mtrace`,
      `配对 ${stem} 的 probe 取证：--log-dir 占位符由上一步终态后 buckyball_bbdev_probe_logdir 的唯一候选回填` +
        '（唯一入口=plan+logdir 工具，不得手工拼命令）',
    )
  }
  /**
   * The model-coverage leg, shared by the no-phase baseline and chip/bind.
   * `withKernelPayload` is the bind-only second half of upstream
   * regression.yml's paired run: each `workload --build --model` is followed by
   * `kernel --build --model` before any probe step — but only for a model the
   * kernel lane itself accepts (`kernelModels`, see the module header: off that
   * set the step is guaranteed red and the pairing is not upstream's either,
   * since the eval-performance matrix that runs the pair lists KERNEL_MODELS
   * models only). The baseline stays the literal chip-check chain —
   * upstream runs no kernel step there — so the flag is NOT passed for it.
   */
  const modelCoverage = (withKernelPayload = false) => {
    const kernelModels = withKernelPayload ? readKernelModels(repoPath) : undefined
    for (const model of models) {
      const kernelAccepted = kernelModels?.has(model.toLowerCase()) ?? false
      push(
        'workload',
        'build',
        `--chip ${chip} --model ${model}`,
        kernelModels !== undefined && !kernelAccepted
          ? `kernel --build 步未生成：${model} 不在上游 kernel 车道的 KERNEL_MODELS 白名单里` +
              `（$BB/${KERNEL_MODELS_SOURCE}，plan 时实读），kernel_model() 对它直接报 unknown kernel model，` +
              '生成这一步只会造出一条必红命令；上游 regression.yml 的成对连跑也不含它。' +
              'bind 轮的 --pk 仿真与这一步无关（它不消费 kernel 产物，见 plan 模块头注）'
          : undefined,
      )
      if (kernelAccepted) {
        push(
          'kernel',
          'build',
          `--chip ${chip} --model ${model}`,
          'bind 腿：对齐上游 regression.yml 的成对连跑（workload --model 后紧跟 kernel --model，先于 probe）。' +
            '这一步是 (chip, model) 绑定通路自己的 kernel 侧门禁，不是 probe 的前置——' +
            '`--pk` 仿真不消费它的产物（见 plan 模块头注）',
        )
      }
    }
    for (const stem of stems) probeStem(stem)
  }
  /**
   * The compiler write-set prerequisite, in ONE place: `config install` is
   * chip.pb's only producer and `compiler build` is the step that consumes the
   * ball's compiler package, so any round that builds or simulates something
   * out of a touched compiler must run them INSIDE the session. Leaving them to
   * the out-of-session Provision step strips the compiler verdict of its
   * carrier — a broken compiler would otherwise surface as an unattributable
   * workload-build failure (and CI's `infer-stage.mjs` judges
   * `compilerTouched` over the whole PR write-set, so every phase this round
   * runs can inherit that touch, not only the c-bemu one).
   */
  const compilerPrerequisite = () => {
    if (compilerTouched !== true) return
    configInstall()
    compilerBuild()
  }

  if (phase === undefined) {
    // 无 phase 声明 = v1 全批验收基线（与 check.yaml chip-check 的非 rushB 链一致）。
    if (stage === 'chip') {
      configInstall()
      compilerBuild()
    } else {
      compilerPrerequisite()
    }
    workloadClean()
    workloadBuild()
    batch('bemu', 'elf')
    if (models.length > 0) modelCoverage()
  } else if (stage === 'ball' && phase === 'c-bemu') {
    compilerPrerequisite()
    workloadBuild()
    for (const stem of stems) {
      if (probeOf(stem) !== undefined) probeStem(stem)
      else bemuSim(stem)
    }
  } else if (stage === 'ball' && phase === 'rtl') {
    // The verilator chain consumes the compiler's product, so a PR-level
    // compiler touch joins the prerequisite ahead of it — same reasoning as
    // c-bemu, and the judgment is the whole-PR write set, not this round's.
    compilerPrerequisite()
    push('bebop-verilator', 'clean', `--chip ${chip}`, 'build marker 缺失/失配时必跑')
    push('bebop-verilator', 'verilog', `--chip ${chip}`, 'build marker 缺失/失配时必跑')
    push('bebop-verilator', 'build', `--jobs 16 --chip ${chip}`, 'build marker 缺失/失配时必跑')
    for (const stem of stems) {
      push(
        'bebop-verilator',
        'sim',
        `--chip ${chip} --binary ${stem} --no-wave${perf === stem ? ' --pmctrace' : ''}`,
        perf === stem
          ? 'perf 轮：--pmctrace 采集 RTL 侧 elapsed（报告消费 elapsed avg/max/min + 调用次数）'
          : undefined,
      )
    }
  } else if (stage === 'chip' && phase === 'skeleton') {
    configInstall()
    compilerBuild()
    workloadBuild()
    if (stems.length === 0) throw new Error('skeleton phase requires the smoke stem in stems[]')
    bemuSim(stems[0], '', '冒烟 stem')
  } else if (stage === 'chip' && phase === 'slices') {
    if (stems.length === 0) throw new Error('slices phase requires the slice stem sequence in stems[]')
    compilerPrerequisite()
    for (const stem of stems) bemuSim(stem, '', '首败即停：本 stem 失败则不再跑后续 stem')
  } else if (stage === 'chip' && phase === 'integrate') {
    compilerPrerequisite()
    for (const stem of stems)
      bemuSim(stem, '', 'slices 自带补跑（无有效 slices 轮 PASS 证据时由清单 stems 传入），首败即停')
    batch('bemu', 'elf')
  } else if (stage === 'chip' && phase === 'bind') {
    if (models.length === 0) throw new Error('bind phase requires the declared models in models[]')
    // Upstream regression.yml order: per model, workload --build
    // --model then (kernel-lane models only) kernel --build --model, and the
    // probe leg only after both. See `modelCoverage` for the model gate.
    modelCoverage(true)
  }

  // A declared probe that generated no sim+analysis pair is reported, never
  // dropped: the round would otherwise end with "no probe data" and no reason
  // attached. validate-manifest.mjs's probe-phase whitelist PRE-FAILs the
  // known-dead cases upstream, so everything reaching here is either the
  // stems[] mismatch or a caller that skipped the CI judgment block.
  const skippedProbes: SkippedProbe[] = probes
    .filter(p => !probedStems.has(p.stem))
    .map(p => ({
      ...(p.minutes === undefined ? {} : { minutes: p.minutes }),
      stem: p.stem,
      reason:
        phase !== undefined && !PROBE_PHASES.has(phase)
          ? `phase=${phase} 的执行序列里没有 probe 步骤，该 probe 声明无处落地（清单层的 probe 相位白名单应已 PRE-FAIL）`
          : phase === undefined && models.length === 0
            ? '无 phase 基线只在声明了 models 时才追加 probe 轮，本轮 models 为空'
            : !stems.includes(p.stem)
              ? `${p.stem} 不在 stems[] 里：probe 步骤逐 stems 生成，声明了 probe 却没声明该 stem 可跑`
              : '本轮未生成该 stem 的 probe 步骤',
    }))

  if (layer === 'complete') {
    batch('bemu', 'pk')
    if (stage === 'ball' || stage === 'chip') verilatorChain()
  }
  return { steps, skippedLanes, skippedProbes }
}

/** Build the `buckyball_bbdev_plan` tool definition. */

const input = JSON.parse(process.argv[2]);
console.log(JSON.stringify(buildVerificationPlan({...input, probes: validateProbeDeclarations(input.probes)}, process.argv[3]), null, 2));
