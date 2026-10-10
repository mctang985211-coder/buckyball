#!/usr/bin/env node
/**
 * probe-loop-check.mjs — previous-round evidence lookup for perf rounds.
 *
 * A `perf: <stem>` manifest line declares this round a PERFORMANCE round: its
 * report owes a delta for that stem. A delta is only computable against the
 * previous evidence of the SAME stem measured with the SAME instrument, so this
 * script extracts it from the context's comments ∪ reviews (when such a history
 * face exists, a PASS report can land on either one) instead of letting the
 * session re-read and re-derive it by hand.
 *
 * Ref-mode fail-safe (intended behaviour, not a bug): ref-context.mjs
 * synthesizes comments=[] and reviews=[] for every temp-branch round (there is
 * no PR, so there is no per-round history at all) ⇒ no evidence line can ever be
 * found ⇒ `prev-found` stays false and EVERY perf round is reported as a
 * baseline round (playbook 9d: baseline=true → 「本轮为 baseline」, no FAIL); a
 * 零事件哨兵 round cannot be observed either. The lookup keeps its full
 * timeline / instrument / chip logic so a future context source carrying real
 * history re-activates it unchanged — the 9b delta obligation only exists when
 * prev-found is true.
 *
 * Evidence lines are machine-readable and single-spelled, because the probe
 * round's 回贴 format is this contract's own product (no upstream analogue):
 *
 *   probe-evidence: <stem> cycles=<span_cycles>
 *   probe-evidence: <chip>/<stem> cycles=<span_cycles>                 (chip 维度)
 *   probe-evidence: <stem> cycles=none (instrument-not-applicable)      (零事件轮哨兵)
 *   pmc-evidence: <stem> calls=<n> elapsed_avg=<x> elapsed_max=<y> elapsed_min=<z>
 *
 * `cycles` is the analysis report's `span_cycles` value verbatim — the
 * `span_cycles: {total_cyc}` line printed by the itrace block of
 * `bbdev/api/steps/bebop/bemu/scripts/bemu_analysis.py` (stable path; line
 * numbers are not referenced, the bbdev submodule pointer moves), so the
 * number in the comment and the number the analyser printed are the same fact.
 * Three lookup rules, each one covering a way the naive version returned the wrong
 * base silently:
 *
 * 1. 「最新」是时间序，不是数组尾。comments 带 `createdAt`、reviews 带
 *    `submittedAt`；两面先按各自时间戳合并成一条时间线再取最新命中 —— gh 的两个
 *    数组各自成序，拼接后的「数组尾」不是那两个面的时间序，会取到陈旧轮次。
 * 2. 仪器按相位分相（phased-delivery 契约）：`rtl` 轮对照 `pmc-evidence` 的
 *    `elapsed_avg`（该相位的 plan 里没有 probe 步骤，probe 行不可能存在）；其余会
 *    消费 probe 行的相位（c-bemu、bind、无 phase 基线带 models）对照
 *    `probe-evidence` 的 cycles。另一仪器的行照录为参考，永不顶替对照基 ——
 *    cycles 与 elapsed_avg 不是同一个量。
 * 3. 行的识别与 manifest.mjs 的 field() 同口径（行首空白 + bullet + 反引号装饰皆
 *    可）；stem 位置可带 chip 限定（`toy/s1`）用于多 chip 变更集防串台：别的 chip 的
 *    行不匹配，标了本清单 chip 的行优先于未标 chip 的行。
 *
 * Output (`[perf-gate]`), one stable key set regardless of instrument:
 * `applicable` (a perf round was declared), `phase`, `instrument`,
 * `prev-found` (a comparison base exists FOR THIS INSTRUMENT), `prev-cycles`,
 * `prev-sentinel`, `prev-pmc`, `prev-elapsed-avg`, `prev-budget` (the previous
 * round's probe budget in minutes, `unknown` when its 回贴 carried no
 * `probe:` line to read it from; on rtl rounds the value is
 * `不适用（pmc 仪器无 probe 预算）` — that phase generates no probe step, so there is
 * no budget to compare and the playbook's 「预算不可比」 branch must not fire there)
 * and `baseline`. The verdict rule stays with
 * the playbook: perf + prev-found → the report must carry the delta, missing =
 * FAIL「性能结论无证据」; perf + baseline=true → the report notes「本轮为
 * baseline」; prev-sentinel → 上一轮已声明仪器不适用（零事件），本轮既没有对照
 * 基也不得自称 baseline，结论须照录仪器不适用条款。
 *
 * Usage: node probe-loop-check.mjs --context context.json
 */
import { isMain, loadPrContext, parseManifest, requireArgs, valueOf, DECOR, PROBE_PHASES } from './manifest.mjs'

