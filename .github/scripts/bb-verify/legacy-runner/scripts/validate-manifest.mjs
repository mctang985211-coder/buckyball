#!/usr/bin/env node
/**
 * validate-manifest.mjs — evidence-manifest schema validation for bb-verify.
 *
 * Hard rules (any violation → a PRE-FAIL line is injected into the task
 * prompt; the verifier session short-circuits to VERDICT: FAIL instead of
 * burning a 30-minute batch):
 *   1. `stage:` present and ∈ {workload, ball, chip};
 *   2. `chip:` present (the default-toy assumption is abolished) and the chip
 *      dir exists in the checkout tree (`examples/chips/<c>` — a same-named
 *      `examples/cores/<c>` entry is a core, not a chip, and no longer counts);
 *   3. `phase:` ∈ the stage's legal set (ball: c-bemu|rtl; chip:
 *      skeleton|slices|integrate|bind; workload: none) — an illegal or
 *      mismatched phase is a hard FAIL, never a silent baseline run;
 *   4. `round:` a positive integer when present;
 *   5. every `probe:` line matches `probe: <stem> <minutes>`, and probe lines
 *      are declared ONLY in a phase that consumes them — `ball/c-bemu`,
 *      `chip/bind` or the no-phase baseline (`PROBE_PHASES` in manifest.mjs).
 *      In `skeleton|slices|integrate|rtl` the plan generates no probe step, so
 *      such a line buys no evidence and used to be dropped silently; it is now
 *      a PRE-FAIL. The no-phase baseline consumes probes only THROUGH its
 *      declared models (`bbdev_plan` modelCoverage), so a probe/perf line in a
 *      models-less baseline round — 「probe/perf 声明在无 models 的基线轮不落地」 —
 *      is a PRE-FAIL too;
 *   6. every `perf:` line matches `perf: <stem>` (one token), the stem token is
 *      not an unfilled template placeholder (`<…>` → 「清单模板未填」, same rule
 *      on `probe:`), and the perf declaration sits in a phase that can produce
 *      its comparison base — the rule is per INSTRUMENT (`rtl` measures
 *      `pmc-evidence.elapsed_avg` and needs no probe line; `c-bemu` and the
 *      no-phase baseline measure `probe-evidence.cycles` and require the same
 *      stem's `probe:` line; `bind` stays exempt because its probe steps come
 *      from the bound models; any other phase produces neither and is
 *      rejected);
 *   7. every declared `--model <m>` resolves to a model directory that
 *      exists in the checkout tree (MODEL_LAYOUT value wins, else <m>).
 *      `--model` is collected ONLY as its own DECOR declaration line
 *      (`MODEL_DECL` in manifest.mjs: the line is `--model <key>` and nothing
 *      else) — prose mentions and command examples (fenced or bare) are not
 *      declarations, and a line that starts like one but is not is a 语法非法
 *      PRE-FAIL instead of a silent drop; field lines may carry a trailing
 *      `# 注释`, stripped identically in parser and syntax gates (same 口径);
 *   8. every `ball-expect: <stem> <MNEMONIC>[,…]` line names a stem inside
 *      this round's test set (probe:/perf: stems plus the declared models'
 *      build.py run stems) and carries 大写 ballISA mnemonics; the lines are
 *      echoed verbatim into the `[manifest]` block — they are the machine face
 *      of the 零事件分级 FAIL 分支（playbook「失败语义」).
 *
 * No `phase:` declaration is legal: it selects the v1 full-batch acceptance
 * baseline (higher cost, positively noted in the output).
 *
 * Usage: node validate-manifest.mjs --context context.json --repo-root <dir>
 */
import { existsSync } from 'node:fs'
import {
  isMain,
  loadPrContext,
  parseManifest,
  readModelLayoutKeys,
  readBuildPyModels,
  modelSourceRelPath,
  requireArgs,
  stripInlineComments,
  valueOf,
  DECOR,
  MODEL_ATTEMPT,
  MODEL_DECL,
  PROBE_PHASES,
  STAGE_PHASES,
} from './manifest.mjs'

