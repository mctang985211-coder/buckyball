#!/usr/bin/env node
/**
 * ci-dispatch.mjs — dispatch the bb-verify workflow against a temp branch,
 * without a PR.
 *
 * Client half of the temp-branch verification channel; the server half is
 * `bb-verify.yml` on the fork's default branch:
 *
 *   task file ── git plumbing ──> temp branch verify/<stamp>-<sha7> on the fork
 *        └─ POST /actions/workflows/<workflow>/dispatches
 *             ref=main  inputs={ ref: <branch>, sha: <temp commit>, layer }
 *        └─ the fork's self-hosted runner verifies <sha> and writes back a
 *           commit status (context `bb-verify`: pending → success|failure|error)
 *           plus the `bb-verify-verdict` artifact: verdict.txt always, plus
 *           report.md when the session wrote one (an INFRA run may ship
 *           verdict.txt alone — never assume report.md is present).
 *           success = VERDICT PASS, failure = FAIL, error = INFRA.
 *
 * The caller's checkout is never checked out, indexed or read: the temp commit
 * is assembled with hash-object / ls-tree / mktree / commit-tree / update-ref,
 * so a dirty worktree is fine and stays dirty. The only local writes are the
 * object database entry and `refs/heads/<branch>`.
 *
 * The token never reaches argv or the log: the push URL is built in memory and
 * every stderr line surfaced from it is scrubbed of the token first.
 *
 * Usage: node scripts/ci-dispatch.mjs --task-file <path> [--repo <dir>]
 *        [--base <commit-ish>] [--layer merge|complete] [--branch <name>]
 *        [--wait] [--timeout-min <n>] [--poll-sec <n>] [--keep-branch]
 *        [--dry-run] [--help]
 *        node scripts/ci-dispatch.mjs --fetch --sha <40-hex> --branch <verify/...>
 *        [--repo <dir>] [--keep-branch] [--help]
 *
 * The no-wait dispatch and `--fetch` split the wait into short, survivable
 * calls: `--wait` may block for up to 200 minutes, which does not fit inside a
 * single capped shell call, so a session dispatches without it and then runs
 * one `--fetch` status check per poll until the state is terminal.
 *
 * Exit codes: 0 = VERDICT PASS, 1 = VERDICT FAIL, 2 = INFRA / timeout / error,
 *             3 = still running (--fetch only).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from './manifest.mjs'

const DEFAULT_FORK = 'mctang985211-coder/buckyball'
const DEFAULT_WORKFLOW = 'bb-verify.yml'
/** Branch of the fork that hosts the workflow file (fixed by the contract). */
const WORKFLOW_REF = process.env.BB_VERIFY_WORKFLOW_REF || 'main'
if (WORKFLOW_REF !== 'main' && (!/^exp\/legacy-single-prompt-clamp-v1-[A-Za-z0-9._-]+$/.test(WORKFLOW_REF) || (process.env.BB_VERIFY_REPO || 'mctang985211-coder/buckyball') !== 'mctang985211-coder/buckyball')) throw new Error('experiment workflow ref override is restricted to the authorized personal fork and experiment branch')
/** Task file name at the temp branch root; the workflow reads it as the task. */
const TASK_FILE_NAME = 'bb-verify-task.md'
const STATUS_CONTEXT = 'bb-verify'
const ARTIFACT_NAME = 'bb-verify-verdict'
const BRANCH_RE = /^verify\/[A-Za-z0-9._-]+$/
const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const WORKFLOW_NAME_RE = /^[A-Za-z0-9._-]+$/
const BOT_NAME = 'bb-verify[bot]'
const BOT_EMAIL = 'bb-verify[bot]@users.noreply.github.com'
const MAX_BUFFER = 64 * 1024 * 1024
/** How many report.md lines the terminal path prints (the whole file when shorter). */
const REPORT_HEAD_LINES = 40
const EXIT_FAIL = 1
const EXIT_INFRA = 2
/** `--fetch` one-shot: the run has not reached a terminal state yet. */
const EXIT_PENDING = 3
const TERMINAL_STATES = new Set(['success', 'failure', 'error'])
const SHA_RE = /^[0-9a-f]{40}$/i
const STATE_VERDICT = { success: 'PASS', failure: 'FAIL', error: 'INFRA' }
const VERDICT_EXIT = { PASS: 0, FAIL: EXIT_FAIL, INFRA: EXIT_INFRA }
/** Absolute path of this script, for printing ready-to-copy follow-up commands. */
const SELF_PATH = fileURLToPath(import.meta.url)

