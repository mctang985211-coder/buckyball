#!/usr/bin/env node
/**
 * binding-check.mjs — three-source model-binding ground-truth check.
 *
 * Fact sources (all read from the checkout tree of the verified sha):
 *   ① MODEL_LAYOUT keys in bbdev/api/steps/workload/01_build_event.step.py —
 *     the dict the workload build step actually consumes and the gate behind
 *     `workload --build --model` (the gateway is the MODEL_LAYOUT lookup in the
 *     same file; line numbers are intentionally not referenced — the bbdev
 *     submodule pointer moves, and a line claim is only true at the pin it
 *     names). This is NOT a claim that upstream has one single source:
 *     api/steps/regression/scripts/model_layout.py also exists and serves
 *     eval-performance, which is outside this verification surface, so this
 *     script only reads the former,
 *   ② e2e models/archs/buckyball/<chip>/<layout>/ directory,
 *   ③ _MODELS entries in bb-tests/workloads/scripts/build.py.
 *
 * Verdicts injected into the task prompt (the 声明采集面 is manifest.mjs's
 * MODEL_DECL — a `--model <键>` line of its own; listing the command in
 * 预期应跑的测试 is not a declaration, so a bind-round manifest that wants
 * 「覆盖必做」 must carry the declaration line):
 *   - 豁免：无模型写集   — no model write-set in the diff (change-list substrings
 *                          alone are NOT a write-set: 提到≠写了; a MODEL_LAYOUT
 *                          mention only joins with the bbdev gitlink moving);
 *   - 豁免：模型未绑定   — write-set present but every declared model is 0/3; a
 *                          fully-bound path merely MENTIONED in the change list
 *                          without a diff-side e2e/layout write joins this verdict
 *                          as a note（降 note 不判）;
 *   - 覆盖必做          — ≥1 declared model is 3/3 bound (stems listed);
 *   - PRE-FAIL          — a declared model is partially registered (1-2/3);
 *     a declared model on a chip whose layout root is absent from the tree
 *     (上游布局缺失 — the e2e submodule ships only a subset of chips; the
 *     archs/buckyball/CMakeLists.txt FATAL_ERRORs on any other chip, so the
 *     mismatch is attributable, not a mere gap);
 *     or the change list names a bound model the manifest never declared AND the
 *     diff carries the write-set semantics of a binding write (e2e gitlink or a
 *     layout-directory addition/change) — a prose mention without that carrier is
 *     a note, never a PRE-FAIL (提到≠写了).
 *
 * The change list corroborates but never substitutes: a gitlink write-set shows
 * only the submodule pointer in the parent diff, which is why MODEL_LAYOUT needs
 * the bbdev pointer as its carrier — and why the bare substring of a binding
 * path in the change list stopped being sufficient evidence on its own.
 *
 * Usage: node binding-check.mjs --context context.json --repo-root <dir>
 */
import { existsSync } from 'node:fs'
import {
  isMain,
  loadPrContext,
  parseManifest,
  hasModelWriteSet,
  readModelLayoutKeys,
  readBuildPyModels,
  archsLayoutRelPath,
  chipLayoutRootRelPath,
  requireArgs,
  writesBinding,
} from './manifest.mjs'