/**
 * One machine-readable evidence line, per instrument. Every pattern is built on
 * manifest.mjs's shared `valueOf` (its `DECOR` prefix being the same decoration
 * `field()` strips), so a line the manifest parser can read, this lookup can
 * read too (行首空白、bullet、反引号装饰皆合法), and the two never diverge on
 * what counts as a line.
 */
const EVIDENCE_PATTERNS = {
  probe: new RegExp(
    `${valueOf('probe-evidence').source}` + '`?\\s+cycles=(\\d+|none)(?:\\s*\\(instrument-not-applicable\\))?`?\\s*$',
    'gm',
  ),
  pmc: new RegExp(
    `${valueOf('pmc-evidence').source}` +
      '`?\\s+calls=(\\d+)\\s+elapsed_avg=([\\d.]+)\\s+elapsed_max=([\\d.]+)\\s+elapsed_min=([\\d.]+)`?\\s*$',
    'gm',
  ),
}

/** Any line that TRIES to be an evidence line — used to shout about the ones
 *  whose spelling does not conform instead of dropping them quietly. */
const LOOSE_EVIDENCE = new RegExp(`${DECOR}(?:probe|pmc)-evidence\\s*[:：][^\\n]*$`, 'gm')

/** `<chip>/<stem>` or bare `<stem>` → its scope and its stem. */
function splitTarget(target) {
  const slash = target.lastIndexOf('/')
  return slash === -1 ? { chip: null, stem: target } : { chip: target.slice(0, slash), stem: target.slice(slash + 1) }
}

/**
 * comments ∪ reviews as one timeline, oldest first, ordered by each face's own
 * timestamp (`createdAt` / `submittedAt`). An untimestamped document sorts to
 * the front and is counted in the note: 「最新」may never be decided by the
 * position of a face's array. `seq` keeps the original order stable inside ties
 * and among the untimestamped ones.
 */
function evidenceTimeline(context) {
  const docs = [
    ...(context.comments ?? []).map((c, i) => ({
      body: c?.body ?? '',
      at: c?.createdAt,
      face: `comment[${i}]`,
      seq: i,
    })),
    ...(context.reviews ?? []).map((r, i) => ({
      body: r?.body ?? '',
      at: r?.submittedAt,
      face: `review[${i}]`,
      seq: (context.comments ?? []).length + i,
    })),
  ]
  const undated = docs.filter(d => Number.isNaN(Date.parse(d.at ?? ''))).length
  const stamp = d => (Number.isNaN(Date.parse(d.at ?? '')) ? Number.NEGATIVE_INFINITY : Date.parse(d.at))
  return { docs: docs.sort((a, b) => stamp(a) - stamp(b) || a.seq - b.seq), undated }
}

/**
 * Every strict-format evidence line of one instrument that names this stem, in
 * timeline order, split by whether its chip scope (if any) is this manifest's
 * chip. `eligible` feeds the base lookup; `foreign` is only ever reported —
 * another chip's measurement is not this round's comparison base.
 */
function collectHits(docs, kind, stem, chip) {
  const eligible = []
  const foreign = []
  for (const doc of docs) {
    for (const match of doc.body.matchAll(EVIDENCE_PATTERNS[kind])) {
      const target = splitTarget(match[1])
      if (target.stem !== stem) continue
      const hit = { doc, line: match[0].trim(), groups: match, scoped: target.chip !== null }
      if (target.chip !== null && target.chip !== chip) foreign.push(hit)
      else eligible.push(hit)
    }
  }
  return { eligible, foreign }
}

/**
 * The comparison base: the newest hit wins, and a chip-scoped hit outranks an
 * unqualified one (the 防串台 priority). `superseded` counts the newer
 * unqualified lines that priority left out, so the choice never stays hidden.
 */
function pickBase(hits) {
  const scoped = hits.filter(h => h.scoped)
  const pool = scoped.length === 0 ? hits : scoped
  const hit = pool.length === 0 ? null : pool[pool.length - 1]
  return {
    hit,
    superseded: hit === null ? 0 : hits.slice(hits.indexOf(hit) + 1).filter(h => !h.scoped).length,
  }
}

/**
 * Previous round's probe budget in minutes, read from the SAME document that
 * produced the hit: the 回贴 template carries its `probe: <stem> <分钟>` line,
 * and that line's number IS the budget. The evidence line itself has no budget
 * field, so absence is reported as `unknown` rather than guessed. Only ever
 * called for the probe instrument — the caller reports rtl/pmc rounds as
 * `不适用（pmc 仪器无 probe 预算）` without consulting this, since that phase
 * generates no probe step and therefore has no budget on either side.
 */
function budgetOf(body, stem) {
  const declared = parseManifest(body).probes.filter(p => splitTarget(p.stem).stem === stem)
  return declared.length === 0 ? 'unknown' : declared[declared.length - 1].minutes
}