const USAGE = `usage: node scripts/ci-dispatch.mjs --task-file <path> [options]
       node scripts/ci-dispatch.mjs --fetch --sha <40-hex> --branch <verify/...> [options]

Dispatch the bb-verify workflow on a temp branch of the fork, without a PR;
--fetch checks the status of a dispatch made earlier, once.

dispatch options:
  --repo <path>            local buckyball checkout (default: cwd)
  --base <commit-ish>      commit to verify (default: HEAD)
  --task-file <path>       markdown task/evidence manifest (REQUIRED); committed as
                           ${TASK_FILE_NAME} at the root of the temp branch
  --layer merge|complete   verification layer (default: merge)
  --branch <name>          temp branch override (default verify/<yyyyMMdd-HHmmss>-<sha7>;
                           must match ^verify/[A-Za-z0-9._-]+$)
  --wait                   poll the commit status until terminal (default: dispatch and exit)
  --timeout-min <n>        with --wait, minutes before giving up (default: 200)
  --poll-sec <n>           with --wait, seconds between status polls (default: 60)
  --dry-run                print the planned git/gh operations and exit

fetch options (one status check for a dispatch made earlier):
  --fetch                  query the bb-verify status once and exit; a not-yet-
                           terminal run exits 3, a terminal one downloads the
                           artifact and exits 0 / 1 / 2
  --sha <40-hex>           the temp commit the dispatch printed (REQUIRED with --fetch)
  --branch <name>          the temp branch the dispatch printed (REQUIRED with --fetch)

common:
  --keep-branch            keep the temp branch after a terminal verdict (--wait / --fetch)
  -h, --help               show this help

environment:
  BB_VERIFY_REPO           fork hosting the workflow (default: ${DEFAULT_FORK})
  BB_VERIFY_WORKFLOW       workflow file name (default: ${DEFAULT_WORKFLOW})

exit codes: 0 = VERDICT PASS, 1 = VERDICT FAIL, 2 = INFRA / timeout / error,
            3 = still running (--fetch only: queued or pending)`

/** Expected-failure carrier: printed without a stack, exits 2. */
class CliError extends Error {}

const info = message => process.stdout.write(`ci-dispatch: ${message}\n`)
const warn = message => process.stderr.write(`ci-dispatch: warning: ${message}\n`)

function write(text, stream = process.stdout) {
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

/** Run a command, never throwing: expected failures come back as data. */
function tryRun(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    })
    return { ok: true, stdout, stderr: '', status: 0 }
  } catch (error) {
    const missing = error.code === 'ENOENT'
    return {
      ok: false,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: missing
        ? `${command}: command not found (is it on PATH?)`
        : typeof error.stderr === 'string'
          ? error.stderr
          : '',
      status: typeof error.status === 'number' ? error.status : null,
    }
  }
}

const firstLine = text =>
  String(text)
    .split('\n')
    .map(s => s.trim())
    .find(s => s !== '') ?? 'no output'
const firstLines = (text, count) =>
  String(text)
    .split('\n')
    .map(s => s.trimEnd())
    .filter(s => s.trim() !== '')
    .slice(0, count)
    .join('\n  ')

function errorText(result) {
  return firstLine(result.stderr || result.stdout)
}

function mustRun(command, args, options = {}, what = `${command} ${args.join(' ')}`) {
  const result = tryRun(command, args, options)
  if (!result.ok) throw new CliError(`${what} failed: ${errorText(result)}`)
  return result.stdout
}

const git = (repo, args, options = {}, what) => mustRun('git', ['-C', repo, ...args], options, what)

/** Scrub credentials out of anything git may have echoed back to us. */
function sanitize(text, secrets = []) {
  let out = String(text)
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***')
  }
  return out.replace(/x-access-token:[^@\s]*@/g, 'x-access-token:***@')
}

const sleepMs = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const shortSha = sha => sha.slice(0, 7)

// ── CLI ──────────────────────────────────────────────────────────────────────

const FLAG_KIND = {
  '--repo': 'value',
  '--base': 'value',
  '--task-file': 'value',
  '--layer': 'value',
  '--branch': 'value',
  '--sha': 'value',
  '--timeout-min': 'value',
  '--poll-sec': 'value',
  '--wait': 'bool',
  '--fetch': 'bool',
  '--keep-branch': 'bool',
  '--dry-run': 'bool',
  '--help': 'bool',
  '-h': 'bool',
}

/** Flags a `--fetch` (poll-only) invocation cannot use: they are dispatch-time. */
const DISPATCH_ONLY_FLAGS = ['--wait', '--task-file', '--layer', '--base', '--dry-run']

function parseArgs(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const kind = FLAG_KIND[flag]
    if (kind === undefined) throw new CliError(`unknown argument: ${flag}\n\n${USAGE}`)
    if (kind === 'bool') {
      flags[flag] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new CliError(`missing value for ${flag}\n\n${USAGE}`)
    flags[flag] = value
    index += 1
  }
  return flags
}

function numberOption(flags, flag, fallback) {
  const raw = flags[flag]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new CliError(`${flag} must be a positive number (got ${raw})`)
  return value
}

