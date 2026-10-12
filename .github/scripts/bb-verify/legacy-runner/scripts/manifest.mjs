/**
 * Shared context parsing for the deterministic CI verdict scripts
 * (infer-stage / validate-manifest / binding-check / slices-verify /
 * probe-loop-check). The context is ref mode's synthesized JSON
 * (`context.json`, written by ref-context.mjs from the temp verify/* branch —
 * no PR is involved and comments/reviews are always empty).
 *
 * The evidence manifest lives in the context body (`body` = bb-verify-task.md
 * at the verified sha, else the commit message): `stage:` / `chip:` are
 * mandatory, `phase:` / `round:` / `probe: <stem> <minutes>` / `perf: <stem>` /
 * `ball-expect: <stem> <MNEMONIC>[,…]` / `--model <key>` (one key per line)
 * optional, and a change-list section headed by 「改了哪些文件」 (or a `## Changes`
 * heading) carries the declared write-set. Field lines may sit inside a fenced
 * block or a bullet (`- \`stage: ball\``), so extraction strips bullet/backtick
 * decoration and a trailing inline comment (`[ \t]+# …`) and takes the first
 * match per field.
 *
 * Pure node, zero dependencies — CI runs these scripts straight from the
 * local checkout before the plugin build exists.
 * @module verify-runner/scripts/manifest
 */

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** True when the module is the CLI entry point (not imported by a selftest). */
export function isMain(moduleUrl) {
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  return fileURLToPath(moduleUrl) === realpathSync(argv1)
}

/** Legal phase values per stage (phased-delivery contract). */
export const STAGE_PHASES = {
  workload: [],
  ball: ['c-bemu', 'rtl'],
  chip: ['skeleton', 'slices', 'integrate', 'bind'],
}

/**
 * Phases whose plan actually produces probe steps, i.e. the phases that CONSUME
 * a `probe: <stem> <分钟>` declaration: `ball/c-bemu`, `chip/bind`, and the
 * no-phase v1 baseline — and the baseline entry only consumes with THIS ROUND
 * declaring models: `bbdev_plan` adds baseline probe pairs inside `modelCoverage()`
 * (bbdev-plan.ts: `if (models.length > 0)`), so a probe/perf line in a models-less
 * baseline round has no execution carrier at all (对照：workload 轮 probe 无执行承载).
 * Everywhere else (`chip/skeleton|slices|integrate`, `ball/rtl`) `bbdev_plan`
 * generates no probe step at all. A probe declaration outside this whitelist buys
 * nothing — validate-manifest.mjs PRE-FAILs it (and PRE-FAILs the models-less
 * baseline combination) instead of dropping it silently, and probe-loop-check.mjs
 * uses the same set to decide whether a `probe-evidence` line is even the right
 * instrument for the round.
 */
export const PROBE_PHASES = new Set([undefined, 'c-bemu', 'bind'])

/** Widest-first stage order used for conflict resolution. */
const STAGE_ORDER = ['chip', 'ball', 'workload']

/**
 * The decoration prefix every manifest/evidence line is matched behind: leading
 * blanks, an optional bullet, an optional opening backtick. Field lines inside a
 * fenced block or a bullet list are the same field, so every declaration-line /
 * evidence-line pattern in these scripts is spelled from this prefix instead of
 * re-spelling it: `valueOf` carries it, and `parseManifest`'s field/probe/
 * ball-expect/model collection, validate-manifest.mjs's declaration gates,
 * probe-loop-check.mjs's evidence lines and slices-verify.mjs's phase lookup all
 * build on `valueOf` or on DECOR directly. 「取证行正则与 field() 同口径」 means
 * exactly this: one shared line anchor and one shared value-token class
 * (`` [^\s`]+ ``; `MODEL_DECL` is the one deliberate narrowing — a model key is an
 * identifier, see its own doc), with only the per-field tail (`<分钟>`,
 * `<MNEMONIC>`, the `…\s*$` end anchor) differing by design.
 */
export const DECOR = '^\\s*(?:[-*]\\s*)?`?'

/** Widest stage of a non-empty stage list; `undefined` for an empty list. */
export function widestStage(stages) {
  return STAGE_ORDER.find(s => stages.includes(s))
}