/**
 * Evidence-looking lines that name this stem but match NEITHER strict spelling
 * — these are the ones the lookup genuinely cannot read, and they are reported
 * rather than treated as absent. Lines that ARE well-formed but merely lost the
 * newest/chip-scoped selection are not malformed and never appear here (their
 * own clause in the note says why they were not the base).
 */
function collectMalformed(docs, stem, strictLines) {
  const read = new Set(strictLines)
  const malformed = []
  for (const doc of docs) {
    for (const match of doc.body.matchAll(LOOSE_EVIDENCE)) {
      const line = match[0].trim()
      const target = line.match(/(?:probe|pmc)-evidence\s*[:：]\s*`?([^\s`]+)/)?.[1]
      // The subject token of an unreadable line can itself be malformed, so
      // compare loosely there too; anything naming a different stem is none of
      // this round's business.
      if (target === undefined || splitTarget(target).stem !== stem || read.has(line)) continue
      malformed.push(line)
    }
  }
  return malformed
}

export function probeLoopCheck(context) {
  const manifest = parseManifest(context.body)
  const stem = manifest.perf
  if (stem === undefined) {
    return {
      applicable: false,
      stem: null,
      phase: manifest.phase ?? null,
      instrument: null,
      prevFound: false,
      prevCycles: null,
      prevSentinel: false,
      prevPmc: null,
      prevBudget: 'unknown',
      note: '清单未声明 perf: <stem>，非性能轮，不查',
    }
  }
  const instrument = manifest.phase === 'rtl' ? 'pmc' : 'probe'
  const { docs, undated } = evidenceTimeline(context)
  const probeHits = collectHits(docs, 'probe', stem, manifest.chip)
  const pmcHits = collectHits(docs, 'pmc', stem, manifest.chip)
  const probeBase = pickBase(probeHits.eligible)
  const pmcBase = pickBase(pmcHits.eligible)
  const foreign = [...probeHits.foreign, ...pmcHits.foreign]

  const probeHit = instrument === 'probe' ? probeBase.hit : null
  const pmcHit = instrument === 'pmc' ? pmcBase.hit : null
  const sentinel = probeHit !== null && probeHit.groups[2] === 'none'
  const prevFound = instrument === 'pmc' ? pmcHit !== null : probeHit !== null && !sentinel
  // The instrument's own reading only: the other instrument's number stays in
  // the note as a reference line and never occupies a comparison field, so no
  // consumer can mistake one quantity for the other.
  const prevCycles = probeHit === null ? null : probeHit.groups[2] === 'none' ? 'none' : Number(probeHit.groups[2])
  const prevPmc =
    pmcHit === null
      ? null
      : {
          calls: Number(pmcHit.groups[2]),
          avg: Number(pmcHit.groups[3]),
          max: Number(pmcHit.groups[4]),
          min: Number(pmcHit.groups[5]),
          line: pmcHit.line,
        }
  const base = instrument === 'pmc' ? pmcBase : probeBase
  const baseHit = instrument === 'pmc' ? pmcHit : probeHit
  const otherHit = instrument === 'pmc' ? probeBase.hit : pmcBase.hit
  const otherName = instrument === 'pmc' ? 'probe-evidence' : 'pmc-evidence'
  const otherWhy =
    instrument === 'pmc'
      ? '——cycles 与本相位的 elapsed_avg 不同量，只作参考，不作对照基'
      : '——本相位仪器是 probe（rtl 才用 pmc），只作参考，不作对照基'
  // The budget is a probe-instrument fact: the rtl (pmc) phase generates no probe
  // pair at all, so it has no budget to compare — reporting `unknown` there would
  // make the playbook's 「预算不可比」 branch fire on every rtl perf round and
  // silently disable that instrument's whole comparison channel.
  const prevBudget =
    instrument === 'pmc'
      ? '不适用（pmc 仪器无 probe 预算）'
      : baseHit === null
        ? 'unknown'
        : budgetOf(baseHit.doc.body, stem)
  const malformed = collectMalformed(
    docs,
    stem,
    [...probeHits.eligible, ...probeHits.foreign, ...pmcHits.eligible, ...pmcHits.foreign].map(h => h.line),
  )

  const phaseText = manifest.phase ?? '无（v1 基线）'
  const instrumentText = instrument === 'pmc' ? 'pmc-evidence.elapsed_avg（rtl 仪器）' : 'probe-evidence.cycles'
  const scan = `perf=${stem}（phase=${phaseText}，仪器=${instrumentText}）：comments∪reviews 共 ${docs.length} 条里`
  const stamp = hit =>
    `${hit.doc.face}${Number.isNaN(Date.parse(hit.doc.at ?? '')) ? '，无时间戳（按最旧排）' : ` @ ${hit.doc.at}`}`

  // Head clause: what the lookup settled on.
  const head = sentinel
    ? `上轮取证行是零事件哨兵「${probeHit.line}」：仪器不适用轮 —— 本轮没有 cycles 对照基，但也不得自称 baseline，结论须照录仪器不适用条款`
    : baseHit === null
      ? `无同 stem 的 ${instrument === 'pmc' ? 'pmc-evidence' : 'probe-evidence'} 行 → 本轮为 baseline`
      : `对照基「${baseHit.line}」（${stamp(baseHit)}）`

  // Trailing clauses: every fact the head choice depends on, stated rather than
  // left implicit — the other instrument's line, the phase whitelist, the chip
  // priority and exclusions, the budget, the undated history, and the
  // spellings this lookup could not read at all.
  const extras = [
    otherHit === null ? '' : `另有同 stem ${otherName}「${otherHit.line}」${otherWhy}`,
    instrument === 'probe' && !PROBE_PHASES.has(manifest.phase)
      ? `注意 phase=${phaseText} 不在消费 probe 行的相位白名单 ${[...PROBE_PHASES].map(p => p ?? '无 phase').join('/')} 内（validate-manifest 应已 PRE-FAIL）`
      : '',
    base.superseded > 0 ? `${base.superseded} 条更新但未标 chip 的同 stem 行按 chip 维度优先规则未采用` : '',
    foreign.length === 0
      ? ''
      : `${foreign.length} 条同 stem 取证行标的是别的 chip（${foreign.map(h => h.line).join(' | ')}），不属本清单的对照基，已排除`,
    baseHit === null
      ? ''
      : instrument === 'pmc'
        ? 'prev-budget=不适用（rtl 相位没有 probe 步骤，预算维度不参与对账）'
        : prevBudget === 'unknown'
          ? '上轮预算未在其回贴的 probe: 声明行里出现 → prev-budget=unknown'
          : `上轮预算 ${prevBudget}min`,
    undated > 0 ? `${undated} 条历史无时间戳，按最旧处理` : '',
    malformed.length > 0
      ? `${malformed.length} 条同 stem 取证行拼写不合规范（严格式 probe-evidence: <stem> cycles=<N> / pmc-evidence: <stem> calls=<n> elapsed_avg=<x> elapsed_max=<y> elapsed_min=<z>）未作对照基：${malformed.join(' | ')}`
      : '',
  ].filter(text => text !== '')

  return {
    applicable: true,
    stem,
    phase: manifest.phase ?? null,
    instrument,
    prevFound,
    prevCycles,
    prevSentinel: sentinel,
    prevPmc,
    prevBudget,
    note: `${scan}${[head, ...extras].join('；')}`,
  }
}