function readOptions(argv) {
  const flags = parseArgs(argv)
  if (flags['--help'] === true || flags['-h'] === true) return { help: true }
  const fork = (process.env.BB_VERIFY_REPO ?? '').trim() || DEFAULT_FORK
  if (!REPO_SLUG_RE.test(fork)) throw new CliError(`BB_VERIFY_REPO must look like owner/repo (got ${fork})`)
  const workflow = (process.env.BB_VERIFY_WORKFLOW ?? '').trim() || DEFAULT_WORKFLOW
  if (!WORKFLOW_NAME_RE.test(workflow))
    throw new CliError(`BB_VERIFY_WORKFLOW must be a workflow file name (got ${workflow})`)
  if (flags['--fetch'] === true) return readFetchOptions(flags, fork, workflow)
  const taskFileArg = flags['--task-file']
  if (taskFileArg === undefined) throw new CliError(`--task-file is required\n\n${USAGE}`)
  const layer = flags['--layer'] ?? 'merge'
  if (layer !== 'merge' && layer !== 'complete') throw new CliError(`--layer must be merge or complete (got ${layer})`)
  const branch = flags['--branch']
  if (branch !== undefined && !BRANCH_RE.test(branch)) {
    throw new CliError(
      `--branch must match ^verify/[A-Za-z0-9._-]+$ — only verify/* temp branches are dispatchable (got ${branch})`,
    )
  }
  return {
    help: false,
    fetch: false,
    repo: flags['--repo'] ?? process.cwd(),
    base: flags['--base'] ?? 'HEAD',
    taskFile: resolve(taskFileArg),
    layer,
    branch,
    wait: flags['--wait'] === true,
    timeoutMin: numberOption(flags, '--timeout-min', 200),
    pollSec: numberOption(flags, '--poll-sec', 60),
    keepBranch: flags['--keep-branch'] === true,
    dryRun: flags['--dry-run'] === true,
    fork,
    workflow,
  }
}

/**
 * `--fetch` options: no dispatch-time flag may appear (the temp branch and task
 * file were fixed by the dispatch this call only polls), `--sha` and `--branch`
 * are mandatory and the sha must be the printed 40-hex temp commit.
 */
function readFetchOptions(flags, fork, workflow) {
  const conflicts = DISPATCH_ONLY_FLAGS.filter(flag => flags[flag] !== undefined)
  if (conflicts.length > 0) {
    throw new CliError(
      `--fetch cannot be combined with ${conflicts.join(', ')} — those flags belong to a dispatch, not to a status check`,
    )
  }
  const sha = flags['--sha']
  if (sha === undefined) throw new CliError(`--fetch requires --sha (the temp commit the dispatch printed)\n\n${USAGE}`)
  if (!SHA_RE.test(sha)) throw new CliError(`--sha must be the 40-hex temp commit (got ${sha})`)
  const branch = flags['--branch']
  if (branch === undefined)
    throw new CliError(`--fetch requires --branch (the temp branch the dispatch printed)\n\n${USAGE}`)
  if (!BRANCH_RE.test(branch)) {
    throw new CliError(
      `--branch must match ^verify/[A-Za-z0-9._-]+$ — only verify/* temp branches are dispatchable (got ${branch})`,
    )
  }
  return {
    help: false,
    fetch: true,
    repo: flags['--repo'] ?? process.cwd(),
    sha: sha.toLowerCase(),
    branch,
    keepBranch: flags['--keep-branch'] === true,
    fork,
    workflow,
  }
}

function defaultBranchName(baseSha) {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `verify/${stamp}-${shortSha(baseSha)}`
}

// ── preflight ────────────────────────────────────────────────────────────────

/** `https://github.com/o/r.git` / `git@github.com:o/r.git` → `o/r` (lowercase). */
function normalizeRepoSlug(url) {
  const trimmed = String(url).trim().replace(/\/+$/, '')
  const match =
    trimmed.match(/^[a-z+]+:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i) ??
    trimmed.match(/^(?:[^@/\s]+@)?github\.com:([^/]+)\/(.+?)(?:\.git)?$/i)
  return match === null ? null : `${match[1]}/${match[2]}`.toLowerCase()
}

/**
 * Informational only (never fatal): the base must exist on the fork for the
 * workflow to check it out, and a commit that no pushed branch reachable from
 * the local remote-tracking refs contains is usually a sign of an unpushed base.
 * The temp branch push itself carries the base's objects while the branch lives.
 */
