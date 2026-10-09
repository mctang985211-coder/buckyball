#!/usr/bin/env node
/**
 * slices-verify.mjs — slices-round PASS evidence lookup for integrate rounds.
 *
 * Searches the context's comments ∪ reviews (both faces — when a history face
 * exists, a PASS report may land as a review, invisible to `--comments`) for a
 * report whose first line is `VERDICT: PASS`, which DECLARES the slices phase on
 * a line of its own (the manifest's DECOR line-start discipline: `phase: slices`
 * at the line start, slices as the value — a retrospective or mid-sentence
 * mention is not a declaration), and whose recorded head sha matches the current
 * head (a stale PASS must not count). Only meaningful when the manifest declares
 * `phase: integrate`; any other phase prints n/a.
 * The "自带补跑" decision on `found: false` stays with the verifier prompt.
 *
 * Ref-mode fail-safe (intended behaviour, not a bug): ref-context.mjs
 * synthesizes comments=[] and reviews=[] for every temp-branch round (there is
 * no PR, so there is no history face at all) ⇒ bodies is empty ⇒ `found: false`
 * is the only possible outcome ⇒ on an integrate round the playbook's
 * 「未见有效 slices 轮 PASS，本轮自带补跑」 branch always fires (prompt.ts item 7:
 * found=false → the round self-runs the slices sequence). An empty history must
 * never be read as 「slices 已过」, so the lookup keeps its full strict shape
 * (VERDICT: PASS + declared `phase: slices` + matching head sha) and would
 * re-activate unchanged if a future context source carried real history.
 *
 * Usage: node slices-verify.mjs --context context.json
 */
import { isMain, loadPrContext, parseManifest, requireArgs, DECOR } from './manifest.mjs'

export function slicesVerify(context) {
  const phase = parseManifest(context.body).phase
  if (phase !== 'integrate') {
    return { applicable: false, found: false, note: `phase=${phase ?? '无'}，非 integrate 轮，不查` }
  }
  const headSha = context.headRefOid
  if (headSha === undefined) {
    return { applicable: true, found: false, note: 'context 缺 headRefOid，无法核对 head sha，按未命中处理' }
  }
  const bodies = [...(context.comments ?? []).map(c => c.body), ...(context.reviews ?? []).map(r => r.body)]
  // `phase: slices` must be a DECLARATION of that report's own phase, in the same
  // 口径 manifest.mjs anchors its field lines with: DECOR at the line start, the
  // separator right behind the name, and `slices` as the VALUE. The old unanchored
  // /phase\s*[:=：][^\n]*\bslices\b/ lit up on any line carrying both tokens, so an
  // integrate/bind report that merely looked back (「上一轮 phase=slices 已过」) — or
  // prose that just mentioned the word slices after some phase value — counted as
  // slices evidence and this round skipped the 自带补跑 it owed.
  const phaseRe = new RegExp(`${DECOR}phase\\s*[:=：]\\s*\`?slices(?![\\w-])`, 'm')
  const matches = bodies.filter(body => /^VERDICT:\s*PASS/.test(body) && phaseRe.test(body) && body.includes(headSha))
  return {
    applicable: true,
    found: matches.length > 0,
    note: `comments∪reviews 共 ${bodies.length} 条，自带 \`phase: slices\` 声明行且 head sha 相符的 VERDICT: PASS ${matches.length} 条`,
  }
}

function main() {
  const { context: contextPath } = requireArgs('usage: slices-verify.mjs --context <context.json>', '--context')
  const result = slicesVerify(loadPrContext(contextPath))
  console.log('[slices-gate]')
  console.log(`  applicable: ${result.applicable}`)
  console.log(`  found: ${result.found}`)
  console.log(`  note: ${result.note}`)
}

if (isMain(import.meta.url)) {
  main()
}