export function bindingCheck(context, repoRoot) {
  const manifest = parseManifest(context.body)
  const filePaths = (context.files ?? []).map(f => f.path)
  if (!hasModelWriteSet(filePaths, manifest.changeRegion)) {
    return {
      verdict: '豁免：无模型写集',
      detail:
        'diff 未触及 ModelTest/build.py，也无「MODEL_LAYOUT 提及 + bbdev gitlink 移动」的组合写集——清单 change list 的单点子串只是提及（提到≠写了）',
    }
  }

  const layout = readModelLayoutKeys(repoRoot)
  const buildModels = readBuildPyModels(repoRoot)
  const chip = manifest.chip

  /** Per-model source tally against the checkout tree. */
  const sourcesOf = model => {
    const layoutDir = layout[model]
    return {
      modelLayout: layoutDir !== undefined,
      archsLayout:
        layoutDir !== undefined &&
        chip !== undefined &&
        existsSync(`${repoRoot}/${archsLayoutRelPath(chip, layoutDir)}`),
      buildPy: Object.hasOwn(buildModels, model),
    }
  }

  const declared = manifest.models.map(model => ({ model, ...sourcesOf(model) }))

  // (chip,model) layout existence, judged at the CHIP level and ahead of the
  // per-model tallies: upstream's e2e ships one layout root per chip and
  // `archs/buckyball/CMakeLists.txt:13-17` FATAL_ERRORs when the chip directory
  // is absent, so a `--model` declaration on such a chip can never build
  // regardless of how complete the model's own registration is. Naming
  // 上游布局缺失 here keeps the conclusion attributable instead of blaming the
  // change-set with 注册残缺 / falling through to the vague 豁免：模型未绑定.
  if (declared.length > 0 && chip !== undefined && !existsSync(`${repoRoot}/${chipLayoutRootRelPath(chip)}`)) {
    return {
      verdict: 'PRE-FAIL',
      detail:
        `上游布局缺失：检出树无 ${chipLayoutRootRelPath(chip)} 整目录` +
        `（e2e 子模块只有部分 chip；archs/buckyball/CMakeLists.txt 对该情形 FATAL_ERROR——现查：` +
        `ls "$BB/bb-tests/workloads/src/ModelTest/e2e/models/archs/buckyball"）` +
        `——清单声明的模型 ${declared.map(d => d.model).join(',')} 在 chip=${chip} 上物理不可构建，` +
        '不是绑定遗漏，也不是本次变更集的回归',
    }
  }

  const partial = declared.filter(d => {
    const n = [d.modelLayout, d.archsLayout, d.buildPy].filter(Boolean).length
    return n > 0 && n < 3
  })
  if (partial.length > 0) {
    return {
      verdict: 'PRE-FAIL',
      detail: `注册残缺（三者不齐）：${partial
        .map(d => `${d.model}(MODEL_LAYOUT=${yn(d.modelLayout)} archs=${yn(d.archsLayout)} build.py=${yn(d.buildPy)})`)
        .join('；')}`,
    }
  }

  const bound = declared.filter(d => d.modelLayout && d.archsLayout && d.buildPy)
  if (bound.length > 0) {
    return {
      verdict: '覆盖必做',
      detail:
        `已绑定模型：${bound.map(d => `${d.model}→stem ${buildModels[d.model]}`).join('；')}` +
        '——build/probe 不过即 FAIL，零执行覆盖不得 PASS',
    }
  }

  // No declared model is bound. 提到≠写了: the undeclared-binding PRE-FAIL needs
  // WRITE-SET SEMANTICS — the diff must actually carry the e2e gitlink or a
  // layout-directory addition/change (writesBinding in manifest.mjs). A change-list
  // bullet naming `archs/buckyball/<c>/<X>` — even the fully-bound kind, and even a
  // NEGATIVE one (「不动 archs/buckyball/…」) — without that carrier is a mention,
  // not this change-set's binding write: it becomes a note on the 豁免, never a PRE-FAIL.
  if (declared.length === 0) {
    let mentioned = null
    for (const match of manifest.changeRegion.matchAll(/archs\/buckyball\/([\w-]+)\/([\w-]+)/g)) {
      const [, c, dir] = match
      const key = Object.keys(layout).find(k => layout[k] === dir)
      if (
        key !== undefined &&
        Object.hasOwn(buildModels, key) &&
        existsSync(`${repoRoot}/${archsLayoutRelPath(c, dir)}`)
      ) {
        if (writesBinding(filePaths)) {
          return {
            verdict: 'PRE-FAIL',
            detail: `模型 ${key}（archs/buckyball/${c}/${dir}）三源齐备但清单未声明 --model（证据清单与实物不符）`,
          }
        }
        mentioned = `模型 ${key}（archs/buckyball/${c}/${dir}）三源齐备，但 diff 无 e2e gitlink/layout 目录写入`
      }
    }
    if (mentioned !== null) {
      return {
        verdict: '豁免：模型未绑定',
        detail: `有模型写集但清单未声明 --model；note：${mentioned}——提到≠写了，不判未声明绑定，只记备查`,
      }
    }
  }

  return {
    verdict: '豁免：模型未绑定',
    detail:
      declared.length === 0
        ? '有模型写集但清单未声明 --model，且检出树无三源齐备的未声明绑定'
        : `清单声明模型 ${declared.map(d => d.model).join(',')} 在 chip=${chip ?? '?'} 三源俱无（绑定尚未交付）`,
  }
}

const yn = b => (b ? 'Y' : 'N')

function main() {
  const { context: contextPath, repoRoot } = requireArgs(
    'usage: binding-check.mjs --context <context.json> --repo-root <dir>',
    '--context',
    '--repo-root',
  )
  const { verdict, detail } = bindingCheck(loadPrContext(contextPath), repoRoot)
  console.log('[binding]')
  console.log(verdict === 'PRE-FAIL' ? `  PRE-FAIL: ${detail}` : `  ${verdict} — ${detail}`)
}

if (isMain(import.meta.url)) {
  main()
}