function warnIfBaseUnpushed(repo, fork, baseSha) {
  const remoteNames = tryRun('git', ['-C', repo, 'remote'])
  if (!remoteNames.ok) return
  const want = fork.toLowerCase()
  const matching = remoteNames.stdout
    .split('\n')
    .map(name => name.trim())
    .filter(name => name !== '')
    .filter(name => {
      const urls = tryRun('git', ['-C', repo, 'remote', 'get-url', name])
      if (!urls.ok) return false
      return urls.stdout.split('\n').some(url => normalizeRepoSlug(url) === want)
    })
  if (matching.length === 0) {
    warn(`no git remote of ${repo} points at ${fork} — cannot check that ${shortSha(baseSha)} is pushed`)
    return
  }
  const refs = matching.flatMap(remote => {
    const listed = tryRun('git', ['-C', repo, 'for-each-ref', '--format=%(refname)', `refs/remotes/${remote}`])
    if (!listed.ok) return []
    return listed.stdout
      .split('\n')
      .map(ref => ref.trim())
      .filter(ref => ref !== '')
  })
  if (refs.length === 0) {
    warn(
      `no remote-tracking refs for ${matching.join(', ')} — fetch first for a meaningful "is ${shortSha(baseSha)} pushed?" check`,
    )
    return
  }
  const reachable = refs.find(ref => tryRun('git', ['-C', repo, 'merge-base', '--is-ancestor', baseSha, ref]).ok)
  if (reachable === undefined) {
    warn(
      `${shortSha(baseSha)} is not an ancestor of any remote-tracking branch of ${fork} — ` +
        `the temp branch push carries it while the branch lives, but push it to a branch first if other tooling resolves it by sha (informational only)`,
    )
  }
}

function preflight(options) {
  const probe = tryRun('git', ['-C', options.repo, 'rev-parse', '--is-inside-work-tree'])
  if (!probe.ok || probe.stdout.trim() !== 'true') {
    throw new CliError(`--repo ${options.repo} is not a git work tree${probe.ok ? '' : ` (${errorText(probe)})`}`)
  }
  const repo = git(options.repo, ['rev-parse', '--show-toplevel'], {}, 'git rev-parse --show-toplevel').trim()
  if (resolve(options.repo) !== repo) info(`repo: using work tree root ${repo}`)

  const baseProbe = tryRun('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${options.base}^{commit}`])
  const baseSha = baseProbe.ok ? baseProbe.stdout.trim() : ''
  if (baseSha === '') throw new CliError(`--base ${options.base} does not resolve to a commit in ${repo}`)

  if (!existsSync(options.taskFile)) throw new CliError(`--task-file ${options.taskFile} not found`)
  if (!statSync(options.taskFile).isFile()) throw new CliError(`--task-file ${options.taskFile} is not a regular file`)

  const auth = tryRun('gh', ['auth', 'status'])
  if (!auth.ok) {
    throw new CliError(
      `gh auth status failed — ${errorText(auth)}\n` +
        `  hint: run \`gh auth login\`; that login needs write access to ${options.fork} ` +
        `(token scopes \`repo\` + \`workflow\`) to push the temp branch and dispatch the workflow.`,
    )
  }

  warnIfBaseUnpushed(repo, options.fork, baseSha)
  return { repo, baseSha }
}

/**
 * Fetch-mode preflight: no base or task file to resolve (the dispatch fixed
 * those) — the repo only has to be a work tree (artifact dir + local ref) and
 * gh must be usable for the status query and cleanup.
 */
function preflightFetch(options) {
  const probe = tryRun('git', ['-C', options.repo, 'rev-parse', '--is-inside-work-tree'])
  if (!probe.ok || probe.stdout.trim() !== 'true') {
    throw new CliError(`--repo ${options.repo} is not a git work tree${probe.ok ? '' : ` (${errorText(probe)})`}`)
  }
  const repo = git(options.repo, ['rev-parse', '--show-toplevel'], {}, 'git rev-parse --show-toplevel').trim()
  if (resolve(options.repo) !== repo) info(`repo: using work tree root ${repo}`)

  const auth = tryRun('gh', ['auth', 'status'])
  if (!auth.ok) {
    throw new CliError(
      `gh auth status failed — ${errorText(auth)}\n` +
        `  hint: run \`gh auth login\`; that login needs read access to ${options.fork} ` +
        `(token scope \`repo\`) to query the status and download the artifact.`,
    )
  }
  return { repo }
}

// ── temp branch (plumbing only: no checkout, no index writes) ────────────────

/**
 * Build the temp commit as `<base>^{tree}` + one root entry, `bb-verify-task.md`,
 * then point `refs/heads/<branch>` at it. The worktree and index are untouched.
 * Exported for the scratch-repo plumbing test.
 */
export function createTempBranch(repo, baseSha, branch, taskFile) {
  const existing = tryRun('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  if (existing.ok) {
    throw new CliError(
      `local branch ${branch} already exists in ${repo} — pick another --branch name, or remove it first: git -C ${repo} branch -D ${branch}`,
    )
  }
  const blob = git(repo, ['hash-object', '-w', '--', taskFile], {}, 'git hash-object -w').trim()
  const baseTree = git(repo, ['rev-parse', `${baseSha}^{tree}`], {}, 'git rev-parse <base>^{tree}').trim()
  const entries = git(repo, ['ls-tree', '-z', baseTree], {}, 'git ls-tree <base>^{tree}')
    .split('\0')
    .filter(entry => entry !== '')
    .filter(entry => entry.slice(entry.indexOf('\t') + 1) !== TASK_FILE_NAME)
  entries.push(`100644 blob ${blob}\t${TASK_FILE_NAME}`)
  const tree = git(repo, ['mktree', '-z'], { input: `${entries.join('\0')}\0` }, 'git mktree').trim()
  const botEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: BOT_NAME,
    GIT_AUTHOR_EMAIL: BOT_EMAIL,
    GIT_COMMITTER_NAME: BOT_NAME,
    GIT_COMMITTER_EMAIL: BOT_EMAIL,
  }
  const commit = git(
    repo,
    ['commit-tree', tree, '-p', baseSha, '-m', `bb-verify: ${branch}`],
    { env: botEnv },
    'git commit-tree',
  ).trim()
  git(repo, ['update-ref', `refs/heads/${branch}`, commit], {}, 'git update-ref')
  return { blob, tree, commit }
}