export function validateManifest(context, repoRoot) {
  const manifest = parseManifest(context.body)
  const errors = []

  if (manifest.stage === undefined) {
    errors.push('证据清单缺失或 stage 字段不可辨识（stage 为必填首字段）')
  } else if (!Object.hasOwn(STAGE_PHASES, manifest.stage)) {
    errors.push(`stage 取值非法：${manifest.stage}（合法集 workload|ball|chip）`)
  }

  if (manifest.chip === undefined) {
    errors.push('证据清单缺 chip 字段（缺省 toy 的假设已废除，chip 必填）')
  } else if (!existsSync(`${repoRoot}/examples/chips/${manifest.chip}`)) {
    // Chips live in examples/chips/<c> only; examples/cores/<c> is a CORE and was
    // previously accepted here, which let a core name pass as a chip.
    errors.push(
      `清单声明的 chip "${manifest.chip}" 在检出树不存在（examples/chips/${manifest.chip} 无实物；examples/cores/ 下同名目录是 core，不算 chip）`,
    )
  }

  if (manifest.stage !== undefined && Object.hasOwn(STAGE_PHASES, manifest.stage)) {
    const legal = STAGE_PHASES[manifest.stage]
    if (manifest.phase !== undefined && !legal.includes(manifest.phase)) {
      errors.push(
        legal.length === 0
          ? `phase "${manifest.phase}" 对 stage=${manifest.stage} 非法（该 stage 无 phase 维度）`
          : `phase "${manifest.phase}" 与 stage=${manifest.stage} 不匹配（合法集 ${legal.join('|')}）`,
      )
    }
  }

  if (manifest.round !== undefined && !/^[1-9]\d*$/.test(manifest.round)) {
    errors.push(`round 取值非法：${manifest.round}（须为正整数）`)
  }

  // Declaration lines are judged per line, in the same anchored shape
  // parseManifest collects on (line-start + optional bullet + optional
  // backtick). Prose that merely mentions `probe:` / `perf:` mid-sentence is
  // NOT a declaration — a false positive there bills a legal manifest. Two
  // per-line verdicts, template residue first because it is the more
  // actionable attribution:
  //   • 清单模板未填 — the stem token is still the literal `<stem>`/`<…>`
  //     placeholder, i.e. the form was never filled. parseManifest would
  //     otherwise take `<stem>` as a real stem and the round would chase a
  //     binary that cannot exist.
  //   • 语法非法 — a filled value in the wrong shape.
  // Every pattern here is built on manifest.mjs's DECOR prefix — the same
  // decoration parseManifest's field() strips — so a line the parser collects
  // can never be the line the syntax gate fails, and vice versa.
  const declOf = name => new RegExp(`${DECOR}${name}\\s*[:：]`)
  const DECLS = {
    probe: {
      decl: declOf('probe'),
      value: valueOf('probe'),
      strict: new RegExp(`${valueOf('probe').source}\\s+\\d+\\s*(?:分钟|min)?\`?\\s*$`),
      shape: 'probe: <stem> <分钟>',
    },
    // `perf:` must carry exactly one stem token.
    perf: {
      decl: declOf('perf'),
      value: valueOf('perf'),
      strict: new RegExp(`${valueOf('perf').source}\`?\\s*$`),
      shape: 'perf: <stem>，单 token',
    },
    // `ball-expect: <stem> <MNEMONIC>[,…]` — mnemonics are ballISA 大写标识符
    // （形态与 bemu_analysis.py 的 ballISA.mnemonic 一致：GEMM、SMATMUL_OS…），逗号分隔。
    // 收集式与判定式同形态（parseManifest 的 ball-expect 正则）：不合式的行在这被
    // 点名，不静默丢弃。
    'ball-expect': {
      decl: declOf('ball-expect'),
      value: valueOf('ball-expect'),
      strict: new RegExp(`${valueOf('ball-expect').source}\\s+[A-Z][A-Z0-9_]*(?:,[A-Z][A-Z0-9_]*)*\`?\\s*$`),
      shape: 'ball-expect: <stem> <MNEMONIC>[,<MNEMONIC>…]（mnemonic 大写下划线、逗号分隔）',
    },
  }
  // Same 口径 as parseManifest.field(): inline comments are stripped BEFORE the
  // line-end-anchored patterns run, so `probe: s1 5  # 预算` is a legal declaration
  // here and in the parser — never a silent drop on one side and a false 语法非法 on the other.
  const lines = stripInlineComments(context.body ?? '').split('\n')
  // A line whose value is still a `<…>` placeholder has no subject to judge:
  // the template error is its whole verdict, and the instrument rule below is
  // skipped for it rather than piling a second, derived complaint on top.
  const templateHit = { probe: false, perf: false, 'ball-expect': false }
  for (const [name, rule] of Object.entries(DECLS)) {
    for (const [i, line] of lines.entries()) {
      if (!rule.decl.test(line)) continue
      const value = line.match(rule.value)
      if (value !== null && /[<>]/.test(value[1])) {
        templateHit[name] = true
        errors.push(
          `${name} 清单模板未填（第 ${i + 1} 行）：${line.trim()}（\`<stem>\` 是模板占位符，须替换为本轮实际的 binary stem）`,
        )
      } else if (!rule.strict.test(line)) {
        errors.push(`${name} 语法非法（第 ${i + 1} 行）：${line.trim()}（须为 ${rule.shape}）`)
      }
    }
  }

  // `--model` 的语法门：`--model` 没有冒号，走不进上面那套 `valueOf` 形态，所以单独
  // 逐行判。判据与解析器同一条：DECOR 行首之后整行就是 `--model <模型键>`（MODEL_DECL）。
  // 行首想声明却不合式的行在这里点名，不在解析器里静默丢——命令行示例
  // （`workload --build '--chip c --model m'`）与散文提及都不以 `--model` 开头，
  // 天然不进这条门，也不进 models[]。
  for (const [i, line] of lines.entries()) {
    if (!MODEL_ATTEMPT.test(line) || MODEL_DECL.test(line)) continue
    errors.push(
      `--model 语法非法（第 ${i + 1} 行）：${line.trim()}（声明行须整行为 \`--model <模型键>\`，一个模型一行；\`<…>\` 占位没填、行内挂说明或在命令里提一句都不是声明形态）`,
    )
  }

  // probe 行的相位白名单：只有会消费 probe 步骤的相位（c-bemu、bind、无 phase
  // 基线）才准声明 probe: 行。其余相位（skeleton/slices/integrate/rtl）里
  // bbdev_plan 根本不生成 probe 步骤 —— 旧口径下这些行被静默丢弃，清单作者以为
  // 自己买了取证、实际一轮没跑，下一轮也拿不到对照基。现在直接 PRE-FAIL。
  // 无 phase 基线还要过第二道：基线的 probe 成对步骤在 bbdev-plan 的
  // modelCoverage() 里、且仅当本轮声明了 models 才追加（对照：workload 轮 probe
  // 无执行承载）——「probe/perf 声明在无 models 的基线轮不落地」，同样 PRE-FAIL。
  const baselineNoModels = manifest.phase === undefined && manifest.models.length === 0
  if (!PROBE_PHASES.has(manifest.phase)) {
    const legal = [...PROBE_PHASES].map(p => p ?? '无 phase').join('/')
    // Placeholder stems already carry their own verdict above.
    for (const p of manifest.probes.filter(p => !/[<>]/.test(p.stem))) {
      errors.push(
        `probe 声明落在不消费它的相位（phase=${manifest.phase}）：${p.stem} ${p.minutes}min 一轮也不会跑（probe 行白名单相位 ${legal}），要么删掉 probe: 行要么改用会产 probe 的相位`,
      )
    }
  } else if (baselineNoModels) {
    const dead = [
      ...manifest.probes.filter(p => !/[<>]/.test(p.stem)).map(p => `probe: ${p.stem} ${p.minutes}min`),
      ...(manifest.perf === undefined || templateHit.perf ? [] : [`perf: ${manifest.perf}`]),
    ]
    if (dead.length > 0) {
      errors.push(
        `probe/perf 声明在无 models 的基线轮不落地（${dead.join('、')}）：无 phase 基线的 probe 步骤只随 --model 声明追加，本轮没有 models，取证与对照基一轮也不产——要么补 --model 声明，要么删掉这些行`,
      )
    }
  }

  // perf 的取证仪器按相位分相（与 probe-loop-check.mjs 同一口径）：perf 声明的
  // 对照基只能来自本相位实际会产出的取证行，声明一个产不出对照基的 perf 轮在此
  // PRE-FAIL，而不是到报告阶段才发现「delta 无从可判」。
  if (manifest.perf !== undefined && !templateHit.perf) {
    const probed = manifest.probes.some(p => p.stem === manifest.perf)
    if (manifest.phase === 'rtl') {
      // rtl 轮的对照基是 pmc-evidence：plan 给 perf stem 的 verilator sim 追加
      // --pmctrace，取证由本轮自产，不要求同 stem 的 probe: 行。
    } else if (manifest.phase === 'bind') {
      // bind 轮豁免照旧：probe 步骤由已绑定模型的 stem 序列生成，不必逐 stem 声明。
    } else if (manifest.phase === 'c-bemu' || manifest.phase === undefined) {
      // 无 phase + 无 models 的 perf 轮已由「不落地」条款整句判死（上面），这里不
      // 再叠一条派生的「缺同 stem probe 行」（同一根因只报一次，同 templateHit 先例）。
      if (!probed && !baselineNoModels) {
        errors.push(
          `perf 声明的 stem ${manifest.perf} 没有对应的 probe: 声明（${manifest.phase ?? '无 phase'} 轮的 cycles 取证只来自 probe 步骤，对照基与 delta 无从可判）`,
        )
      }
    } else {
      errors.push(
        `perf 声明落在 phase=${manifest.phase} 轮：该相位既不产 probe-evidence 也不产 pmc-evidence，性能对照基无从产生`,
      )
    }
  }

  if (manifest.models.length > 0) {
    const layout = readModelLayoutKeys(repoRoot)
    for (const model of manifest.models) {
      const dir = layout[model] ?? model
      if (!existsSync(`${repoRoot}/${modelSourceRelPath(dir)}`)) {
        errors.push(`清单声明的模型目录在检出树不存在：${model}（查 ${modelSourceRelPath(dir)}）`)
      }
    }
  }

  // ball-expect（ball 落点期望）的语义门：stem 必须落在**本轮测试集**——probe:/perf:
  // 声明的 stem 加上本轮声明模型在 build.py 的 run stem（bind/基线轮的 probe 步骤
  // 就是这些 stem）。期望一个本轮根本不会跑的 stem = 落点期望永远无从判，PRE-FAIL。
  // mnemonic 的大写形态由上面的语法门（DECLS['ball-expect'].strict）管，不重复判。
  if (manifest.ballExpects.length > 0) {
    const testSet = new Set(manifest.probes.map(p => p.stem))
    if (manifest.perf !== undefined) testSet.add(manifest.perf)
    if (manifest.models.length > 0) {
      const runStems = readBuildPyModels(repoRoot)
      for (const model of manifest.models) {
        if (runStems[model] !== undefined) testSet.add(runStems[model])
      }
    }
    for (const e of manifest.ballExpects) {
      if (!testSet.has(e.stem)) {
        errors.push(
          `ball-expect 声明的 stem ${e.stem} 不在本轮测试集（probe:/perf: 声明与声明模型的 build.py run stem：${testSet.size > 0 ? [...testSet].join(', ') : '空'}）：落点期望没有对应的 probe 步骤，零事件分级无从判起`,
        )
      }
    }
  }

  return { manifest, errors }
}

