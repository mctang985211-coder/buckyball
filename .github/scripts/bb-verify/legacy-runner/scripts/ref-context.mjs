#!/usr/bin/env node
/**
 * ref-context.mjs — synthesize the context.json of bb-verify's ref mode (temp
 * branch verification, no PR involved). The workflow runs this AFTER the
 * persistent repo is prepared (the git objects must already be fetched),
 * writing the JSON the downstream deterministic scripts consume via
 * `--context`:
 *
 *   {
 *     title:      commit subject of the sha,
 *     body:       content of bb-verify-task.md at the sha's repo root when
 *                 present, else the full commit message,
 *     files:      [{path}, …] from `git diff --name-only <base>...<sha>`
 *                 (empty list with a stderr warning when the merge-base is
 *                 missing — a diff-less context must not kill the run),
 *     headRefOid: resolved sha,
 *     comments:   [],   // ref mode has no PR: both history faces are always
 *     reviews:    [],   // empty arrays (see slices-verify / probe-loop-check)
 *   }
 *
 * Usage: node ref-context.mjs --repo <path> --ref <branch> --out <context.json> [--base <ref>] [--sha <sha>]
 *
 * --base defaults to origin/main. --sha overrides the ref resolution (the
 * workflow passes the checked-out HEAD sha, since the temp branch exists only
 * as FETCH_HEAD in the persistent repo). Pure node, zero dependencies — same
 * discipline as the other scripts/ verdict scripts.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { isMain } from './manifest.mjs'

const USAGE =
  'usage: ref-context.mjs --repo <path> --ref <branch> --out <context.json> [--base <ref>] [--sha <sha>]'

/** `--flag value` pairs only; required: repo/ref/out; optional: base/sha. */
export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (value === undefined) throw new Error(USAGE)
    if (!flag.startsWith('--') || value.startsWith('--')) throw new Error(USAGE)
    const key = flag.slice(2)
    if (!['repo', 'ref', 'out', 'base', 'sha'].includes(key)) throw new Error(USAGE)
    out[key] = value
  }
  if (out.repo === undefined || out.ref === undefined || out.out === undefined) throw new Error(USAGE)
  return out
}

/** Build the context object from the git facts of `<sha>` in `<repo>`. */
export function refContext({ repo, ref, sha, base = 'origin/main' }) {
  const git = (args, allowFail = false) => {
    try {
      return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      if (allowFail) return null
      const detail = String(error.stderr ?? error.message).trim()
      throw new Error(`ref-context: git ${args.join(' ')} failed in ${repo}: ${detail}`)
    }
  }
  const headSha = sha ?? git(['rev-parse', ref]).trim()
  // 对象必须真实存在且是 commit——sha 笔误/rev-parse 半成功都在这里挡下。
  git(['cat-file', '-e', `${headSha}^{commit}`])
  const title = git(['log', '-1', '--format=%s', headSha]).trim()
  const taskFile = git(['show', `${headSha}:bb-verify-task.md`], true)
  const body = taskFile ?? git(['log', '-1', '--format=%B', headSha])
  const diffOut = git(['diff', '--name-only', `${base}...${headSha}`], true)
  let files = []
  if (diffOut === null) {
    process.stderr.write(
      `ref-context: warning: git diff --name-only ${base}...${headSha} failed (no merge-base?) -- files=[]\n`,
    )
  } else {
    files = diffOut
      .split('\n')
      .filter(line => line !== '')
      .map(path => ({ path }))
  }
  return { title, body, files, headRefOid: headSha, comments: [], reviews: [] }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const context = refContext(args)
  writeFileSync(args.out, `${JSON.stringify(context, null, 2)}\n`)
  console.log(
    `ref-context: ${args.ref} -> ${context.headRefOid.slice(0, 8)} ` +
      `(${context.files.length} files vs ${args.base ?? 'origin/main'}) -> ${args.out}`,
  )
}

if (isMain(import.meta.url)) {
  main()
}