// ── push / dispatch ──────────────────────────────────────────────────────────

function ghAuthToken(options) {
  const token = tryRun('gh', ['auth', 'token'])
  if (!token.ok || token.stdout.trim() === '') {
    const detail = token.ok ? 'empty token' : errorText(token)
    throw new CliError(
      `gh auth token failed — ${detail}\n` +
        `  hint: run \`gh auth login\` with an account that can write to ${options.fork}.`,
    )
  }
  return token.stdout.trim()
}

function pushTempBranch(repo, fork, branch, token) {
  // The token lives in the in-memory URL only; git may echo the URL back on
  // failure, so anything we print is scrubbed first.
  const url = `https://x-access-token:${token}@github.com/${fork}.git`
  const result = tryRun('git', ['-C', repo, 'push', url, `refs/heads/${branch}:refs/heads/${branch}`], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (!result.ok) {
    const detail = firstLines(sanitize(result.stderr || result.stdout, [token]), 3) || 'no output'
    throw new CliError(
      `git push to ${fork} failed:\n  ${detail}\n` +
        `  hint: the gh login needs write access to ${fork} (check \`gh auth status\`; the token needs the \`repo\` scope).`,
    )
  }
}

function dispatchWorkflow(options, branch, commit) {
  const result = tryRun('gh', [
    'api',
    '--method',
    'POST',
    `repos/${options.fork}/actions/workflows/${options.workflow}/dispatches`,
    '-f',
    `ref=${WORKFLOW_REF}`,
    '-f',
    `inputs[ref]=${branch}`,
    '-f',
    `inputs[sha]=${commit}`,
    '-f',
    `inputs[layer]=${options.layer}`,
  ])
  if (!result.ok) {
    const detail = firstLines(result.stderr || result.stdout, 3) || 'no output'
    throw new CliError(
      `workflow dispatch failed:\n  ${detail}\n` +
        `  hint: the token needs the \`workflow\` scope and write access to ${options.fork}.`,
    )
  }
}

/** Read a remote ref: `{ known: false }` means the probe itself failed. */
function readRemoteRef(fork, branch) {
  const result = tryRun('gh', ['api', `repos/${fork}/git/ref/heads/${branch}`])
  if (result.ok) {
    try {
      return { known: true, sha: JSON.parse(result.stdout).object?.sha ?? null }
    } catch {
      return { known: false, sha: null }
    }
  }
  if (/\b404\b|Not Found/i.test(result.stderr)) return { known: true, sha: null }
  return { known: false, sha: null }
}

// ── verdict ──────────────────────────────────────────────────────────────────

function runIdFromUrl(url) {
  const match = typeof url === 'string' ? url.match(/\/actions\/runs\/(\d+)/) : null
  return match?.[1] ?? null
}

function pickVerifyStatus(payload) {
  const statuses = Array.isArray(payload?.statuses) ? payload.statuses : []
  // The commit-status API lists newest first; a re-dispatch would add more.
  return statuses.find(entry => entry.context === STATUS_CONTEXT) ?? null
}

function readVerifyStatus(fork, commit) {
  const result = tryRun('gh', ['api', `repos/${fork}/commits/${commit}/status`])
  if (!result.ok) return { ok: false, error: errorText(result) }
  try {
    return { ok: true, snapshot: pickVerifyStatus(JSON.parse(result.stdout)) }
  } catch {
    return { ok: false, error: 'the status response was not JSON' }
  }
}

/** Poll until a terminal status or the deadline; `null` = timed out. */
function waitForVerdict(options, commit) {
  const startedAt = Date.now()
  const deadline = startedAt + options.timeoutMin * 60_000
  const pollMs = Math.max(options.pollSec * 1000, 1000)
  let failures = 0
  for (;;) {
    if (deadline - Date.now() <= 0) return null
    const probe = readVerifyStatus(options.fork, commit)
    if (!probe.ok) {
      failures += 1
      warn(`status probe failed (${failures}/3): ${probe.error}`)
      if (failures >= 3) {
        throw new CliError(
          `status probe failed 3 times in a row — giving up on the wait; ` +
            `check manually: gh api repos/${options.fork}/commits/${commit}/status`,
        )
      }
    } else {
      failures = 0
      const { snapshot } = probe
      if (snapshot !== null && TERMINAL_STATES.has(snapshot.state)) return snapshot
      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      const runId = runIdFromUrl(snapshot?.target_url)
      info(
        `${snapshot === null ? 'no bb-verify status yet (queued?)' : `state=${snapshot.state}`}` +
          `${runId === null ? '' : ` run=${runId}`} — elapsed ${elapsed}s, next poll in ${Math.round(pollMs / 1000)}s`,
      )
    }
    const pause = Math.min(pollMs, Math.max(deadline - Date.now(), 0))
    if (pause > 0) sleepMs(pause)
  }
}

function findRunId(options, commit) {
  const result = tryRun('gh', [
    'run',
    'list',
    '-R',
    options.fork,
    '-w',
    options.workflow,
    '--commit',
    commit,
    '--limit',
    '1',
    '--json',
    'databaseId',
  ])
  if (!result.ok) return null
  try {
    const runs = JSON.parse(result.stdout)
    return Array.isArray(runs) && runs.length > 0 ? String(runs[0].databaseId) : null
  } catch {
    return null
  }
}

function findFile(root, name) {
  if (!existsSync(root)) return null
  const direct = join(root, name)
  if (existsSync(direct)) return direct
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const found = findFile(join(root, entry.name), name)
    if (found !== null) return found
  }
  return null
}

