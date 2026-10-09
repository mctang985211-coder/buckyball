#!/usr/bin/env node
/**
 * Self-test for the deterministic CI verdict scripts (infer-stage /
 * validate-manifest / binding-check / slices-verify / probe-loop-check).
 *
 * Everything runs against fabricated context.json objects (the ref-mode shape:
 * title/body/files/headRefOid, comments/reviews always empty) and a fabricated
 * checkout tree under a tmpdir — the real buckyball repository is never
 * touched. The tree fixture mirrors the contractual fact sources:
 * bbdev MODEL_LAYOUT, e2e models/archs/buckyball/<chip>/<layout>/,
 * build.py _MODELS, e2e models/models/<dir>/.
 *
 * Usage: node scripts/selftest-deterministic.mjs
 * Exits 0 when every assertion holds, 1 otherwise.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inferStage } from './infer-stage.mjs'
import { validateManifest } from './validate-manifest.mjs'
import { bindingCheck } from './binding-check.mjs'
import { slicesVerify } from './slices-verify.mjs'
import { probeLoopCheck } from './probe-loop-check.mjs'

let failed = 0
function check(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failed++
}

// ── Fixture: a fabricated checkout tree with bertsmall fully bound to pebble ──
// (现行绑定口径：BertSmall 的 layout 实物在 models/archs/buckyball/pebble/ 下；
//  toy 仍是纯 schema 断言用的普通 chip。)
const root = mkdtempSync(join(tmpdir(), 'vr-deterministic-'))
mkdirSync(join(root, 'examples/chips/toy'), { recursive: true })
mkdirSync(join(root, 'examples/cores/toy'), { recursive: true })
mkdirSync(join(root, 'examples/chips/pebble'), { recursive: true })
mkdirSync(join(root, 'bbdev/api/steps/workload'), { recursive: true })
writeFileSync(
  join(root, 'bbdev/api/steps/workload/01_build_event.step.py'),
  ['MODEL_LAYOUT = {', '    "lenet": "LeNet",', '    "bertsmall": "BertSmall",', '}', ''].join('\n'),
)
mkdirSync(join(root, 'bb-tests/workloads/scripts'), { recursive: true })
writeFileSync(
  join(root, 'bb-tests/workloads/scripts/build.py'),
  [
    '_MODELS: dict[str, tuple[str, str]] = {',
    '    "lenet": ("lenet", "buddy-buckyball-lenet-run"),',
    '    "bertsmall": ("bertsmall", "buddy-buckyball-bertsmall-run"),',
    '}',
    '',
  ].join('\n'),
)
mkdirSync(join(root, 'bb-tests/workloads/src/ModelTest/e2e/models/models/BertSmall'), { recursive: true })
mkdirSync(join(root, 'bb-tests/workloads/src/ModelTest/e2e/models/models/LeNet'), { recursive: true })
mkdirSync(join(root, 'bb-tests/workloads/src/ModelTest/e2e/models/archs/buckyball/pebble/BertSmall'), {
  recursive: true,
})

const ctx = (body, files = [], extra = {}) => ({ body, files: files.map(path => ({ path })), ...extra })

// ── infer-stage ──
{
  // Ball wiring shape: ball artifacts + regression TOMLs + balldomains + core
  // compiler registration → ball (the regression-toml misjudgment fix).
  const files = [
    'examples/balls/gelu/arch/src/main/scala/GeluBall.scala',
    'examples/balls/gelu/emu/src/56_gelu.rs',
    'examples/chips/toy/regression/batch/bemu/workloads-elf.toml',
    'examples/chips/toy/regression/batch/bemu/workloads-pk.toml',
    'examples/cores/toy/configs/balldomains/default.toml',
    'examples/cores/toy/compiler/src/CMakeLists.txt',
  ]
  const r = inferStage(
    files.map(path => ({ path })),
    'ball',
  )
  check(
    'infer: ball 接线写集（regression TOML + balldomains + compiler 注册）判 ball',
    r.inferred === 'ball' && r.effective === 'ball' && r.conflicts.length === 0,
    JSON.stringify({ inferred: r.inferred, conflicts: r.conflicts }),
  )
  check('infer: ball 写集收集到 chip 候选 toy', r.chips.includes('toy'))
}
{
  // A genuine chip PR: chip-definition paths carry the chip vote even though
  // the mandatory wiring files vote ball.
  const files = [
    'examples/chips/newchip/arch/src/main/scala/CustomConfigs.scala',
    'examples/chips/newchip/configs/chip.toml',
    'examples/chips/newchip/regression/batch/bemu/workloads-elf.toml',
    'examples/cores/newchip/configs/balldomains/default.toml',
  ]
  const r = inferStage(
    files.map(path => ({ path })),
    'chip',
  )
  check(
    'infer: chip 定义级路径成立 → chip（接线文件不压过定义级）',
    r.inferred === 'chip' && r.effective === 'chip' && r.conflicts.length === 0,
  )
}
{
  // A pebble ball PR must also wire the core's compiler
  // package (dialect aggregate td + Transforms source list + legalize dispatch +
  // Conversion patterns) — upstream's own ball commits are exactly this. All of
  // it is ball write-set, so no chip vote and no widest-stage conflict.
  const files = [
    'examples/balls/layernorm/arch/src/main/scala/LayerNorm.scala',
    'examples/balls/layernorm/compiler/src/Dialect/Buckyball/LayerNormBall.td',
    'examples/chips/pebble/regression/batch/bemu/workloads-elf.toml',
    'examples/cores/pebble/configs/balldomains/default.toml',
    'examples/cores/pebble/compiler/src/CMakeLists.txt',
    'examples/cores/pebble/compiler/src/Dialect/Buckyball/PebbleBuckyball.td',
    'examples/cores/pebble/compiler/src/Dialect/Buckyball/Transforms/CMakeLists.txt',
    'examples/cores/pebble/compiler/src/Dialect/Buckyball/Transforms/LegalizeForLLVMExport.cpp',
    'examples/cores/pebble/compiler/src/Conversion/LowerBuckyball/AssignPhysicalBankPatterns.cpp',
  ]
  const r = inferStage(
    files.map(path => ({ path })),
    'ball',
  )
  check(
    'infer: core compiler 全接线（td/Transforms/dispatch/Conversion）判 ball 不判 chip',
    r.inferred === 'ball' && r.effective === 'ball' && r.conflicts.length === 0,
    JSON.stringify({ inferred: r.inferred, effective: r.effective, conflicts: r.conflicts }),
  )
}
{
  // Declared ball but the diff touches chip definition → widest wins + conflict.
  const files = ['examples/chips/toy/arch/src/main/scala/CustomConfigs.scala']
  const r = inferStage(
    files.map(path => ({ path })),
    'ball',
  )
  check(
    'infer: 声明 ball vs 推断 chip → 按最宽 chip 执行并标注冲突',
    r.effective === 'chip' && r.conflicts.length === 1,
    r.conflicts[0],
  )
}
{
  // Gitlink write-set shape: build.py + e2e/bbdev pointers →
  // inferred workload, declared chip → widest chip with conflict annotated.
  const files = ['bb-tests/workloads/scripts/build.py', 'bb-tests/workloads/src/ModelTest/e2e', 'bbdev']
  const r = inferStage(
    files.map(path => ({ path })),
    'chip',
  )
  check(
    'infer: gitlink 写集 declared=chip/inferred=workload → effective=chip + 冲突',
    r.inferred === 'workload' && r.effective === 'chip' && r.conflicts.length === 1,
  )
}
{
  const r = inferStage([{ path: 'bb-tests/workloads/scripts/build.py' }], 'workload')
  check('infer: 纯 workload 写集 → workload', r.effective === 'workload' && r.conflicts.length === 0)
}
{
  // 第 4 条：c-bemu 条件式前置的判定侧——ball 或 core 的 compiler/** 才算触及编译器写集。
  const ballCompiler = inferStage([{ path: 'examples/balls/gelu/compiler/src/Dialect/Buckyball/GeluBall.td' }], 'ball')
  const coreCompiler = inferStage(
    [{ path: 'examples/cores/pebble/compiler/src/Conversion/LowerBuckyball/X.cpp' }],
    'ball',
  )
  const emuOnly = inferStage([{ path: 'examples/balls/gelu/emu/src/lib.rs' }], 'ball')
  check('infer: ball compiler/** → compilerTouched=true', ballCompiler.compilerTouched === true)
  check('infer: core compiler/** → compilerTouched=true', coreCompiler.compilerTouched === true)
  check(
    'infer: 只改 emu/ctest 的 c-bemu 轮 → compilerTouched=false（不强加 compiler build）',
    emuOnly.compilerTouched === false,
  )
}

// ── validate-manifest ──
{
  const ok = ctx('stage: ball\nphase: c-bemu\nround: 1\nchip: toy\n')
  const r = validateManifest(ok, root)
  check('manifest: ball/c-bemu/chip=toy 合法', r.errors.length === 0, r.errors.join('；'))
}
{
  const r = validateManifest(ctx('stage: workload\nchip: toy\n'), root)
  check('manifest: 无 phase 声明 = v1 全批基线，合法', r.errors.length === 0)
}
{
  const r = validateManifest(ctx('stage: ball\nphase: c-bemu\n'), root)
  check(
    'manifest: 缺 chip → PRE-FAIL（缺省 toy 已废除）',
    r.errors.some(e => e.includes('缺 chip')),
    r.errors.join('；'),
  )
}
{
  const r = validateManifest(ctx('stage: ball\nchip: toy\nphase: bind\n'), root)
  check(
    'manifest: phase=bind 对 ball 非法 → PRE-FAIL（不回退 v1）',
    r.errors.some(e => e.includes('不匹配')),
    r.errors.join('；'),
  )
}
{
  const r = validateManifest(ctx('stage: chip\nchip: toy\nphase: bogus\n'), root)
  check(
    'manifest: phase 取值非法 → PRE-FAIL',
    r.errors.some(e => e.includes('不匹配') || e.includes('非法')),
  )
}
{
  const r = validateManifest(ctx('stage: workload\nchip: toy\nphase: c-bemu\n'), root)
  check(
    'manifest: workload 带 phase → PRE-FAIL（workload 无 phase 维度）',
    r.errors.some(e => e.includes('无 phase 维度')),
  )
}
{
  const r = validateManifest(ctx('stage: ball\nchip: toy\nround: 0\n'), root)
  check(
    'manifest: round=0 → PRE-FAIL（须正整数）',
    r.errors.some(e => e.includes('round')),
  )
}
{
  const r = validateManifest(ctx('stage: ball\nchip: toy\n- probe: some-stem\n'), root)
  check(
    'manifest: probe 缺预算分钟数 → PRE-FAIL',
    r.errors.some(e => e.includes('probe 语法')),
    r.errors.join('；'),
  )
}
{
  // 无 phase 基线的 probe 必须与 `--model` 声明行配对才落地（终审 4），合法形态就是
  // MODEL_DECL 那一行——命令行示例不算声明（见 --model 采集口径一节）。
  const r = validateManifest(ctx('stage: ball\nchip: toy\nprobe: stem-a 5\n--model bertsmall\n'), root)
  check(
    'manifest: probe: <stem> <分钟> 合法',
    r.errors.length === 0 && r.manifest.probes[0].minutes === 5,
    r.errors.join('；'),
  )
}
{
  // A workload body that only *mentions* the probe
  // contract mid-sentence is not a probe declaration. parseManifest collects
  // declarations anchored at line start; the syntax gate judges the same set.
  const r = validateManifest(
    ctx('stage: workload\nchip: toy\nso there is no model stem to list, and no `probe:` line applies):\n'),
    root,
  )
  check('manifest: 散文中提及 `probe:` 字样 ≠ 声明行 → 不判 PRE-FAIL', r.errors.length === 0, r.errors.join('；'))
}
{
  const r = validateManifest(ctx('stage: chip\nchip: toy\nphase: bind\n--model ghost\n'), root)
  check(
    'manifest: 声明的模型目录不在检出树 → PRE-FAIL',
    r.errors.some(e => e.includes('ghost')),
  )
}
{
  const r = validateManifest(ctx('stage: chip\nchip: toy\nphase: bind\n--model bertsmall\n'), root)
  check('manifest: 声明模型 bertsmall 经 MODEL_LAYOUT→BertSmall 命中检出树', r.errors.length === 0, r.errors.join('；'))
}
{
  const r = validateManifest(ctx('stage: ball\nchip: ghostchip\n'), root)
  check(
    'manifest: 声明 chip 在检出树不存在 → PRE-FAIL',
    r.errors.some(e => e.includes('ghostchip')),
  )
}
{
  // examples/cores/<c> 是 core 不是 chip：只有 cores 命中时仍须 PRE-FAIL。
  const coreOnly = mkdtempSync(join(tmpdir(), 'vr-deterministic-core-'))
  mkdirSync(join(coreOnly, 'examples/cores/roc'), { recursive: true })
  const r = validateManifest(ctx('stage: ball\nchip: roc\n'), coreOnly)
  check(
    'manifest: cores 同名目录不再冒充 chip → PRE-FAIL',
    r.errors.some(e => e.includes('roc') && e.includes('core')),
    r.errors.join('；'),
  )
}
{
  const r = validateManifest(ctx('# just a title\n\nsome prose\n'), root)
  check(
    'manifest: 缺 stage → PRE-FAIL',
    r.errors.some(e => e.includes('stage')),
  )
}
{
  const r = validateManifest(ctx('stage: ball\nchip: toy\nphase: c-bemu\nperf: s1\n'), root)
  check(
    'manifest: perf 无对应 probe 声明（非 bind 轮）→ PRE-FAIL',
    r.errors.some(e => e.includes('perf 声明的 stem')),
    r.errors.join('；'),
  )
}
{
  const r = validateManifest(ctx('stage: ball\nchip: toy\nphase: c-bemu\nperf: s1\nprobe: s1 5\n'), root)
  check(
    'manifest: perf + 同 stem probe 声明 → OK 且解析出 perf 字段',
    r.errors.length === 0 && r.manifest.perf === 's1',
    r.errors.join('；'),
  )
}
{
  const r = validateManifest(ctx('stage: ball\nchip: toy\nperf: s1 3\n'), root)
  check(
    'manifest: perf 带第二个 token → PRE-FAIL（语法须为 perf: <stem>）',
    r.errors.some(e => e.includes('perf 语法非法')),
    r.errors.join('；'),
  )
}
{
  // 散文里提及 perf: 字样不是声明行（与 probe 语法门同一口径）。
  const r = validateManifest(ctx('stage: ball\nchip: toy\nso no `perf:` line is declared here\n'), root)
  check('manifest: 散文提及 `perf:` ≠ 声明行 → 不判 PRE-FAIL', r.errors.length === 0, r.errors.join('；'))
}
// ── probe 行的相位白名单（probe 只准出现在会消费它的相位）──
{
  // 无 phase 的合法轮带上 `--model` 声明行（终审 4：无 models 的基线轮 probe 不落地，
  // 单列断言）。
  const bodyOf = stage => phase =>
    `stage: ${stage}\nchip: toy\n` +
    (phase === 'none' ? '' : `phase: ${phase}\n`) +
    'probe: a-baremetal 5\n' +
    (phase === 'none' ? '--model bertsmall\n' : '')
  const chipBody = bodyOf('chip')
  for (const phase of ['skeleton', 'slices', 'integrate']) {
    const r = validateManifest(ctx(chipBody(phase)), root)
    check(
      `manifest: phase=${phase} 声明 probe 行 → PRE-FAIL（该相位 plan 不生成 probe 步骤，不再静默丢弃）`,
      r.errors.some(e => e.includes('不消费它的相位')),
      r.errors.join('；'),
    )
  }
  for (const [stage, phase] of [
    ['ball', 'rtl'],
    ['chip', 'skeleton'],
  ]) {
    const r = validateManifest(ctx(bodyOf(stage)(phase)), root)
    check(
      `manifest: ${stage}/${phase} 的 probe 行被白名单挡下（错误里列出合法相位）`,
      r.errors.some(e => e.includes('不消费它的相位') && e.includes('无 phase/c-bemu/bind')),
      r.errors.join('；'),
    )
  }
  for (const [stage, phase] of [
    ['ball', 'c-bemu'],
    ['chip', 'bind'],
    ['workload', 'none'],
  ]) {
    const r = validateManifest(ctx(bodyOf(stage)(phase)), root)
    check(
      `manifest: ${stage}/${phase === 'none' ? '无 phase' : phase} 声明 probe 行 → 合法（白名单内）`,
      !r.errors.some(e => e.includes('不消费它的相位')),
      r.errors.join('；'),
    )
  }
  // 白名单判定用的是与 field() 同一套装饰口径：bullet + 反引号形态同样算声明。
  const decorated = validateManifest(
    ctx(chipBody('slices').replace('probe: a-baremetal 5', '- `probe: a-baremetal 5`')),
    root,
  )
  check(
    'manifest: 装饰形态（bullet+反引号）的 probe 行同样进白名单判定',
    decorated.manifest.probes.length === 1 && decorated.errors.some(e => e.includes('不消费它的相位')),
    decorated.errors.join('；'),
  )
}
// ── perf 规则按取证仪器分支 ──
{
  // rtl：对照基是本轮自产的 pmc-evidence，不要求同 stem probe 行。
  const rtl = validateManifest(ctx('stage: ball\nchip: toy\nphase: rtl\nperf: a-baremetal\n'), root)
  check(
    'manifest: rtl 的 perf 轮不要求 probe: 行（pmc 仪器自产对照数）',
    rtl.errors.length === 0,
    rtl.errors.join('；'),
  )
  // c-bemu / 无 phase：须同 stem probe 行，否则对照基无从产生。
  const cb = validateManifest(ctx('stage: ball\nchip: toy\nphase: c-bemu\nperf: a-baremetal\n'), root)
  check(
    'manifest: c-bemu 的 perf 无同 stem probe 行 → PRE-FAIL',
    cb.errors.some(e => e.includes('没有对应的 probe: 声明')),
    cb.errors.join('；'),
  )
  // 无 phase + 无 models：perf 声明先被「不落地」条款整句判死（终审 4），
  // 不再叠加派生的「缺同 stem probe 行」。
  const bare = validateManifest(ctx('stage: ball\nchip: toy\nperf: a-baremetal\n'), root)
  check(
    'manifest: 无 models 基线轮的 perf → PRE-FAIL「不落地」（根因一条，不叠派生）',
    bare.errors.some(e => e.includes('无 models 的基线轮不落地')) &&
      !bare.errors.some(e => e.includes('没有对应的 probe: 声明')),
    bare.errors.join('；'),
  )
  const bareProbe = validateManifest(ctx('stage: workload\nchip: toy\nprobe: a-baremetal 5\n'), root)
  check(
    'manifest: 无 models 基线轮的 probe → PRE-FAIL「不落地」（对照：workload 轮 probe 无执行承载）',
    bareProbe.errors.some(e => e.includes('无 models 的基线轮不落地')),
    bareProbe.errors.join('；'),
  )
  // 有 models 的基线轮：perf 仍须同 stem probe 行（派生错误照报，不落地条款不参与）。
  const bareStem = validateManifest(ctx('stage: ball\nchip: toy\nperf: a-baremetal\n--model bertsmall\n'), root)
  check(
    'manifest: 有 models 的基线轮 perf 无同 stem probe 行 → PRE-FAIL「没有对应的 probe: 声明」',
    bareStem.errors.some(e => e.includes('没有对应的 probe: 声明')) && !bareStem.errors.some(e => e.includes('不落地')),
    bareStem.errors.join('；'),
  )
  const bareOk = validateManifest(
    ctx('stage: chip\nchip: toy\nperf: a-baremetal\nprobe: a-baremetal 4\n--model bertsmall\n'),
    root,
  )
  check('manifest: 无 phase + 同 stem probe 行 → OK', bareOk.errors.length === 0, bareOk.errors.join('；'))
  // bind 豁免照旧。
  const bind = validateManifest(
    ctx('stage: chip\nchip: toy\nphase: bind\nperf: buddy-buckyball-bertsmall-run\n--model bertsmall\n'),
    root,
  )
  check('manifest: bind 的 perf 无 probe 行 → 豁免照旧', bind.errors.length === 0, bind.errors.join('；'))
  // 既不产 probe 也不产 pmc 的相位 → 直接拒。
  for (const phase of ['skeleton', 'slices', 'integrate']) {
    const r = validateManifest(ctx(`stage: chip\nchip: toy\nphase: ${phase}\nperf: a-baremetal\n`), root)
    check(
      `manifest: phase=${phase} 声明 perf → PRE-FAIL（两样取证仪器都不产）`,
      r.errors.some(e => e.includes('性能对照基无从产生')),
      r.errors.join('；'),
    )
  }
}
// ── 清单模板未填（字面 `<stem>` 残留）──
{
  const r = validateManifest(ctx('stage: ball\nchip: toy\nphase: c-bemu\nperf: <stem>\n'), root)
  check(
    'manifest: perf: <stem> 字面模板残留 → PRE-FAIL「清单模板未填」',
    r.errors.some(e => e.includes('perf 清单模板未填')),
    r.errors.join('；'),
  )
  const rp = validateManifest(ctx('stage: ball\nchip: toy\nphase: c-bemu\nprobe: <stem> 5\n'), root)
  check(
    'manifest: probe: <stem> 字面模板残留 → PRE-FAIL「清单模板未填」',
    rp.errors.some(e => e.includes('probe 清单模板未填')),
    rp.errors.join('；'),
  )
  const one = validateManifest(ctx('stage: ball\nchip: toy\nphase: c-bemu\n- `perf: <stem>`\n'), root)
  check(
    'manifest: 模板未填只报其自身一条（不叠加派生的 probe 缺失错误）',
    one.errors.filter(e => e.includes('清单模板未填')).length === 1 &&
      !one.errors.some(e => e.includes('没有对应的 probe')),
    one.errors.join('；'),
  )
}

// ── --model 采集口径：只有 DECOR 声明行算声明（散文提及与代码示例都不采）──
{
  // 误采形态①（散文提及）：这一行同时带着 workload 字样与 `--model gpt2`——旧判据
  // （/workload|bbdev/ 整行子串）把它采成模型声明，gpt2 的目录查不到即 PRE-FAIL，
  // 一份合法清单被散文弄死。
  const prose = validateManifest(
    ctx('stage: ball\nchip: toy\n本 PR 不改 workload 层，只是引用上游 --model gpt2 的写法\n'),
    root,
  )
  check(
    'manifest: 散文行（带 workload 字样 + `--model gpt2`）≠ 声明 → models 空、不 PRE-FAIL',
    prose.manifest.models.length === 0 && prose.errors.length === 0,
    JSON.stringify({ models: prose.manifest.models, errors: prose.errors }),
  )
  const plainProse = validateManifest(
    ctx('stage: ball\nchip: toy\n- 参考上游 --model gpt2 写法，本 PR 不带模型\n'),
    root,
  )
  check(
    'manifest: bullet 散文里的 `--model gpt2` 同样不算声明',
    plainProse.manifest.models.length === 0 && plainProse.errors.length === 0,
    JSON.stringify({ models: plainProse.manifest.models, errors: plainProse.errors }),
  )
  // 误采形态②（代码示例）：bind 轮命令序列出现在 fence 里，是示例不是声明。旧判据把
  // 它采成声明，「probe/perf 声明在无 models 的基线轮不落地」这道 PRE-FAIL 就被示例
  // 静默关掉了。
  const fenced = validateManifest(
    ctx(
      'stage: chip\nchip: toy\n## 预期应跑的测试\n' +
        "```bash\nbbdev workload --build '--chip toy --model bertsmall'\n```\n",
    ),
    root,
  )
  check(
    'manifest: fence 里的示例命令不算 --model 声明（不静默关掉无 models 基线轮 PRE-FAIL）',
    JSON.stringify(fenced.manifest.models) === JSON.stringify([]),
    JSON.stringify({ models: fenced.manifest.models }),
  )
  const baselineProbe = validateManifest(
    ctx(
      'stage: chip\nchip: toy\nprobe: a-baremetal 5\n' +
        "```\nnix develop -c bbdev workload --build '--chip toy --model bertsmall'\n```\n",
    ),
    root,
  )
  check(
    'manifest: 基线轮只带 fence 里的模型示例 → probe 仍判「无 models 不落地」（示例不顶替声明）',
    baselineProbe.errors.some(e => e.includes('无 models 的基线轮不落地')),
    baselineProbe.errors.join('；'),
  )
  // 合法形态：DECOR 声明行（裸行 / bullet / 反引号装饰皆同一条 MODEL_DECL）。
  for (const [label, line] of [
    ['裸行', '--model bertsmall'],
    ['bullet', '- --model bertsmall'],
    ['bullet+反引号', '- `--model bertsmall`'],
  ]) {
    const r = validateManifest(ctx(`stage: chip\nchip: toy\nphase: bind\n${line}\n`), root)
    check(
      `manifest: DECOR 声明行（${label}）的 --model 照收（models 校验命中 BertSmall 实物）`,
      JSON.stringify(r.manifest.models) === JSON.stringify(['bertsmall']) && r.errors.length === 0,
      JSON.stringify({ models: r.manifest.models, errors: r.errors }),
    )
  }
  // 命令行里的 --model 不再是声明形态——这是本条设计的正面表述：想要 models[] 就得写
  // 一行 `--model <键>`，光在预期测试里列命令不算。
  const cmd = validateManifest(
    ctx("stage: chip\nchip: toy\nphase: bind\nworkload --build '--chip toy --model bertsmall'\n"),
    root,
  )
  check(
    'manifest: 裸命令行（workload --build … --model …）不再算声明',
    cmd.manifest.models.length === 0 && cmd.errors.length === 0,
    JSON.stringify({ models: cmd.manifest.models, errors: cmd.errors }),
  )
  // 行首想声明却不合式 → 语法门点名（严格式之下不再有「写了但静默不采」这一格）。
  const malformed = validateManifest(ctx('stage: chip\nchip: toy\nphase: bind\n--model bertsmall 本轮绑定它\n'), root)
  check(
    'manifest: 行首 --model 但值挂尾巴 → 语法非法 PRE-FAIL（不静默丢声明）',
    malformed.manifest.models.length === 0 && malformed.errors.some(e => e.includes('--model 语法非法')),
    malformed.errors.join('；'),
  )
  const colon = validateManifest(ctx('stage: chip\nchip: toy\nphase: bind\n--model: bertsmall\n'), root)
  check(
    'manifest: `--model: <键>` 冒号形态 → 语法非法 PRE-FAIL（形态唯一）',
    colon.manifest.models.length === 0 && colon.errors.some(e => e.includes('--model 语法非法')),
    colon.errors.join('；'),
  )
  // 多模型 = 多行，逐行入 models[]。
  const multi = validateManifest(ctx('stage: chip\nchip: toy\nphase: bind\n--model bertsmall\n--model lenet\n'), root)
  check(
    'manifest: 两行 --model 声明 → models 两项（一行一键）',
    JSON.stringify(multi.manifest.models) === JSON.stringify(['bertsmall', 'lenet']),
    JSON.stringify({ models: multi.manifest.models, errors: multi.errors }),
  )
  // 语法门的 catch set 是 `--model` 这个 **token**，不是任何以 --model 开头的字串：
  // change list 里以 `--models/…` 路径起头的条目是路径提及，不该被点名。
  const pathLike = validateManifest(
    ctx(
      'stage: chip\nchip: pebble\nphase: bind\n--model bertsmall\n改了哪些文件：\n' +
        '- --models/archs/buckyball/pebble/BertSmall/ 新 layout\n',
    ),
    root,
  )
  check(
    'manifest: 行首 `--models/…` 路径条目不触发 --model 语法门（token 边界）',
    JSON.stringify(pathLike.manifest.models) === JSON.stringify(['bertsmall']) &&
      !pathLike.errors.some(e => e.includes('--model 语法非法')),
    pathLike.errors.join('；'),
  )
}
// ── 行内注释剥离（终审 2：field() 与 probe/perf 严格行同口径）──
{
  const r = validateManifest(ctx('stage: chip\nchip: toy\nphase: bind  # 本 PR 只动布局\nround: 2  # 第二轮\n'), root)
  check(
    'manifest: phase: bind  # 注释 行的字段值照常解析（不再静默掉 v1 基线）',
    r.manifest.phase === 'bind' && r.manifest.round === '2' && r.errors.length === 0,
    JSON.stringify({ phase: r.manifest.phase, round: r.manifest.round, errors: r.errors }),
  )
  const rp = validateManifest(
    ctx('stage: ball\nchip: toy\nphase: c-bemu\nprobe: s1 5  # 预算五分钟\nperf: s1  # cycles 对照\n'),
    root,
  )
  check(
    'manifest: probe/perf 严格行照样剥行内注释（不误判语法非法）',
    rp.errors.length === 0 &&
      rp.manifest.probes.length === 1 &&
      rp.manifest.probes[0].minutes === 5 &&
      rp.manifest.perf === 's1',
    rp.errors.join('；'),
  )
  const rh = validateManifest(ctx('stage: ball\nchip: toy\nphase: c-bemu\nperf: <stem>  # 模板残留\n'), root)
  check(
    'manifest: 行内注释不干扰「清单模板未填」判定',
    rh.errors.some(e => e.includes('perf 清单模板未填')),
    rh.errors.join('；'),
  )
}

// ── binding-check ──
{
  const c = ctx('stage: ball\nchip: toy\n改了哪些文件：\n- examples/balls/gelu/README.md\n', [
    'examples/balls/gelu/README.md',
  ])
  const r = bindingCheck(c, root)
  check('binding: 无模型写集 → 豁免：无模型写集', r.verdict === '豁免：无模型写集', r.detail)
}
{
  // Write-set shape: declared model fully bound in the tree.
  // 模型声明是清单自己的 `--model <键>` 行（命令行形态在 预期测试 里照旧写，但它不承载声明）。
  const c = ctx(
    'stage: chip\nphase: bind\nchip: pebble\n--model bertsmall\n改了哪些文件：\n- 父仓：build.py::_MODELS 增 bertsmall\n' +
      "预期应跑的测试：\n- workload --build '--chip pebble --model bertsmall'\n",
    ['bb-tests/workloads/scripts/build.py', 'bb-tests/workloads/src/ModelTest/e2e', 'bbdev'],
  )
  const r = bindingCheck(c, root)
  check(
    'binding: 三源齐备 → 覆盖必做（带 stem）',
    r.verdict === '覆盖必做' && r.detail.includes('buddy-buckyball-bertsmall-run'),
    r.detail,
  )
}
{
  // Write-set shape: no --model declared, nothing bound for it.
  const bare = mkdtempSync(join(tmpdir(), 'vr-deterministic-bare-'))
  mkdirSync(join(bare, 'examples/chips/toy'), { recursive: true })
  mkdirSync(join(bare, 'examples/cores/toy'), { recursive: true })
  mkdirSync(join(bare, 'bbdev/api/steps/workload'), { recursive: true })
  writeFileSync(
    join(bare, 'bbdev/api/steps/workload/01_build_event.step.py'),
    'MODEL_LAYOUT = {\n    "lenet": "LeNet",\n}\n',
  )
  mkdirSync(join(bare, 'bb-tests/workloads/scripts'), { recursive: true })
  writeFileSync(
    join(bare, 'bb-tests/workloads/scripts/build.py'),
    '_MODELS: dict[str, tuple[str, str]] = {\n    "lenet": ("lenet", "buddy-buckyball-lenet-run"),\n}\n',
  )
  const c = ctx(
    'stage: workload\nchip: toy\n改了哪些文件：\n- bb-tests/workloads/src/ModelTest/e2e/models/models/BertSmall/\n',
    ['bb-tests/workloads/src/ModelTest/e2e'],
  )
  const r = bindingCheck(c, bare)
  check('binding: 写集存在但未声明且三源俱无 → 豁免：模型未绑定', r.verdict === '豁免：模型未绑定', r.detail)
}
{
  // Partial registration: MODEL_LAYOUT only → 注册残缺 PRE-FAIL.
  const partial = mkdtempSync(join(tmpdir(), 'vr-deterministic-partial-'))
  mkdirSync(join(partial, 'examples/chips/toy'), { recursive: true })
  // chip layout root 存在（否则先命中「上游布局缺失」分支），本例测的是单模型注册残缺
  mkdirSync(join(partial, 'bb-tests/workloads/src/ModelTest/e2e/models/archs/buckyball/toy'), { recursive: true })
  mkdirSync(join(partial, 'bbdev/api/steps/workload'), { recursive: true })
  writeFileSync(
    join(partial, 'bbdev/api/steps/workload/01_build_event.step.py'),
    'MODEL_LAYOUT = {\n    "ghost": "Ghost",\n}\n',
  )
  mkdirSync(join(partial, 'bb-tests/workloads/scripts'), { recursive: true })
  writeFileSync(
    join(partial, 'bb-tests/workloads/scripts/build.py'),
    '_MODELS = {\n    "lenet": ("lenet", "buddy-buckyball-lenet-run"),\n}\n',
  )
  const c = ctx(
    'stage: chip\nphase: bind\nchip: toy\n--model ghost\n改了哪些文件：\n- bbdev MODEL_LAYOUT 增 ghost\n' +
      "预期应跑的测试：\n- workload --build '--chip toy --model ghost'\n",
    ['bbdev'],
  )
  const r = bindingCheck(c, partial)
  check('binding: 注册残缺（1/3）→ PRE-FAIL', r.verdict === 'PRE-FAIL' && r.detail.includes('注册残缺'), r.detail)
}
{
  // chip=toy + 声明模型，但检出树连 archs/buckyball/toy 整目录都没有（上游
  // e2e 子模块只有部分 chip）→ 直接给「上游布局缺失」可归因 PRE-FAIL。
  const nolayout = mkdtempSync(join(tmpdir(), 'vr-deterministic-nolayout-'))
  mkdirSync(join(nolayout, 'examples/chips/toy'), { recursive: true })
  mkdirSync(join(nolayout, 'bbdev/api/steps/workload'), { recursive: true })
  writeFileSync(
    join(nolayout, 'bbdev/api/steps/workload/01_build_event.step.py'),
    'MODEL_LAYOUT = {\n    "lenet": "LeNet",\n}\n',
  )
  mkdirSync(join(nolayout, 'bb-tests/workloads/scripts'), { recursive: true })
  writeFileSync(
    join(nolayout, 'bb-tests/workloads/scripts/build.py'),
    '_MODELS = {\n    "lenet": ("lenet", "buddy-buckyball-lenet-run"),\n}\n',
  )
  const c = ctx(
    'stage: chip\nphase: bind\nchip: toy\n--model lenet\n改了哪些文件：\n- bbdev MODEL_LAYOUT 增 lenet\n' +
      "预期应跑的测试：\n- workload --build '--chip toy --model lenet'\n",
    ['bbdev'],
  )
  const r = bindingCheck(c, nolayout)
  check(
    'binding: chip 无 layout 整目录 + 声明模型 → PRE-FAIL 上游布局缺失',
    r.verdict === 'PRE-FAIL' &&
      r.detail.includes('上游布局缺失') &&
      r.detail.includes('archs/buckyball/CMakeLists.txt'),
    r.detail,
  )
}
{
  // Bound but undeclared: change list wires archs/buckyball/pebble/BertSmall,
  // the tree has it fully bound AND the diff carries the e2e gitlink → PRE-FAIL.
  const c = ctx(
    'stage: chip\nchip: pebble\n改了哪些文件：\n- e2e：models/archs/buckyball/pebble/BertSmall/ 新 layout\n',
    ['bb-tests/workloads/src/ModelTest/e2e'],
  )
  const r = bindingCheck(c, root)
  check('binding: 已绑定未声明 → PRE-FAIL', r.verdict === 'PRE-FAIL' && r.detail.includes('未声明'), r.detail)
}
{
  // 终审 3（提到≠写了）：只改 ball 源码的 PR，change list 里连绑定路径都是**否定性**
  // 提及（「不动 …」）——change list 的提及子串不得单独构成写集，更不得命中未声明绑定 PRE-FAIL。
  const c = ctx(
    'stage: ball\nchip: pebble\n改了哪些文件：\n- examples/balls/relu/arch/src/main/scala/ReluBall.scala\n' +
      '- 不动 archs/buckyball/pebble/BertSmall（现行绑定本 PR 不触碰）\n',
    ['examples/balls/relu/arch/src/main/scala/ReluBall.scala'],
  )
  const r = bindingCheck(c, root)
  check(
    'binding: 只改 ball 源码 + 「不动 archs/buckyball/…」提及 → 豁免：无模型写集（不 PRE-FAIL）',
    r.verdict === '豁免：无模型写集',
    r.detail,
  )
}
{
  // 终审 3（写集语义）：MODEL_LAYOUT-only 写（diff 只有 bbdev gitlink）不构成 layout
  // 写入；此时 change list 提到三源齐备的绑定 → 降 note（豁免：模型未绑定），不判 PRE-FAIL。
  const c = ctx(
    'stage: workload\nchip: pebble\n改了哪些文件：\n- bbdev MODEL_LAYOUT 注释整理（无新增键）\n' +
      '- 现行登记 archs/buckyball/pebble/BertSmall 三源俱在（上游既有，本 PR 未写 e2e）\n',
    ['bbdev'],
  )
  const r = bindingCheck(c, root)
  check(
    'binding: diff 无 e2e gitlink/layout 写入时，未声明绑定判定降 note（提到≠写了）',
    r.verdict === '豁免：模型未绑定' && r.detail.includes('提到≠写了'),
    r.detail,
  )
}
// ── ball-expect（ball 落点期望：零事件分级 FAIL 分支的机器面字段）──
{
  const ok = validateManifest(
    ctx('stage: ball\nchip: toy\nphase: c-bemu\nprobe: s1 5\nball-expect: s1 GEMM,SMATMUL_OS\n'),
    root,
  )
  check(
    'manifest: ball-expect 合法行解析（stem + 逗号分隔 mnemonic 列表）',
    ok.errors.length === 0 &&
      ok.manifest.ballExpects.length === 1 &&
      ok.manifest.ballExpects[0].stem === 's1' &&
      JSON.stringify(ok.manifest.ballExpects[0].mnemonics) === JSON.stringify(['GEMM', 'SMATMUL_OS']),
    JSON.stringify({ expects: ok.manifest.ballExpects, errors: ok.errors }),
  )
  // bind 轮的测试集 = 声明模型在 build.py 的 run stem（probe 步骤逐模型 stem 生成）。
  const bind = validateManifest(
    ctx(
      'stage: chip\nchip: pebble\nphase: bind\n--model bertsmall\n' +
        'ball-expect: buddy-buckyball-bertsmall-run TRANSPOSE\n',
    ),
    root,
  )
  check(
    'manifest: ball-expect 指向声明模型的 run stem → 合法（bind 轮测试集含模型 stem）',
    bind.errors.length === 0,
    bind.errors.join('；'),
  )
  const off = validateManifest(
    ctx('stage: ball\nchip: toy\nphase: c-bemu\nprobe: s1 5\nball-expect: s2-baremetal GEMM\n'),
    root,
  )
  check(
    'manifest: ball-expect 的 stem 不在本轮测试集 → PRE-FAIL',
    off.errors.some(e => e.includes('不在本轮测试集')),
    off.errors.join('；'),
  )
  const badMnemonic = validateManifest(
    ctx('stage: ball\nchip: toy\nphase: c-bemu\nprobe: s1 5\nball-expect: s1 gemm_lower\n'),
    root,
  )
  check(
    'manifest: ball-expect mnemonic 小写不合形态 → 语法非法 PRE-FAIL（不静默丢弃）',
    badMnemonic.errors.some(e => e.includes('ball-expect 语法非法')),
    badMnemonic.errors.join('；'),
  )
  const tmpl = validateManifest(
    ctx('stage: ball\nchip: toy\nphase: c-bemu\nprobe: s1 5\nball-expect: <stem> <MNEMONIC>\n'),
    root,
  )
  check(
    'manifest: ball-expect 模板未填 → PRE-FAIL「清单模板未填」',
    tmpl.errors.some(e => e.includes('ball-expect 清单模板未填')) &&
      !tmpl.errors.some(e => e.includes('不在本轮测试集')),
    tmpl.errors.join('；'),
  )
  const prose = validateManifest(
    ctx('stage: ball\nchip: toy\nphase: c-bemu\nprobe: s1 5\nand the body says `ball-expect:` is not declared here\n'),
    root,
  )
  check(
    'manifest: 散文提及 `ball-expect:` ≠ 声明行（DECOR 行首口径）',
    prose.errors.length === 0 && prose.manifest.ballExpects.length === 0,
    prose.errors.join('；'),
  )
}

// ── slices-verify ──
{
  const sha = 'a'.repeat(40)
  const hit = ctx('stage: chip\nphase: integrate\nchip: toy\n', [], {
    headRefOid: sha,
    comments: [{ body: `VERDICT: PASS\n\n- stage: chip\n- phase: slices\n- head sha: \`${sha}\`\n` }],
    reviews: [],
  })
  check('slices-gate: 同 phase 且 head sha 相符的 PASS → found', slicesVerify(hit).found === true)

  const stale = ctx('stage: chip\nphase: integrate\nchip: toy\n', [], {
    headRefOid: sha,
    comments: [{ body: `VERDICT: PASS\n\n- phase: slices\n- head sha: \`${'b'.repeat(40)}\`\n` }],
    reviews: [],
  })
  check('slices-gate: 陈旧 head sha 的 PASS 不算数', slicesVerify(stale).found === false)

  const inReview = ctx('stage: chip\nphase: integrate\nchip: toy\n', [], {
    headRefOid: sha,
    comments: [],
    reviews: [{ body: `VERDICT: PASS\n\nphase: slices, head sha: ${sha}\n` }],
  })
  check('slices-gate: PASS 落在 review 面也算数（comments ∪ reviews）', slicesVerify(inReview).found === true)

  const na = slicesVerify(ctx('stage: ball\nphase: c-bemu\nchip: toy\n', [], { headRefOid: sha }))
  check('slices-gate: 非 integrate 轮 → applicable=false', na.applicable === false && na.found === false)

  const failOnly = ctx('stage: chip\nphase: integrate\nchip: toy\n', [], {
    headRefOid: sha,
    comments: [{ body: `VERDICT: FAIL\n\nphase: slices\nhead sha: ${sha}\n` }],
    reviews: [],
  })
  check('slices-gate: VERDICT: FAIL 不算 PASS 证据', slicesVerify(failOnly).found === false)

  // ── 声明行锚（DECOR 口径）三形态 ──
  // ① 真 slices PASS：自己的判定块里 `phase: slices` 顶到行首（bullet 装饰合法）。
  const realSlices = ctx('stage: chip\nphase: integrate\nchip: toy\n', [], {
    headRefOid: sha,
    comments: [
      {
        body:
          `VERDICT: PASS\n\n## CI 判定块照录\n- [stage] effective: chip\n` +
          `- [manifest] OK: stage=chip chip=toy phase=slices round=1 probe=无\n` +
          `- phase: slices\n- head sha: \`${sha}\`\n`,
      },
    ],
    reviews: [],
  })
  check(
    'slices-gate: 真 slices 轮 PASS（自带 `phase: slices` 声明行）→ found',
    slicesVerify(realSlices).found === true,
    slicesVerify(realSlices).note,
  )
  // ② 回顾性提及：integrate 轮自己的 PASS 报告回头说「上一轮 phase=slices 已过」——
  // 那个 phase= 在句子中间，不是声明行，不得点亮 found（旧正则正是这样假绿的）。
  const retrospective = ctx('stage: chip\nphase: integrate\nchip: toy\n', [], {
    headRefOid: sha,
    comments: [
      {
        body:
          `VERDICT: PASS\n\n本轮 integrate 直接执行：上一轮 phase=slices 已过，` +
          `故不自带补跑。\n- head sha: \`${sha}\`\n`,
      },
    ],
    reviews: [],
  })
  check(
    'slices-gate: 报告里回顾性提一句「上一轮 phase=slices 已过」不算声明 → found=false',
    slicesVerify(retrospective).found === false,
    slicesVerify(retrospective).note,
  )
  // ③ 纯散文 / phase 值不是 slices 而句子里带着 slices（实测形态：报告照录合法相位集
  //    「skeleton|slices|integrate|bind」）。旧正则的 [^\n]*slices 在这里假绿。
  const prose = ctx('stage: chip\nphase: integrate\nchip: toy\n', [], {
    headRefOid: sha,
    comments: [
      {
        body:
          `VERDICT: PASS\n\n- phase: declared \`c-bemu\` — 对 chip stage 非法取值` +
          `（合法集 skeleton|slices|integrate|bind）→ 按 v1 基线执行\n` +
          `- head sha: \`${sha}\`\n`,
      },
    ],
    reviews: [],
  })
  check(
    'slices-gate: phase 值非 slices 而正文含 slices（照录合法相位集）不算声明 → found=false',
    slicesVerify(prose).found === false,
    slicesVerify(prose).note,
  )
}

// ── perf-gate（probe-loop-check）──
{
  const sha = 'a'.repeat(40)
  const base = 'stage: ball\nchip: toy\nphase: c-bemu\nperf: s1-baremetal\nprobe: s1-baremetal 5\n'
  const prev = ctx(base, [], {
    headRefOid: sha,
    comments: [{ body: 'VERDICT: PASS\n\nprobe-evidence: other-stem cycles=99\n' }],
    reviews: [{ body: 'VERDICT: PASS\n\nprobe-evidence: s1-baremetal cycles=12345\n' }],
  })
  const r = probeLoopCheck(prev)
  check(
    'perf-gate: 同 stem 的上轮 probe-evidence 命中（reviews 面也算）且取 cycles',
    r.applicable === true && r.prevFound === true && r.prevCycles === 12345,
    r.note,
  )
  const newest = ctx(base, [], {
    headRefOid: sha,
    comments: [{ body: 'probe-evidence: s1-baremetal cycles=100' }, { body: 'probe-evidence: s1-baremetal cycles=80' }],
    reviews: [],
  })
  check('perf-gate: 多轮历史取最新一条作对照基', probeLoopCheck(newest).prevCycles === 80)
  const none = probeLoopCheck(ctx(base, [], { headRefOid: sha, comments: [], reviews: [] }))
  check(
    'perf-gate: 无同 stem 证据 → prev-found=false 且注明 baseline',
    none.prevFound === false && none.prevCycles === null && none.note.includes('baseline'),
    none.note,
  )
  const na = probeLoopCheck(ctx('stage: ball\nchip: toy\nphase: c-bemu\n', [], { headRefOid: sha }))
  check('perf-gate: 未声明 perf → applicable=false 不查', na.applicable === false && na.prevFound === false)
  // Cross-instrument discipline: a pmc line in a probe-phase round is a
  // reference in the note, never a comparison field — and the other way round.
  const pmc = probeLoopCheck(
    ctx(base, [], {
      headRefOid: sha,
      comments: [{ body: 'pmc-evidence: s1-baremetal calls=40 elapsed_avg=12.5 elapsed_max=30 elapsed_min=3' }],
      reviews: [],
    }),
  )
  check(
    'perf-gate: c-bemu 轮只有 pmc 取证行 → 仪器仍是 probe，pmc 不占对照基字段（prev-pmc=null、baseline）',
    pmc.instrument === 'probe' &&
      pmc.prevFound === false &&
      pmc.prevCycles === null &&
      pmc.prevPmc === null &&
      pmc.note.includes('只作参考，不作对照基'),
    JSON.stringify({ instrument: pmc.instrument, prevFound: pmc.prevFound, prevPmc: pmc.prevPmc, note: pmc.note }),
  )
}
// ── perf-gate：跨面时序合并（「取最新」按时间戳，不按数组位置）──
{
  const body = 'stage: ball\nchip: toy\nphase: c-bemu\nperf: s1\n'
  const gate = (comments, reviews) => probeLoopCheck({ body, files: [], comments, reviews })
  // review 面那条更早：comment 新 → 取 comment 的数（旧实现把 reviews 拼在后面，
  // 于是陈旧 review 覆盖了新 comment）。
  const commentNewer = gate(
    [{ body: 'probe-evidence: s1 cycles=50', createdAt: '2026-09-05T10:00:00Z' }],
    [{ body: 'probe-evidence: s1 cycles=100', submittedAt: '2026-09-01T10:00:00Z' }],
  )
  check(
    'perf-gate: review 陈旧 + comment 更新 → 取 comment 的 cycles（跨面按时间合并）',
    commentNewer.prevCycles === 50,
    commentNewer.note,
  )
  // 反方向：review 更新 → 取 review，且时间序要压过同面数组尾。
  const reviewNewer = gate(
    [{ body: 'probe-evidence: s1 cycles=50', createdAt: '2026-09-01T10:00:00Z' }],
    [{ body: 'probe-evidence: s1 cycles=100', submittedAt: '2026-09-05T10:00:00Z' }],
  )
  check('perf-gate: comment 陈旧 + review 更新 → 取 review 的 cycles', reviewNewer.prevCycles === 100, reviewNewer.note)
  const arrayTailIsOlder = gate(
    [],
    [
      { body: 'probe-evidence: s1 cycles=700', submittedAt: '2026-09-09T00:00:00Z' },
      { body: 'probe-evidence: s1 cycles=300', submittedAt: '2026-09-02T00:00:00Z' },
    ],
  )
  check(
    'perf-gate: 数组尾时间更旧 → 仍取时间最新那条（不再「尾覆盖」）',
    arrayTailIsOlder.prevCycles === 700,
    arrayTailIsOlder.note,
  )
}
// ── perf-gate：零事件轮哨兵（仪器不适用，不得当 baseline 空转）──
{
  const body = 'stage: ball\nchip: toy\nphase: c-bemu\nperf: s1\n'
  const r = probeLoopCheck({
    body,
    files: [],
    comments: [
      { body: 'probe-evidence: s1 cycles=none (instrument-not-applicable)', createdAt: '2026-09-05T00:00:00Z' },
    ],
    reviews: [],
  })
  check(
    'perf-gate: cycles=none 哨兵被识别（不是数字、也不是「无证据」）',
    r.prevSentinel === true && r.prevCycles === 'none' && r.prevFound === false,
    JSON.stringify({ s: r.prevSentinel, c: r.prevCycles }),
  )
  check(
    'perf-gate: 哨兵轮不得自称 baseline（note 与 baseline 判定都排除它）',
    r.note.includes('仪器不适用') && !r.note.includes('本轮为 baseline'),
    r.note,
  )
  // 哨兵压不住真正的数字：数字更新时仍是对照基。
  const newerNumber = probeLoopCheck({
    body,
    files: [],
    comments: [
      { body: 'probe-evidence: s1 cycles=none (instrument-not-applicable)', createdAt: '2026-09-01T00:00:00Z' },
      { body: 'probe-evidence: s1 cycles=640', createdAt: '2026-09-05T00:00:00Z' },
    ],
    reviews: [],
  })
  check(
    'perf-gate: 哨兵之后又有数字轮 → 对照基取数字，sentinel=false',
    newerNumber.prevCycles === 640 && newerNumber.prevSentinel === false && newerNumber.prevFound === true,
    newerNumber.note,
  )
}
// ── perf-gate：chip 维度防串台 ──
{
  const body = 'stage: ball\nchip: toy\nphase: c-bemu\nperf: s1\n'
  const r = probeLoopCheck({
    body,
    files: [],
    comments: [
      { body: 'probe-evidence: pebble/s1 cycles=999', createdAt: '2026-09-06T00:00:00Z' },
      { body: 'probe-evidence: toy/s1 cycles=4242', createdAt: '2026-09-05T00:00:00Z' },
    ],
    reviews: [],
  })
  check(
    'perf-gate: 别的 chip 的同名 stem 不匹配，本 chip 的行命中',
    r.prevCycles === 4242 && r.prevFound === true,
    r.note,
  )
  const onlyForeign = probeLoopCheck({
    body,
    files: [],
    comments: [{ body: 'probe-evidence: pebble/s1 cycles=999', createdAt: '2026-09-06T00:00:00Z' }],
    reviews: [],
  })
  check(
    'perf-gate: 只有别 chip 的行 → 无对照基（不得拿串台数当基线）',
    onlyForeign.prevFound === false && onlyForeign.prevCycles === null,
    onlyForeign.note,
  )
  // 标了本 chip 的行优先于更新的未标行，且优先这件事写在 note 里。
  const priority = probeLoopCheck({
    body,
    files: [],
    comments: [
      { body: 'probe-evidence: s1 cycles=111', createdAt: '2026-09-06T00:00:00Z' },
      { body: 'probe-evidence: toy/s1 cycles=222', createdAt: '2026-09-05T00:00:00Z' },
    ],
    reviews: [],
  })
  check(
    'perf-gate: chip 限定行优先于更新的未限定行，且注明被越过的条数',
    priority.prevCycles === 222 && priority.note.includes('1 条更新但未标 chip'),
    priority.note,
  )
}
// ── perf-gate：装饰形态容忍（与 field() 同口径）+ prev-budget ──
{
  const body = 'stage: ball\nchip: toy\nphase: c-bemu\nperf: s1\n'
  const decorated = probeLoopCheck({
    body,
    files: [],
    comments: [
      { body: 'VERDICT: PASS\n\n报告如下：\n\n- `probe-evidence: s1 cycles=808`\n', createdAt: '2026-09-05T00:00:00Z' },
    ],
    reviews: [],
  })
  check(
    'perf-gate: bullet+反引号装饰的取证行照样命中（与 manifest field() 同口径）',
    decorated.prevCycles === 808 && decorated.prevFound === true,
    decorated.note,
  )
  const budget = probeLoopCheck({
    body,
    files: [],
    comments: [{ body: 'probe: s1 9\n\n- `probe-evidence: s1 cycles=808`\n', createdAt: '2026-09-05T00:00:00Z' }],
    reviews: [],
  })
  check(
    'perf-gate: prev-budget 取自命中那条回贴里的 probe: 声明行',
    budget.prevBudget === 9,
    JSON.stringify(budget.prevBudget),
  )
  const unknown = probeLoopCheck({
    body,
    files: [],
    comments: [{ body: 'probe-evidence: s1 cycles=808', createdAt: '2026-09-05T00:00:00Z' }],
    reviews: [],
  })
  check(
    'perf-gate: 回贴未带 probe: 声明行 → prev-budget=unknown（不猜缺省值）',
    unknown.prevBudget === 'unknown' && unknown.note.includes('prev-budget=unknown'),
    JSON.stringify(unknown.prevBudget),
  )
  // rtl 相位不产 probe 步骤，两侧都没有预算：若在这里报 unknown，消费侧第 9 条的
  // 「预算不可比」分支会在每个 rtl 性能轮恒触发，等于把 pmc 这条通道整体判死。
  const rtlBudget = probeLoopCheck({
    body: 'stage: ball\nchip: toy\nphase: rtl\nperf: s1\n',
    files: [],
    comments: [
      {
        body: 'pmc-evidence: s1 calls=40 elapsed_avg=12.5 elapsed_max=30 elapsed_min=3',
        createdAt: '2026-09-05T00:00:00Z',
      },
    ],
    reviews: [],
  })
  check(
    'perf-gate: rtl（pmc 仪器）轮 prev-budget=不适用，且不得报 unknown 顶死对账通道',
    rtlBudget.instrument === 'pmc' &&
      rtlBudget.prevBudget === '不适用（pmc 仪器无 probe 预算）' &&
      rtlBudget.prevFound === true &&
      !rtlBudget.note.includes('prev-budget=unknown'),
    JSON.stringify({ i: rtlBudget.instrument, b: rtlBudget.prevBudget, n: rtlBudget.note }),
  )
  // 拼写不合规范的同 stem 行不得静默丢弃。
  const malformed = probeLoopCheck({
    body,
    files: [],
    comments: [{ body: 'probe-evidence: s1 cycles=~1200', createdAt: '2026-09-05T00:00:00Z' }],
    reviews: [],
  })
  check(
    'perf-gate: 不合严格拼写的取证行在 note 里点名（不静默当不存在）',
    malformed.prevFound === false && malformed.note.includes('拼写不合规范'),
    malformed.note,
  )
}
// ── perf-gate：rtl 相位的对照基是 pmc elapsed_avg ──
{
  const body = 'stage: ball\nchip: toy\nphase: rtl\nperf: s1\n'
  const r = probeLoopCheck({
    body,
    files: [],
    comments: [
      { body: 'probe-evidence: s1 cycles=99999', createdAt: '2026-09-01T00:00:00Z' },
      {
        body: 'pmc-evidence: s1 calls=40 elapsed_avg=12.5 elapsed_max=30 elapsed_min=3',
        createdAt: '2026-09-05T00:00:00Z',
      },
    ],
    reviews: [],
  })
  check(
    'perf-gate: rtl 轮 instrument=pmc 且对照基取 pmc elapsed_avg（calls/avg/max/min 全解析）',
    r.instrument === 'pmc' &&
      r.prevFound === true &&
      r.prevPmc !== null &&
      r.prevPmc.calls === 40 &&
      r.prevPmc.avg === 12.5 &&
      r.prevPmc.max === 30 &&
      r.prevPmc.min === 3,
    JSON.stringify({ i: r.instrument, p: r.prevPmc }),
  )
  check(
    'perf-gate: rtl 轮的 cycles 不进 prev-cycles 字段（两仪器各有自己的字段）',
    r.prevCycles === null && r.prevSentinel === false,
    JSON.stringify({ c: r.prevCycles, s: r.prevSentinel }),
  )
  check(
    'perf-gate: rtl 轮的同 stem cycles 只作参考、不作对照基（note 注明不同量）',
    r.note.includes('只作参考，不作对照基'),
    r.note,
  )
  const noPmc = probeLoopCheck({
    body,
    files: [],
    comments: [{ body: 'probe-evidence: s1 cycles=99999', createdAt: '2026-09-01T00:00:00Z' }],
    reviews: [],
  })
  check(
    'perf-gate: rtl 轮只有 probe 行没有 pmc 行 → prev-found=false（本轮为 baseline）',
    noPmc.prevFound === false && noPmc.prevPmc === null && noPmc.note.includes('本轮为 baseline'),
    noPmc.note,
  )
}

// ── CLI 面（终审 6 参数守卫）：五脚本缺 flag / 位置参数 → usage 抛出、非零退出；判定段照录 ──
{
  const cliCtx = (name, body) => {
    const p = join(root, name)
    writeFileSync(p, JSON.stringify({ body, files: [] }))
    return p
  }
  const run = (script, args) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [join(import.meta.dirname, script), ...args], { encoding: 'utf8' }),
      }
    } catch (error) {
      return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
  }
  const good = cliCtx(
    'context-ballexpect.json',
    'stage: ball\nchip: toy\nphase: c-bemu\nprobe: s1 5\nball-expect: s1 GEMM,SMATMUL_OS\n',
  )
  const ok = run('validate-manifest.mjs', ['--context', good, '--repo-root', root])
  check(
    'cli: [manifest] OK 块照录 ball-expect 声明行（会话侧的注入点）',
    ok.code === 0 && ok.out.includes('OK: stage=ball') && ok.out.includes('  ball-expect: s1 GEMM,SMATMUL_OS'),
    ok.out,
  )
  const noCtx = run('validate-manifest.mjs', ['--repo-root', root])
  check(
    'cli: 缺 --context → usage 抛出、非零退出（requireArgs 守卫，不猜缺省）',
    noCtx.code !== 0 &&
      noCtx.out.includes('usage: validate-manifest.mjs --context <context.json> --repo-root <dir>'),
    noCtx.out,
  )
  const noRoot = run('validate-manifest.mjs', ['--context', good])
  check(
    'cli: validate-manifest 缺 --repo-root 同样 usage 抛出',
    noRoot.code !== 0 && noRoot.out.includes('usage: validate-manifest.mjs'),
    noRoot.out,
  )
  // 五个判定脚本都走 requireArgs：零参数（缺 --context）一律 usage 抛出。
  for (const script of [
    'infer-stage.mjs',
    'validate-manifest.mjs',
    'binding-check.mjs',
    'slices-verify.mjs',
    'probe-loop-check.mjs',
  ]) {
    const r = run(script, [])
    check(
      `cli: ${script} 零参数 → usage 抛出（requireArgs：flag 缺失即抛，五脚本同一守卫）`,
      r.code !== 0 && r.out.includes(`usage: ${script} --context <context.json>`),
      r.out,
    )
  }
  // binding-check 的 CLI 面：缺第二个 flag（--repo-root）同样抛，不猜缺省。
  const bindNoRoot = run('binding-check.mjs', ['--context', good])
  check(
    'cli: binding-check 缺 --repo-root → usage 抛出（不猜 repo root 缺省）',
    bindNoRoot.code !== 0 &&
      bindNoRoot.out.includes('usage: binding-check.mjs --context <context.json> --repo-root <dir>'),
    bindNoRoot.out,
  )
  // binding-check 的 CLI 面正向：参数齐 → [binding] 段照常打到 stdout（判定块的注入面）。
  const bindOk = run('binding-check.mjs', ['--context', good, '--repo-root', root])
  check(
    'cli: binding-check 参数齐 → 打 [binding] 段与判定行',
    bindOk.code === 0 && bindOk.out.includes('[binding]') && /(豁免|PRE-FAIL)/.test(bindOk.out),
    bindOk.out,
  )
  // requireArgs 的「不猜位置参数」负例：只给位置参数、一个 flag 都没有 → 抛 usage。
  // （旧实现 args.indexOf(flag) === -1 时读的是 args[0]，这条调用会被静默接受。）
  for (const script of ['infer-stage.mjs', 'slices-verify.mjs', 'probe-loop-check.mjs']) {
    const r = run(script, [good])
    check(
      `cli: ${script} 只给位置参数 → usage 抛出（flag 缺失即抛，绝不拿 args[0] 顶替）`,
      r.code !== 0 && r.out.includes(`usage: ${script} --context <context.json>`),
      r.out,
    )
  }
}

// ── ref-context.mjs：tmpdir 里的真 git 仓 fixture（bb-verify ref 模式的上下文合成）──
{
  const grepo = mkdtempSync(join(tmpdir(), 'vr-ref-context-'))
  const git = (...args) =>
    execFileSync('git', ['-C', grepo, '-c', 'user.name=selftest', '-c', 'user.email=selftest@local', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  git('init', '-b', 'main')
  writeFileSync(join(grepo, 'README.md'), 'base\n')
  git('add', 'README.md')
  git('commit', '-m', 'base commit')
  const baseSha = git('rev-parse', 'HEAD').trim()
  git('checkout', '-b', 'verify/20260912-120000-deadbeef')
  writeFileSync(join(grepo, 'bb-verify-task.md'), 'stage: workload\nchip: toy\n')
  writeFileSync(join(grepo, 'notes.txt'), 'x\n')
  git('add', 'bb-verify-task.md', 'notes.txt')
  git('commit', '-m', 'verify: trial round')
  const headSha = git('rev-parse', 'HEAD').trim()

  const run = args => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [join(import.meta.dirname, 'ref-context.mjs'), ...args], {
          encoding: 'utf8',
        }),
      }
    } catch (error) {
      return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
  }
  const load = p => JSON.parse(readFileSync(p, 'utf8'))

  // 正向：带 bb-verify-task.md 的 verify/* 分支头 → title=commit subject、
  // body=任务文件内容、files=与 base 的 name-only diff、headRefOid=解析 sha。
  const out1 = join(grepo, 'context.json')
  const ok = run(['--repo', grepo, '--ref', 'verify/20260912-120000-deadbeef', '--out', out1, '--base', 'main'])
  const c1 = ok.code === 0 ? load(out1) : {}
  check(
    'ref-context: verify/* 分支头合成 context.json（title/body/files/headRefOid/comments/reviews）',
    ok.code === 0 &&
      c1.title === 'verify: trial round' &&
      c1.body === 'stage: workload\nchip: toy\n' &&
      JSON.stringify(c1.files) === JSON.stringify([{ path: 'bb-verify-task.md' }, { path: 'notes.txt' }]) &&
      c1.headRefOid === headSha &&
      Array.isArray(c1.comments) && c1.comments.length === 0 &&
      Array.isArray(c1.reviews) && c1.reviews.length === 0,
    `${ok.out} ${JSON.stringify(c1)}`,
  )
  // --sha 覆盖：workflow 传的是已检出的 HEAD（持久化根里分支只以 FETCH_HEAD 存在）。
  const out2 = join(grepo, 'context-sha.json')
  const okSha = run(['--repo', grepo, '--ref', 'FETCH_HEAD', '--sha', headSha, '--out', out2, '--base', 'main'])
  const c2 = okSha.code === 0 ? load(out2) : {}
  check(
    'ref-context: --sha 覆盖 ref 解析（body 仍取 bb-verify-task.md，headRefOid=传入 sha）',
    okSha.code === 0 && c2.headRefOid === headSha && c2.body === 'stage: workload\nchip: toy\n',
    `${okSha.out} ${JSON.stringify(c2)}`,
  )
  // 回退：无 bb-verify-task.md 的 commit → body=commit message；diff 为空时 files=[]。
  const out3 = join(grepo, 'context-base.json')
  const okBase = run(['--repo', grepo, '--ref', 'main', '--sha', baseSha, '--out', out3, '--base', 'main'])
  const c3 = okBase.code === 0 ? load(out3) : {}
  check(
    'ref-context: 无 bb-verify-task.md → body 回退 commit message，空 diff → files=[]',
    okBase.code === 0 && c3.title === 'base commit' && c3.body.trim() === 'base commit' && c3.files.length === 0,
    `${okBase.out} ${JSON.stringify(c3)}`,
  )
  // 守卫：缺 flag → usage 抛出、非零退出（与其余五脚本同一 requireArgs 纪律）。
  const noArgs = run([])
  check(
    'ref-context: 零参数 → usage 抛出、非零退出',
    noArgs.code !== 0 && noArgs.out.includes('usage: ref-context.mjs --repo <path> --ref <branch> --out <context.json>'),
    noArgs.out,
  )
  const unknownFlag = run(['--repo', grepo, '--ref', 'main', '--out', join(grepo, 'x.json'), '--bogus', 'x'])
  check('ref-context: 未知 flag → usage 抛出、非零退出', unknownFlag.code !== 0 && unknownFlag.out.includes('usage:'), unknownFlag.out)
  // 坏 ref/sha → 非零退出且错误信息可归因（不让半个上下文静默落盘）。
  const badRef = run(['--repo', grepo, '--ref', 'verify/does-not-exist', '--out', join(grepo, 'y.json')])
  check(
    'ref-context: 不存在的 ref → 非零退出（rev-parse 失败被包成可归因错误）',
    badRef.code !== 0 && badRef.out.includes('ref-context:'),
    badRef.out,
  )
  const badSha = run(['--repo', grepo, '--ref', 'main', '--sha', 'z'.repeat(40), '--out', join(grepo, 'z.json')])
  check(
    'ref-context: 不存在的 sha → 非零退出（cat-file -e 挡住笔误 sha）',
    badSha.code !== 0 && badSha.out.includes('ref-context:'),
    badSha.out,
  )
}

console.log(failed === 0 ? '\nSELFTEST OK' : `\nSELFTEST FAILED (${failed})`)
process.exit(failed === 0 ? 0 : 1)