function main() {
  const { context: contextPath, repoRoot } = requireArgs(
    'usage: validate-manifest.mjs --context <context.json> --repo-root <dir>',
    '--context',
    '--repo-root',
  )
  const { manifest, errors } = validateManifest(loadPrContext(contextPath), repoRoot)
  console.log('[manifest]')
  if (errors.length > 0) {
    for (const error of errors) console.log(`  PRE-FAIL: ${error}`)
    return
  }
  const phase = manifest.phase ?? '无（v1 全批验收基线，仅成本更高，结论注明）'
  const probes = manifest.probes.length === 0 ? '无' : manifest.probes.map(p => `${p.stem} ${p.minutes}min`).join(', ')
  console.log(
    `  OK: stage=${manifest.stage} chip=${manifest.chip} phase=${phase}` +
      ` round=${manifest.round ?? '无'} probe=${probes}` +
      ` perf=${manifest.perf ?? '无'}` +
      (manifest.models.length > 0 ? ` models=${manifest.models.join(',')}` : ''),
  )
  // ball 落点期望照录入块：零事件分级的 FAIL 分支以它为依据（playbook「失败语义」），
  // 会话不得也不须重新判定——这里就是它的机器面注入点。
  for (const e of manifest.ballExpects) {
    console.log(`  ball-expect: ${e.stem} ${e.mnemonics.join(',')}`)
  }
}

if (isMain(import.meta.url)) {
  main()
}