function downloadArtifact(options, runId, dir, attempts = 3) {
  mkdirSync(dir, { recursive: true })
  let last = 'no output'
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = tryRun('gh', ['run', 'download', String(runId), '-R', options.fork, '-n', ARTIFACT_NAME, '-D', dir])
    if (result.ok) return true
    last = errorText(result)
    if (attempt < attempts) {
      warn(`artifact download attempt ${attempt}/${attempts} failed (${last}) — retrying in 10s`)
      sleepMs(10_000)
    }
  }
  warn(
    `could not download the ${ARTIFACT_NAME} artifact of run ${runId}: ${last} — ` +
      `see https://github.com/${options.fork}/actions/runs/${runId}`,
  )
  return false
}

function verdictFromFile(path) {
  try {
    return readFileSync(path, 'utf8').match(/VERDICT:\s*(PASS|FAIL|INFRA)/)?.[1] ?? null
  } catch {
    return null
  }
}

function reportTerminal({ options, repo, branch, commit, snapshot }) {
  const state = snapshot.state
  const runId = runIdFromUrl(snapshot.target_url) ?? findRunId(options, commit)
  const runUrl =
    typeof snapshot.target_url === 'string' && snapshot.target_url !== ''
      ? snapshot.target_url
      : runId === null
        ? null
        : `https://github.com/${options.fork}/actions/runs/${runId}`
  info(`bb-verify terminal: state=${state}${runUrl === null ? '' : ` run=${runUrl}`}`)

  let verdict = null
  const dir = join(repo, '.bb-verify', branch)
  if (runId === null) {
    warn('no run id in the commit status and none found by sha — grab the artifact from the workflow run page')
  } else if (downloadArtifact(options, runId, dir)) {
    const verdictPath = findFile(dir, 'verdict.txt')
    if (verdictPath === null) {
      warn(`the ${ARTIFACT_NAME} artifact has no verdict.txt under ${dir}`)
    } else {
      info(`artifact ${ARTIFACT_NAME} → ${dir}`)
      write(readFileSync(verdictPath, 'utf8'))
      verdict = verdictFromFile(verdictPath)
    }
    const reportPath = findFile(dir, 'report.md')
    // The artifact carries report.md only when the session wrote one: an INFRA run
    // may ship verdict.txt alone. Absence is therefore a plain fact to surface,
    // never a path to assume — print it as such.
    info(
      reportPath === null
        ? `the ${ARTIFACT_NAME} artifact has no report.md (the session wrote no full report; an INFRA run may ship verdict.txt alone) — verdict.txt above is the whole verdict`
        : `report.md: ${reportPath}`,
    )
    // The caller's next step needs the FAIL details without a second command, so
    // the report head goes to stdout here (the file path above stays authoritative
    // for the full report).
    if (reportPath !== null) {
      const lines = readFileSync(reportPath, 'utf8').split('\n')
      write(lines.slice(0, REPORT_HEAD_LINES).join('\n'))
      if (lines.length > REPORT_HEAD_LINES) {
        info(
          `… report.md above is the first ${REPORT_HEAD_LINES} of ${lines.length} lines — full report: ${reportPath}`,
        )
      }
    }
  }

  const fromState = STATE_VERDICT[state] ?? 'INFRA'
  if (verdict === null) {
    warn(`no verdict.txt to read — falling back to the commit status (state=${state} → ${fromState})`)
    verdict = fromState
  } else if (verdict !== fromState) {
    warn(
      `commit status state=${state} maps to ${fromState}, but verdict.txt says VERDICT: ${verdict} — reporting the file`,
    )
  }
  info(`verdict: ${verdict}`)
  return VERDICT_EXIT[verdict] ?? EXIT_INFRA
}

