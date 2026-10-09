#!/usr/bin/env node
/**
 * infer-stage.mjs — deterministic diff-path → stage judgment for bb-verify.
 *
 * Reads the ref-mode context.json (synthesized by ref-context.mjs: commit
 * subject/body, `git diff --name-only` file list, head sha) and prints the
 * stage block injected into task-prompt.md. Ball write-set
 * carve-outs (a ball change MUST touch them for registration, so they are not
 * chip evidence — the s3-cbemu misjudgment):
 *   - examples/chips/<c>/regression/**            (regression TOML wiring)
 *   - examples/cores/<c>/configs/balldomains/**   (balldomain TOML wiring)
 *   - examples/cores/<c>/compiler/**              (ball compiler wiring: the core's
 *     dialect aggregate, its Transforms source list, the legalize dispatch, and the
 *     per-ball Conversion patterns — upstream's own ball commits are exactly this
 *     shape)
 * A new-chip change still lands on chip because it necessarily touches
 * examples/chips/<c>/ definition paths, which keep their chip vote.
 * Chip stage holds only for those definition-level paths
 * (examples/chips/<c>/{arch,configs,kernel,workloads,...}, other
 * examples/cores/<c>/ paths). bb-tests/workloads/ → workload. Everything
 * else (bbdev/, arch/, bebop/, docs, gitlink-only bumps) carries no vote.
 *
 * The result also carries `compilerTouched` (write set touches a ball's or a
 * core's `compiler/**`), which the verifier feeds to `buckyball_bbdev_plan` so
 * a `ball/c-bemu` round builds the compiler inside the gated session instead of
 * leaving that verdict to the out-of-session Provision step.
 *
 * Declared vs inferred mismatch is never silently resolved: the effective
 * stage is the widest of the two (chip > ball > workload) and the conflict
 * is printed for the prompt to restate.
 *
 * Usage: node infer-stage.mjs --context context.json
 */
import { isMain, loadPrContext, parseManifest, requireArgs, widestStage } from './manifest.mjs'

/** One path → one vote; `null` when the path carries no stage evidence. */
export function voteOfPath(path) {
  let m
  if (path.startsWith('examples/balls/')) return { stage: 'ball', why: 'ball 目录' }
  if ((m = path.match(/^examples\/chips\/([^/]+)\/regression\//))) {
    return { stage: 'ball', chip: m[1], why: 'chip regression TOML 属 ball 接线' }
  }
  if ((m = path.match(/^examples\/cores\/([^/]+)\/configs\/balldomains\//))) {
    return { stage: 'ball', chip: m[1], why: 'balldomains TOML 属 ball 接线' }
  }
  if ((m = path.match(/^examples\/cores\/([^/]+)\/compiler\//))) {
    return { stage: 'ball', chip: m[1], why: 'core compiler 接线属 ball 写集' }
  }
  if ((m = path.match(/^examples\/chips\/([^/]+)\//))) return { stage: 'chip', chip: m[1], why: 'chip 定义级路径' }
  if ((m = path.match(/^examples\/cores\/([^/]+)\//))) return { stage: 'chip', chip: m[1], why: 'core 定义级路径' }
  if (path.startsWith('bb-tests/workloads/')) return { stage: 'workload', why: 'workloads（含 ModelTest）' }
  return null
}

/**
 * Ball/core compiler write-set touch: the plan's conditional prerequisite for
 * `ball/c-bemu` (config install + compiler build join the gated round only when
 * the change-set actually touches a compiler package — `examples/balls/<b>/compiler/**`
 * or `examples/cores/<c>/compiler/**`). This is the judgment; the verifier
 * passes the injected value straight to `buckyball_bbdev_plan` as
 * `compilerTouched` and never re-decides it here.
 */
export function touchesCompilerWriteSet(filePaths) {
  return filePaths.some(
    path => /^examples\/balls\/[^/]+\/compiler\//.test(path) || /^examples\/cores\/[^/]+\/compiler\//.test(path),
  )
}

export function inferStage(files, declared) {
  const votes = []
  const chips = new Set()
  for (const file of files) {
    const vote = voteOfPath(file.path)
    if (vote === null) continue
    votes.push({ path: file.path, ...vote })
    if (vote.chip !== undefined) chips.add(vote.chip)
  }
  const stages = [...new Set(votes.map(v => v.stage))]
  const inferred = widestStage(stages)
  const conflicts = []
  let effective
  if (declared !== undefined && inferred !== undefined && declared !== inferred) {
    effective = widestStage([declared, inferred])
    conflicts.push(`清单声明=${declared} 与 diff 推断=${inferred} 不一致，按最宽一级 ${effective} 执行`)
  } else {
    effective = declared ?? inferred
  }
  const compilerTouched = touchesCompilerWriteSet(files.map(f => f.path))
  return { declared, inferred, effective, conflicts, chips: [...chips], votes, compilerTouched }
}

function main() {
  const { context: contextPath } = requireArgs('usage: infer-stage.mjs --context <context.json>', '--context')
  const context = loadPrContext(contextPath)
  const declared = parseManifest(context.body).stage
  const result = inferStage(context.files ?? [], declared)
  console.log('[stage]')
  console.log(`  declared: ${result.declared ?? '（无）'}`)
  console.log(`  inferred: ${result.inferred ?? '（diff 无判别性路径）'}`)
  console.log(`  effective: ${result.effective ?? '（无法判定）'}`)
  console.log(`  conflict: ${result.conflicts.length === 0 ? '无' : result.conflicts.join('；')}`)
  console.log(`  chips_in_diff: ${result.chips.length === 0 ? '（无）' : result.chips.join(', ')}`)
  // The scope of the judgment is stated on the injected line itself: this is a
  // change-set-cumulative write-set verdict, not a per-round one, and a round
  // that touches nothing this time still inherits it.
  console.log(
    `  compilerTouched: ${result.compilerTouched}` +
      `（变更集级判定：本次 verify 分支的累计写集是否触及 ball/core 的 compiler/**，非本轮级——` +
      `plan 对本轮会消费编译器产物的相位据此前置 config install → compiler build）`,
  )
}

if (isMain(import.meta.url)) {
  main()
}