function main() {
  const { context: contextPath } = requireArgs('usage: probe-loop-check.mjs --context <context.json>', '--context')
  const r = probeLoopCheck(loadPrContext(contextPath))
  console.log('[perf-gate]')
  console.log(`  applicable: ${r.applicable}`)
  if (!r.applicable) {
    console.log(`  note: ${r.note}`)
    return
  }
  console.log(`  perf: ${r.stem}`)
  console.log(`  phase: ${r.phase ?? '无（v1 基线）'}`)
  console.log(
    `  instrument: ${r.instrument === 'pmc' ? 'pmc（对照基=elapsed_avg；rtl 相位）' : 'probe（对照基=cycles）'}`,
  )
  console.log(`  prev-found: ${r.prevFound}`)
  // Every key is printed on every round — the block's shape does not depend on
  // the instrument, only the values do. The non-applicable instrument's key
  // reads （无）: its line, if one exists, is in the note as a reference and
  // never as a base, so no consumer can pick a number up by accident.
  console.log(
    `  prev-cycles: ${r.prevCycles === null ? '（无）' : r.prevCycles === 'none' ? 'none（零事件哨兵：仪器不适用）' : r.prevCycles}`,
  )
  console.log(`  prev-sentinel: ${r.prevSentinel}`)
  console.log(
    `  prev-pmc: ${r.prevPmc === null ? '（无）' : JSON.stringify({ calls: r.prevPmc.calls, avg: r.prevPmc.avg, max: r.prevPmc.max, min: r.prevPmc.min })}`,
  )
  console.log(`  prev-elapsed-avg: ${r.prevPmc === null ? '（无）' : r.prevPmc.avg}`)
  console.log(`  prev-budget: ${r.prevBudget}`)
  // The reading the playbook needs spelled out: 「no comparison base」 and
  // 「this is the baseline」 are different facts, and the sentinel round is
  // neither — saying `baseline: false` here is what keeps a zero-event previous
  // round from being re-labelled a fresh start every round thereafter.
  console.log(`  baseline: ${!r.prevFound && !r.prevSentinel}`)
  console.log(`  note: ${r.note}`)
}

if (isMain(import.meta.url)) {
  main()
}