// ── cleanup ──────────────────────────────────────────────────────────────────

function deleteLocalRef(repo, branch) {
  const result = tryRun('git', ['-C', repo, 'update-ref', '-d', `refs/heads/${branch}`])
  if (result.ok) info(`deleted local ref refs/heads/${branch}`)
  else warn(`could not delete local ref refs/heads/${branch}: ${errorText(result)}`)
}

/** Delete the remote temp branch only when it still points at our own commit. */
function deleteRemoteRef(options, branch, commit) {
  const ref = readRemoteRef(options.fork, branch)
  if (ref.known && ref.sha === null) {
    info(`remote branch ${branch} already gone`)
    return
  }
  if (ref.known && ref.sha !== commit) {
    warn(`remote branch ${branch} now points at ${ref.sha}, not at our temp commit ${commit} — leaving it alone`)
    return
  }
  if (!ref.known) warn(`could not read ${branch} before deleting — deleting anyway`)
  const result = tryRun('gh', ['api', '-X', 'DELETE', `repos/${options.fork}/git/refs/heads/${branch}`])
  if (result.ok) info(`deleted remote branch ${branch} on ${options.fork}`)
  else warn(`could not delete remote branch ${branch}: ${errorText(result)}`)
}

/** Branch handling after a terminal verdict; shared by --wait and --fetch so both paths behave identically. */
function finishTerminal(options, repo, branch, commit) {
  if (options.keepBranch) {
    info(`--keep-branch: leaving ${branch} in place (local + ${options.fork})`)
    info(
      `delete it later: git -C ${repo} update-ref -d refs/heads/${branch} && gh api -X DELETE repos/${options.fork}/git/refs/heads/${branch}`,
    )
  } else {
    deleteLocalRef(repo, branch)
    deleteRemoteRef(options, branch, commit)
  }
}

// ── one-shot fetch (--fetch) ─────────────────────────────────────────────────

/**
 * One status check for a dispatch made earlier: exit 3 while the run is queued
 * or still running, otherwise the terminal path (artifact download, verdict.txt
 * + report head, branch cleanup) with the verdict's exit code.
 */
function fetchVerdict(options, repo) {
  const { sha, branch } = options
  info(`fetch: ${STATUS_CONTEXT} status of ${sha} on ${options.fork} (branch ${branch})`)
  const probe = readVerifyStatus(options.fork, sha)
  if (!probe.ok) {
    warn(`status probe failed: ${probe.error}`)
    info(`check manually: gh api repos/${options.fork}/commits/${sha}/status`)
    return EXIT_INFRA
  }
  const { snapshot } = probe
  if (snapshot === null) {
    info(`no ${STATUS_CONTEXT} status yet for ${shortSha(sha)} (queued?) — still running`)
    info('poll again in ~5 minutes with the same --fetch command')
    return EXIT_PENDING
  }
  if (!TERMINAL_STATES.has(snapshot.state)) {
    const runId = runIdFromUrl(snapshot.target_url)
    info(`${STATUS_CONTEXT} state=${snapshot.state}${runId === null ? '' : ` run=${runId}`} — still running`)
    info('poll again in ~5 minutes with the same --fetch command')
    return EXIT_PENDING
  }
  const exitCode = reportTerminal({ options, repo, branch, commit: sha, snapshot })
  finishTerminal(options, repo, branch, sha)
  return exitCode
}

// ── dry run ──────────────────────────────────────────────────────────────────