/** Load the context.json (ref mode: synthesized by ref-context.mjs). */
export function loadPrContext(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Value-capture head of one decorated declaration line: DECOR + `name:` +
 * optional backtick + the first bare token (value-token class `` [^\s`]+ ``).
 * This is the ONE spelling of 「取值行正则」: `parseManifest` collects its fields
 * through it, and validate-manifest.mjs's syntax gates and probe-loop-check.mjs's
 * evidence lines build their strict forms on its `.source` — so a line the parser
 * reads and a line the judges gate cannot disagree on what the value is. Each
 * strict form still appends its own tail (`` `?\s*$ ``, `<分钟>`, `<MNEMONIC>`).
 */
export const valueOf = name => new RegExp(`${DECOR}${name}\\s*[:：]\\s*\`?([^\\s\`]+)`)

/**
 * The one accepted `--model` declaration shape: a decorated line whose whole
 * content is `--model <模型键>` — line start (DECOR: blanks / bullet / opening
 * backtick), the flag, one bare key, line end (closing backtick tolerated).
 * `--model` carries no colon, so it cannot ride on `valueOf`; both this pattern
 * and the attempt pattern below keep DECOR as their line anchor and the same
 * value-token class, which is what keeps parser and gate in agreement.
 */
export const MODEL_DECL = new RegExp(`${DECOR}--model\\s+\`?([A-Za-z0-9][\\w-]*)\`?\\s*$`)
/** A line that starts with the `--model` TOKEN (not `--models/…`, not
 *  `--modelfoo`) — validate-manifest.mjs's 语法门 catch set. */
export const MODEL_ATTEMPT = new RegExp(`${DECOR}--model(?![\\w-])`)

/**
 * The five verdict scripts' shared CLI parsing: every named flag must APPEAR in
 * argv and carry a value that is not another flag; an absent flag, a flag at the
 * end of argv, or a flag followed by another flag all throw the usage string
 * (原则②：意外输入直接抛错 — argv is never read positionally, and there are no
 * defaults). Flags come back camelCased: `--repo-root` → `repoRoot`.
 */
export function requireArgs(usage, ...flags) {
  const args = process.argv.slice(2)
  const out = {}
  for (const flag of flags) {
    const at = args.indexOf(flag)
    if (at === -1) throw new Error(usage)
    const value = args[at + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(usage)
    out[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value
  }
  return out
}

/**
 * Drop every line's trailing inline comment (`[ \t]+# …`): the manifest/evidence
 * lines all `$`-anchor at line end, so without this a `phase: bind  # 注释` makes
 * the whole field silently vanish (measured: the round fell to the v1 baseline).
 * A line-leading `#` markdown heading is untouched — the pattern requires blank
 * before the hash. Shared by parseManifest and validate-manifest.mjs's per-line
 * syntax gates (probe/perf 严格行同口径).
 */
export const stripInlineComments = text =>
  text
    .split('\n')
    .map(line => line.replace(/[ \t]+#.*$/, ''))
    .join('\n')

/**
 * Extract the manifest fields from a context body. Every field is the first
 * match of its decorated-line pattern; absent fields stay `undefined`.
 */
export function parseManifest(body) {
  const text = stripInlineComments(body ?? '')
  const field = name => {
    const match = text.match(new RegExp(`${valueOf(name).source}\`?\\s*$`, 'm'))
    return match?.[1]
  }
  const probes = []
  for (const match of text.matchAll(
    new RegExp(`${valueOf('probe').source}\\s+(\\d+)\\s*(?:分钟|min)?\`?\\s*$`, 'gm'),
  )) {
    probes.push({ stem: match[1], minutes: Number(match[2]) })
  }
  // `--model` counts ONLY as its own DECOR declaration line (MODEL_DECL above):
  // 散文提一句 (`… 只是引用上游 --model gpt2 的写法`) and 命令行示例
  // (`bbdev workload --build '--chip toy --model bertsmall'`, fenced or not) are
  // both mentions, not declarations. The whole-line 「这行里有 workload/bbdev 就算
  // 命令上下文」判据 this leg replaces collected both, and the two are the two
  // directions of the reported hole: the prose mention fabricated a phantom model
  // whose missing directory PRE-FAILed a legal manifest, while the fenced example
  // fabricated a real-looking declaration that silently switched off the
  // models-less-baseline PRE-FAIL. A line that starts like a model declaration but
  // is not one is named by validate-manifest.mjs's 语法门, never dropped here.
  const models = []
  for (const line of text.split('\n')) {
    const key = line.match(MODEL_DECL)?.[1]
    if (key !== undefined && !models.includes(key)) models.push(key)
  }
  // `ball-expect: <stem> <MNEMONIC>[,…]` — the 清单侧 ball 落点期望（零事件分级的 FAIL
  // 判据，playbook「失败语义」只看它）。一个 stem 一行；mnemonic 是 ballISA 大写标识符。
  // 不合式的行由 validate-manifest.mjs 的语法门点名，不在这里静默收集。
  const ballExpects = []
  for (const match of text.matchAll(
    new RegExp(`${valueOf('ball-expect').source}\\s+([A-Z][A-Z0-9_]*(?:,[A-Z][A-Z0-9_]*)*)\`?\\s*$`, 'gm'),
  )) {
    ballExpects.push({ stem: match[1], mnemonics: match[2].split(',') })
  }
  return {
    stage: field('stage'),
    phase: field('phase'),
    round: field('round'),
    chip: field('chip'),
    // `perf: <stem>` names the round's performance subject: the round owes a
    // cycles delta for that stem (probe-loop-check.mjs supplies the previous
    // round's number, the playbook fails the round when a declared delta is
    // missing from the report).
    perf: field('perf'),
    probes,
    models,
    ballExpects,
    changeRegion: extractChangeRegion(text),
  }
}

/**
 * The change-list region of the body: from the 「改了哪些文件」 marker (or a
 * `## Changes` heading) to the next heading, the expected-tests marker, or a
 * closing fence. Empty string when the body carries no change list.
 */
function extractChangeRegion(body) {
  const start = body.search(/改了哪些文件|^#{1,6}\s+Changes\b/m)
  if (start === -1) return ''
  const rest = body.slice(start)
  const lines = rest.split('\n')
  const end = lines.findIndex(
    (line, i) => i > 0 && (/^#{1,6}\s/.test(line) || /预期应跑|Expected tests/.test(line) || /^```\s*$/.test(line)),
  )
  return (end === -1 ? lines : lines.slice(0, end)).join('\n')
}

/** e2e submodule gitlink path (parent repo) — the layout/models writes' carrier. */
const E2E_GITLINK_REL_PATH = 'bb-tests/workloads/src/ModelTest/e2e'

/**
 * Model write-set detection over the DIFF paths, with the change list demoted to
 * a corroborating channel: 提到≠写了 — a prose bullet that merely names a binding
 * path (「不动 archs/buckyball/…」) is NOT a write-set. A change-list hit counts
 * only with a diff carrier for exactly the fact it declares:
 *   • ModelTest/build.py paths in the diff = direct write (includes the e2e
 *     gitlink, whose parent diff shows only the pointer — a bare pointer
 *     movement needs the MODEL_LAYOUT carrier to count as a binding write);
 *   • `bbdev MODEL_LAYOUT` = the layout dict's only diff form is the `bbdev`
 *     gitlink, so a MODEL_LAYOUT mention plus that pointer moving is a write.
 */
export function hasModelWriteSet(filePaths, changeRegion) {
  const diffHit = filePaths.some(
    p => p.includes('bb-tests/workloads/src/ModelTest') || p === 'bb-tests/workloads/scripts/build.py',
  )
  const layoutWrite =
    changeRegion.includes('MODEL_LAYOUT') && filePaths.some(p => p === 'bbdev' || p.startsWith('bbdev/'))
  return diffHit || layoutWrite
}

/**
 * 写集语义 of a BINDING write — required before an undeclared binding may be
 * PRE-FAILed: the diff must actually carry the e2e gitlink or a layout-directory
 * addition/change. A MODEL_LAYOUT-only write (bbdev pointer) registers a model
 * key but writes no binding layout, so it does not qualify; a change-list mention
 * alone never does (提到≠写了 → binding-check demotes such hits to a note).
 */
export function writesBinding(filePaths) {
  return filePaths.some(
    p =>
      p === E2E_GITLINK_REL_PATH || p.startsWith(`${E2E_GITLINK_REL_PATH}/`) || p.includes('/models/archs/buckyball/'),
  )
}

// ── bbdev/e2e ground-truth readers (checkout tree = the verified sha) ──

const MODEL_LAYOUT_PATH = 'bbdev/api/steps/workload/01_build_event.step.py'
const BUILD_PY_PATH = 'bb-tests/workloads/scripts/build.py'

/** MODEL_LAYOUT keys — the contractual model-key fact source. */
export function readModelLayoutKeys(repoRoot) {
  const text = readFileSync(`${repoRoot}/${MODEL_LAYOUT_PATH}`, 'utf8')
  const block = text.match(/MODEL_LAYOUT\s*=\s*\{([\s\S]*?)\n\}/)
  if (block === null) throw new Error(`MODEL_LAYOUT dict not found in ${MODEL_LAYOUT_PATH}`)
  return Object.fromEntries([...block[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map(m => [m[1], m[2]]))
}

/** build.py `_MODELS` entries: model key → ninja run stem. */
export function readBuildPyModels(repoRoot) {
  const text = readFileSync(`${repoRoot}/${BUILD_PY_PATH}`, 'utf8')
  const block = text.match(/_MODELS[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (block === null) throw new Error(`_MODELS dict not found in ${BUILD_PY_PATH}`)
  return Object.fromEntries([...block[1].matchAll(/"([^"]+)"\s*:\s*\("[^"]+",\s*"([^"]+)"\)/g)].map(m => [m[1], m[2]]))
}

/** archs layout root of one chip: e2e models/archs/buckyball/<chip>/ (its absence = 上游布局缺失). */
export function chipLayoutRootRelPath(chip) {
  return `bb-tests/workloads/src/ModelTest/e2e/models/archs/buckyball/${chip}`
}

/** archs layout dir of one bound model: e2e models/archs/buckyball/<chip>/<layout>. */
export function archsLayoutRelPath(chip, layoutDir) {
  return `bb-tests/workloads/src/ModelTest/e2e/models/archs/buckyball/${chip}/${layoutDir}`
}

/** Model source dir of one model: e2e models/models/<dir>. */
export function modelSourceRelPath(modelDir) {
  return `bb-tests/workloads/src/ModelTest/e2e/models/models/${modelDir}`
}