function printPlan(options, { repo, baseSha, branch }) {
  const dir = join(repo, '.bb-verify', branch)
  info('dry run: nothing below is executed — no objects written, no refs, no push, no dispatch')
  const steps = [
    `git -C ${repo} hash-object -w ${options.taskFile}`,
    `git -C ${repo} ls-tree -z <base-tree> | git -C ${repo} mktree -z   # ${TASK_FILE_NAME} added/replaced at root`,
    `git -C ${repo} commit-tree <new-tree> -p ${baseSha} -m "bb-verify: ${branch}"   # author/committer ${BOT_NAME}`,
    `git -C ${repo} update-ref refs/heads/${branch} <new-commit>`,
    `git -C ${repo} push https://x-access-token:***@github.com/${options.fork}.git refs/heads/${branch}`,
    `gh api --method POST repos/${options.fork}/actions/workflows/${options.workflow}/dispatches ` +
      `-f ref=${WORKFLOW_REF} -f inputs[ref]=${branch} -f inputs[sha]=<new-commit> -f inputs[layer]=${options.layer}`,
  ]
  if (options.wait) {
    steps.push(
      `gh api repos/${options.fork}/commits/<new-commit>/status   # poll every ${options.pollSec}s up to ${options.timeoutMin}min for context ${STATUS_CONTEXT}`,
    )
    steps.push(`gh run download <run-id> -R ${options.fork} -n ${ARTIFACT_NAME} -D ${dir}`)
    steps.push(
      options.keepBranch
        ? `(--keep-branch) skip: delete refs/heads/${branch} locally and on ${options.fork}`
        : `git -C ${repo} update-ref -d refs/heads/${branch} && gh api -X DELETE repos/${options.fork}/git/refs/heads/${branch}`,
    )
  } else {
    steps.push(
      `exit 0 after the dispatch; the temp branch stays until deleted: gh api -X DELETE repos/${options.fork}/git/refs/heads/${branch}`,
    )
  }
  process.stdout.write('planned operations:\n')
  steps.forEach((step, index) => process.stdout.write(`  ${String(index + 1).padStart(2)}. ${step}\n`))
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
  const options = readOptions(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (options.fetch) {
    const { repo } = preflightFetch(options)
    return fetchVerdict(options, repo)
  }
  const { repo, baseSha } = preflight(options)
  const branch = options.branch ?? defaultBranchName(baseSha)
  info(`target: ${options.fork} workflow=${options.workflow}@${WORKFLOW_REF} layer=${options.layer}`)
  info(`repo: ${repo}  base: ${options.base} = ${baseSha}`)
  info(`task file: ${options.taskFile} → ${TASK_FILE_NAME} at the temp branch root`)
  info(`temp branch: ${branch}`)

  if (options.dryRun) {
    printPlan(options, { repo, baseSha, branch })
    return 0
  }

  const { commit } = createTempBranch(repo, baseSha, branch, options.taskFile)
  info(`temp commit: ${commit} (parent ${shortSha(baseSha)}, tree carries ${TASK_FILE_NAME})`)

  const remoteBefore = readRemoteRef(options.fork, branch)
  if (remoteBefore.sha !== null) {
    warn(`remote branch ${branch} already exists on ${options.fork} (${remoteBefore.sha}) — the push will move it`)
  }

  pushTempBranch(repo, options.fork, branch, ghAuthToken(options))
  info(`pushed refs/heads/${branch} to ${options.fork}`)

  try {
    dispatchWorkflow(options, branch, commit)
  } catch (error) {
    // The API rejected the dispatch: no run should exist, but a partially
    // applied dispatch cannot be ruled out, so the remote branch is left for
    // the operator rather than deleted under a possibly-running job.
    warn(
      `dispatch failed — leaving ${branch} on ${options.fork} in case a run started; ` +
        `delete it with: gh api -X DELETE repos/${options.fork}/git/refs/heads/${branch}`,
    )
    if (!options.keepBranch) deleteLocalRef(repo, branch)
    throw error
  }
  info(`dispatched ${options.workflow}@${WORKFLOW_REF} on ${options.fork} for ${shortSha(commit)}`)

  if (!options.wait) {
    info('not waiting (no --wait) — the temp branch stays for the run to check out')
    // The poll instruction is the exact follow-up command, ready to copy: each
    // call is one short status check, so it survives a capped shell.
    info(
      `poll with: node ${SELF_PATH} --fetch --repo ${repo} --sha ${commit} --branch ${branch}${options.keepBranch ? ' --keep-branch' : ''}`,
    )
    info(
      '  one short status check per call: exit 3 = still running (poll again in ~5 min), 0 = PASS, 1 = FAIL, 2 = INFRA',
    )
    info(
      `delete when done: git -C ${repo} update-ref -d refs/heads/${branch} && gh api -X DELETE repos/${options.fork}/git/refs/heads/${branch}`,
    )
    return 0
  }

  const snapshot = waitForVerdict(options, commit)
  if (snapshot === null) {
    warn(
      `timed out after ${options.timeoutMin}min with no terminal ${STATUS_CONTEXT} status — the run may still be queued or running`,
    )
    info(`status: gh api repos/${options.fork}/commits/${commit}/status`)
    info(`delete the temp branch when the run is done: gh api -X DELETE repos/${options.fork}/git/refs/heads/${branch}`)
    if (!options.keepBranch) deleteLocalRef(repo, branch)
    return EXIT_INFRA
  }

  const exitCode = reportTerminal({ options, repo, branch, commit, snapshot })
  finishTerminal(options, repo, branch, commit)
  return exitCode
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`ci-dispatch: error: ${error.message}\n`)
    } else {
      process.stderr.write(`ci-dispatch: unexpected error: ${error?.stack ?? error}\n`)
    }
    process.exitCode = EXIT_INFRA
  }
}
