#!/usr/bin/env bash
# bb-verify-watchdog.sh —— bb-verify 结论通道的“最外层”兜底探针（轻量版）
#
# 定位：fork / 本机部署物料，非上游交付物（与 ci/ 下其他物料同一声明）。
#
# 结论通道（ref 模式）：verification 是 workflow_dispatch 跑在临时 verify/* 分支上的，全程
# 没有 PR。结论只有两条面——dispatch 那个 sha 上的 commit status（context `bb-verify`：
# pending → success|failure|error）与 run 的 `bb-verify-verdict` artifact（verdict.txt +
# 会话写出的 report.md；INFRA 轮可能只有前者）。**PR 评论通道已整体删除**：本脚本只读 API，
# 不写任何远端东西，信号面就是 journal 里的红线行 + exit 1。
#
# 它补的是 report 伴生作业也覆盖不到的“更深一层”故障：当整个 workflow 没能正常收尾、或连
# hosted report 作业都没跑起来时（并发把 run 卡在 queued、YAML 解析失败、report 作业自身
# 异常、runner 长期 offline 导致 job 无人认领），结论通道上就会出现“既没有 terminal status，
# 也没有任何 verdict artifact”的空窗。本脚本以只读 API 巡检下列判据，命中即往 journal 打一行
# 可 grep 的红线（`OFFLINE:` / `QUEUED:` / `VERDICT-CHANNEL:` / `DRIFT:` / `LABELS REDLINE:`）
# 并计入退出码 1。
#
# 判据（五条巡检；全部只写 journal + 计入退出码，不贴任何地方）：
#   1) runner offline 连续 2 个周期（跨调用状态记在 $STATE_DIR/offline_streak）——
#      20min 的门槛避开一次正常 restart 的 session-TTL 重连窗口（实测约 30-90s）。
#      命中打 `OFFLINE:` 行，细节里点名「最新一条仍在等 runner 的 bb-verify run」（没有在飞
#      run 就写明没有）——runner 离线本身是部署级事实，红线的成立不依赖有没有 run 可归属。
#      取那条 run 时**不能**用 `?event=a,b&status=c,d`：REST 的 event/status 不支持逗号多值
#      （2026-09-07 实测 `status=completed` 单值 93 条、`status=completed,queued` 逗号多值
#      total=0），旧写法恒空集 → “找那条被卡住的 run”永远拿不到东西。现在改成两次单值查询
#      （in_progress、queued）+ 客户端 jq 按 workflow 名过滤。
#   2) 某条 bb-verify run 处于 queued 超过 30min，**且确实没有 in_progress 的 bb-verify
#      run**：本机只有一台 self-hosted（单 slot）+ concurrency 串行化，一条 queued 而另一条
#      in_progress 是正常排队，不是故障——不加这道核对就会每 10min 把“前面有人在跑”误报成
#      基础设施异常。命中打 `QUEUED:` 行，标签里写明 (no-run-in-progress)。
#   3) 结论通道断链：lookback 窗口内每条 completed 且 conclusion=success 的 bb-verify run 都
#      必须带 `bb-verify-verdict` artifact（每条一次 artifacts API 调用）。success 却没有
#      artifact = 线上没把结论留在通道上，命中打 `VERDICT-CHANNEL:` 行。只查
#      event=workflow_dispatch、updated_at（≈完成时刻）落在窗口内的 run；每轮至多查
#      BB_VERIFY_VERDICT_MAX_RUNS 条（超时纪律），BB_VERIFY_VERDICT_SINCE 可再钉一个起始
#      时刻——ref 模式切换之前完成的 run 本来就没有这份 artifact，要避开那批历史就把它钉到
#      切换时刻。artifacts API 调用失败只记 WARN、**不算**命中（与④⑤同口径：绝不把 API 故障
#      报成通道事故）。
#   4) fork 部署物料漂移：fork main 的 .github/workflows/bb-verify.yml 与本机
#      verify-runner/ci/bb-verify.yml 必须逐字节一致（比 sha256）；④b 再比
#      .github/scripts/bb-verify/*.sh 与 .github/workflows/bb-verify.md（recursive
#      tree 的 blob sha 对 ci/scripts/ 与 ci/bb-verify.md）——workflow 瘦身后步骤逻辑
#      在脚本里，只看 yml 会漏掉「线上脚本不是本机这份」。漂移 = 线上跑的压根不是
#      本机这份判定逻辑（2026-09-07 的“第五判定块线上不存在”事故形态）。命中打 `DRIFT:` 行
#      + exit 1。任一侧读不到只记 WARN、**不算**漂移（不把 API 故障报成部署事故）。
#   5) runner labels 红线（部署级）：本 fork 那台 self-hosted runner（amax）的 label 集
#      **必须严格等于** self-hosted,Linux,X64,cpu-server——一个都不能多。防的是「好心人给
#      amax 再加一个 label（尤其 `check`）」：一旦 amax 带上 `check`，它就会认领本 fork 里那些
#      `runs-on: check` 的上游 workflow（check.yaml / regression.yml），而这些 job 的第一步是
#      上游 .github/scripts/ci_repo_lock.sh prepare，其 repo_reset 对主仓与 bbdev/bebop/buddy-mlir
#      执行 git clean -ffd + reset --hard，会**摧毁持久化热树 /home/ROXY/bb-verify/buckyball
#      的全部增量构建产物**，且上游锁目录 /tmp/buckyball-ci 与 bb-verify 用的
#      /home/ROXY/bb-verify/bb-verify.lock 是两把互不互斥的锁、并发会同时动同一棵树（见
#      runner-setup.md §4 红线）。命中打 `LABELS REDLINE:` 行 + exit 1。两种「拿不到」分开记：
#      API 调用失败或响应体为空 → 只记 WARN、**不算**命中（不把 API 故障报成部署事故，也绝不把
#      「取不到」臆断成「有非法 label」）；API 成功但 runners 是空数组 → 逐台比对没有台可比，落
#      OK 行（0 台），本判据同样不响——「runner 被删」这个形态由判据②兜（没有 runner 认领，run
#      会一直 queued）。⚠ 这条只读 API 报警，不去动 runner 配置（改 label 属本机 runner 操作，
#      不随脚本生效）。
#
# ⚠ unit 的 SuccessExitStatus=0 1 会把本脚本的 exit 1 也记成成功，所以五条红线的信号面一律是
# journal 里那行前缀（`journalctl --user -u bb-verify-watchdog.service`），不是 unit 的 exited
# 状态；要让 unit 自己变红就得从 SuccessExitStatus 里去掉 1（本机 unit 改动，不随脚本生效）。
#
# 时间窗口径（判据③）：一律按 run 对象自己的 `updated_at`（≈完成时刻）与窗口下限比较，不按
# created_at——一条创建于窗口之前、刚刚才跑完的长 run 也必须进窗，否则「刚成功的 run 没有
# artifact」这个最要紧的形态会被静默漏掉。
#
# 每次 gh 网络调用带 `timeout 20`：unit 的 TimeoutStartSec=180 是整轮天花板，单个调用挂死
# 会把同轮其余判据一起吃掉。
#
# 安全：**只读**——不贴评论、不写远端、不碰持久根、不 pkill、不重启任何东西。唯一的本地写是
# 跨调用状态文件 $STATE_DIR/offline_streak（--dry-run 下不写）。凭据走 gh 已存的 hosts.yml；
# 网络直连即可（api.github.com 实测 200，无需代理；systemd-user 上下文里 HTTPS_PROXY 本就
# 未设）；脚本末尾的代理探测是独立诊断项，不影响 API 调用。
#
# 用法：
#   bb-verify-watchdog.sh            # 正常巡检（写 journal + 状态文件）
#   bb-verify-watchdog.sh --dry-run  # 只判定并打印，不写状态文件
#   BB_VERIFY_REPO=owner/repo bb-verify-watchdog.sh   # 覆盖默认仓库
#   BB_VERIFY_LOCAL_CI=/path/to/bb-verify.yml         # 覆盖判据④的本机对照物
#   BB_VERIFY_REMOTE_CI_PATH=... / BB_VERIFY_REF=...  # 覆盖判据④的远端路径与 ref
#   BB_VERIFY_VERDICT_SINCE=<iso>                     # 判据③只回看此刻之后完成的 run
#   BB_VERIFY_VERDICT_MAX_RUNS=<n>                    # 判据③每轮最多查 n 条 run（默认 5）
#
# 退出码：0 = 未命中任何红线；1 = ①（OFFLINE）/ ②（QUEUED）/ ③（VERDICT-CHANNEL）/
# ④（DRIFT）/ ⑤（LABELS）任一命中。五条判据都只写 journal，不改任何远端状态；--dry-run 下
# 同样参与判定与退出码（它们本就不写远端），仅额外跳过状态文件的写入。

set -uo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

REPO="${BB_VERIFY_REPO:-mctang985211-coder/buckyball}"
WORKFLOW_NAME="${BB_VERIFY_WORKFLOW:-bb-verify}"
# queued 超时阈值（秒）与 offline 连续周期阈值
QUEUED_STALE_SECS="${BB_VERIFY_QUEUED_STALE_SECS:-1800}"   # 30min
OFFLINE_STREAK_LIMIT="${BB_VERIFY_OFFLINE_STREAK:-2}"
# 只回看最近这段时间内的 completed run（判据 3），避免每 10min 重扫全部 history
LOOKBACK_HOURS="${BB_VERIFY_WATCHDOG_LOOKBACK_HOURS:-6}"
# 判据③的通道契约（改 workflow 侧就要同步这里）：artifact 名与 commit status context；
# 以及可选的窗口下限（ISO-8601 UTC，空 = 只用 lookback 窗口）与每轮 artifacts API 调用上限。
ARTIFACT_NAME="${BB_VERIFY_ARTIFACT_NAME:-bb-verify-verdict}"
STATUS_CONTEXT="${BB_VERIFY_STATUS_CONTEXT:-bb-verify}"
VERDICT_SINCE="${BB_VERIFY_VERDICT_SINCE:-}"
VERDICT_MAX_RUNS="${BB_VERIFY_VERDICT_MAX_RUNS:-5}"
# 单次 gh 调用的硬超时（秒）。
GH_TIMEOUT_SECS="${BB_VERIFY_GH_TIMEOUT:-20}"
# 判据④的对照物：默认从脚本自身位置推出同仓的本机部署物料（不写死用户目录）。
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_CI="${BB_VERIFY_LOCAL_CI:-$SELF_DIR/../ci/bb-verify.yml}"
REMOTE_CI_PATH="${BB_VERIFY_REMOTE_CI_PATH:-.github/workflows/bb-verify.yml}"
REMOTE_REF="${BB_VERIFY_REF:-main}"
# 判据⑤（runner labels 红线）：本 fork self-hosted runner 唯一合法的 label 集，严格相等、
# 一个都不能多。写成**已排序**的 JSON 数组供 jq 直接比对（jq 的 sort 与元素顺序无关）。
CANON_LABELS_JSON="${BB_VERIFY_CANON_LABELS:-[\"Linux\",\"X64\",\"cpu-server\",\"self-hosted\"]}"

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/bb-verify-watchdog"
mkdir -p "$STATE_DIR" 2>/dev/null
STREAK_FILE="$STATE_DIR/offline_streak"

# 所有 mktemp 产物登记进 TMPFILES，由 EXIT/INT/TERM trap 统一清理（中途退出或被打断都不留临时文件）。
TMPFILES=()
cleanup() { [ ${#TMPFILES[@]} -gt 0 ] && rm -f "${TMPFILES[@]}"; return 0; }
trap cleanup EXIT INT TERM
mktmp() { local f; f="$(mktemp)" || return 1; TMPFILES+=("$f"); printf '%s' "$f"; }

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

now_epoch() { date -u +%s; }
# 解析失败**不**返回 0（0 = 1970，会让 age 变成几十亿秒 → 假阳性“queued 超 30min”），
# 而是非零退出 + 空输出，由调用方的 `||` 守卫跳过该 run。
iso_to_epoch() { date -u -d "$1" +%s 2>/dev/null; }

# 数字型探测结果的守卫：空 / 非数字 = 探测失败（区别于合法的 0）。
is_int() { case "${1:-}" in ''|*[!0-9]*) return 1;; *) return 0;; esac; }

# gh 包装：每次网络调用带硬超时；所有网络调用失败都不致命（set -uo，无 set -e）。
gha() { timeout "$GH_TIMEOUT_SECS" gh api "$@"; }

# 本 workflow 的 run 清单（每行 "id attempt status created_at"）。status 用**单值**查询
# （REST 不支持逗号多值，见头注判据 1）；workflow 名过滤在客户端 jq 做。
runs_by_status() {
  gha "repos/$REPO/actions/runs?status=$1&per_page=30" 2>/dev/null \
    | jq -r --arg w "$WORKFLOW_NAME" \
        '.workflow_runs[] | select(.name==$w) | "\(.id) \(.run_attempt) \(.status) \(.created_at)"'
}

# ---- 判据 1：runner offline 连续 N 周期（journal 红线，打 OFFLINE: 行）----
OFFLINE=0
streak=$(cat "$STREAK_FILE" 2>/dev/null); streak="${streak:-0}"
is_int "$streak" || streak=0
runners_json=$(gha "repos/$REPO/actions/runners" 2>/dev/null)
if [ -z "$runners_json" ]; then
  log "WARN: cannot read runners list (API/网络失败) -- skip offline criterion this cycle"
else
  total=$(printf '%s' "$runners_json" | jq '.total_count // 0')
  onln=$(printf '%s' "$runners_json" | jq '[.runners[] | select(.status=="online")] | length')
  if [ "${total:-0}" -gt 0 ] && [ "${onln:-0}" -eq 0 ]; then
    streak=$((streak + 1))
    log "runner offline (0/$total online) consecutive_streak=$streak (limit=$OFFLINE_STREAK_LIMIT)"
    if [ "$streak" -ge "$OFFLINE_STREAK_LIMIT" ]; then
      OFFLINE=1
      # 归属对象只作细节（红线本身不依赖它）：最新一条仍在等 runner 的 bb-verify run。两次
      # 单值查询（in_progress 优先，其次 queued）——旧的 `status=queued,in_progress` 逗号写法
      # 恒空集，正是这一支曾经永远拿不到东西的根因。
      blocked=$( { runs_by_status in_progress; runs_by_status queued; } 2>/dev/null | head -1)
      if [ -n "$blocked" ]; then
        read -r bid batt bstat bcreated <<< "$blocked"
        log "OFFLINE: 0/$total runner online 已连续 ${streak} 个周期（阈值 ${OFFLINE_STREAK_LIMIT}）——等 runner 的是 bb-verify run=$bid (attempt ${batt:-1}, status=$bstat, created=$bcreated)"
      else
        log "OFFLINE: 0/$total runner online 已连续 ${streak} 个周期（阈值 ${OFFLINE_STREAK_LIMIT}）——当前没有在飞的 bb-verify run"
      fi
      log "OFFLINE: 处置 = 本机查 runner 服务（systemctl --user status github-actions-runner.service）再重启；本脚本只读报警，不重启任何东西。恢复后本判据下轮自动转绿。"
    fi
  else
    [ "$streak" != "0" ] && log "runner back online ($onln/$total) -- reset streak"
    streak=0
  fi
  [ "$DRY_RUN" = "1" ] || echo "$streak" > "$STREAK_FILE"
fi

# ---- 判据 2：queued > 30min（且确实没有 run 在跑）——journal 红线，打 QUEUED: 行 ----
QUEUED=0
now=$(now_epoch)
# 先排除「正常排队」：单 runner slot + concurrency 串行化下，一条 queued、另一条 in_progress
# 是正常现象；有 in_progress 的 bb-verify run → 整条判据 2 站开。
running=$(runs_by_status in_progress | grep -c . || true)
if is_int "$running" && [ "$running" -gt 0 ]; then
  log "criterion2 stands down: $running bb-verify run(s) in_progress -- a queued run behind them is normal single-slot serialisation, not infra failure"
else
  while read -r rid rattr rstat rcreated; do
    [ -n "$rid" ] || continue
    created_epoch=$(iso_to_epoch "$rcreated") || { log "criterion2 skip run=$rid: unparseable created_at '$rcreated'"; continue; }
    age=$(( now - created_epoch ))
    if [ "$age" -gt "$QUEUED_STALE_SECS" ]; then
      QUEUED=1
      log "QUEUED: bb-verify run=$rid (attempt ${rattr:-1}) 已 queued ${age}s（阈值 ${QUEUED_STALE_SECS}s）且没有任何 in_progress 的 bb-verify run（no-run-in-progress）——不是正常排队：runner slot 无人占用。处置 = 查 runner 是否在线/能认领 job（同轮判据①的 OFFLINE 行同看）。"
    fi
  done < <(runs_by_status queued)
fi

# ---- 判据 3：success 的 run 必须带 verdict artifact（journal 红线，打 VERDICT-CHANNEL: 行）----
# 结论通道 = dispatch sha 的 commit status（context=bb-verify）+ run 的 bb-verify-verdict
# artifact。conclusion=success 却没有这份 artifact = 通道断链（artifact 步丢失/改名/上传一直
# 失败），消费方永远拿不到 verdict.txt。窗口按 run 的 updated_at（≈完成时刻）算，只查
# event=workflow_dispatch；每轮至多查 BB_VERIFY_VERDICT_MAX_RUNS 条（每条一次 artifacts API
# 调用，超时纪律），BB_VERIFY_VERDICT_SINCE 可再钉一个起始时刻（ref 模式切换前完成的 run
# 本来就没有这份 artifact）。artifacts API 调用失败只 WARN、**不算**命中（与④⑤同一口径：
# 绝不把 API 故障报成通道事故）。
VERDICT_CHANNEL_BAD=0
is_int "$VERDICT_MAX_RUNS" || VERDICT_MAX_RUNS=5
cutoff_iso=$(date -u -d "-${LOOKBACK_HOURS} hours" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
cutoff_epoch=$(iso_to_epoch "$cutoff_iso") || cutoff_epoch=""
since_epoch=""
if [ -n "$VERDICT_SINCE" ]; then
  since_epoch=$(iso_to_epoch "$VERDICT_SINCE") || { log "WARN criterion3: BB_VERIFY_VERDICT_SINCE='$VERDICT_SINCE' 不是可解析的 ISO 时刻 -- 忽略该下限"; since_epoch=""; }
fi
checked=0
while read -r rid rdone; do
  [ -n "$rid" ] || continue
  run_epoch=$(iso_to_epoch "$rdone") || { log "criterion3 skip run=$rid: unparseable updated_at '$rdone'"; continue; }
  if [ -n "$cutoff_epoch" ] && [ "$run_epoch" -lt "$cutoff_epoch" ]; then continue; fi
  if [ -n "$since_epoch" ] && [ "$run_epoch" -lt "$since_epoch" ]; then continue; fi
  if [ "$checked" -ge "$VERDICT_MAX_RUNS" ]; then
    log "criterion3: 已达每轮上限 ${VERDICT_MAX_RUNS} 条 run（BB_VERIFY_VERDICT_MAX_RUNS），窗口内其余 run 下轮再看"
    break
  fi
  checked=$((checked + 1))
  # 一次 artifacts API 调用/条。「调用失败」与「确实没有 artifact」必须分开：前者只是不知道，
  # 记 WARN 不算命中；后者才是通道断链。`if ! names=$(...)` 用 gh 的退出码区分两者。
  if ! names=$(gha "repos/$REPO/actions/runs/$rid/artifacts" --jq '[.artifacts[].name] | join(",")' 2>/dev/null); then
    log "WARN criterion3 run=$rid: artifacts probe failed (API/网络失败) -- skip this run (not treated as a broken verdict channel)"
    continue
  fi
  case ",$names," in
    *",$ARTIFACT_NAME,"*) log "criterion3 OK run=$rid: artifact ${ARTIFACT_NAME} 在场" ;;
    *)
      VERDICT_CHANNEL_BAD=1
      log "VERDICT-CHANNEL: bb-verify run=$rid conclusion=success 却没有 ${ARTIFACT_NAME} artifact（该 run 的 artifacts=[${names:-无}]）——结论通道断链，消费方拿不到 verdict.txt。处置 = 查该 run 的 verdict artifact 上传步与 artifact 名（commit status 面 context=${STATUS_CONTEXT} 另算）。"
      ;;
  esac
done < <(gha "repos/$REPO/actions/runs?status=completed&event=workflow_dispatch&per_page=30" 2>/dev/null \
          | jq -r --arg w "$WORKFLOW_NAME" '.workflow_runs[] | select(.name==$w and .conclusion=="success") | "\(.id) \(.updated_at)"')

# ---- 判据 4：fork 部署物料漂移（防“线上跑的不是本机这份判定逻辑”）----
# 只读比对 sha256。命中打 journal 的 DRIFT: 行 + 置 exit 1。
# 远端 raw 走 Contents API 的 raw media type，**直接落文件**再算哈希：绝不能用
# `var=$(gh api ...)`——命令替换会剥掉结尾换行，一份以 \n 收尾的正常文件就会被算成不等
# （假漂移）。任一侧读不到都**不算**漂移（宁可漏报，也不把 API 故障报成部署事故）；
# 只有两边都读到非空内容且不等时才判漂移。
DRIFT=0
if [ ! -f "$LOCAL_CI" ]; then
  log "WARN criterion4(drift): local material $LOCAL_CI missing -- cannot compare, skipping (not treated as drift)"
else
  remote_f="$(mktmp)" || remote_f=""
  if [ -z "$remote_f" ]; then
    log "WARN criterion4(drift): mktemp failed -- cannot compare, skipping (not treated as drift)"
  else
    timeout "$GH_TIMEOUT_SECS" gh api "repos/$REPO/contents/$REMOTE_CI_PATH?ref=$REMOTE_REF" \
      -H "Accept: application/vnd.github.raw" > "$remote_f" 2>/dev/null
    if [ ! -s "$remote_f" ]; then
      log "WARN criterion4(drift): cannot read $REPO/$REMOTE_CI_PATH@$REMOTE_REF (API failure or empty) -- cannot compare, skipping (not treated as drift)"
    else
      local_sha=$(sha256sum < "$LOCAL_CI" | cut -d' ' -f1)
      remote_sha=$(sha256sum < "$remote_f" | cut -d' ' -f1)
      if [ "$local_sha" = "$remote_sha" ]; then
        log "criterion4(drift) OK: $REMOTE_CI_PATH@$REMOTE_REF 逐字节 == $LOCAL_CI (sha256 ${local_sha:0:12}…)"
      else
        DRIFT=1
        log "DRIFT: $REPO $REMOTE_CI_PATH@$REMOTE_REF sha256=${remote_sha:0:12}… != 本机 $LOCAL_CI sha256=${local_sha:0:12}…"
        log "DRIFT: 线上 workflow 不是本机这份物料（典型形态：本机新增的判定块/修复在线上不存在）。处置 = 把本机 ci/bb-verify.yml 推 fork main，再复跑本判据确认转绿。"
      fi
    fi
  fi
fi

# 判据 4b：步骤脚本与文档的漂移（2026-09-14 起 workflow 瘦身为编排层，步骤逻辑在
# .github/scripts/bb-verify/*.sh——只比 yml 会让「线上脚本不是本机这份」成为漏报面）。
# 一次 recursive tree 调用拿到全部 blob sha，与本机 `git hash-object` 比对（blob sha 对
# 逐字节相同的文件必然相等，不受 exec 位影响）。API 失败只 WARN 不算漂移（同 ④ 口径）。
tree_f="$(mktmp)" || tree_f=""
if [ -z "$tree_f" ]; then
  log "WARN criterion4b(drift): mktemp failed -- cannot compare scripts, skipping (not treated as drift)"
else
  timeout "$GH_TIMEOUT_SECS" gh api "repos/$REPO/git/trees/$REMOTE_REF?recursive=1" > "$tree_f" 2>/dev/null
  if [ ! -s "$tree_f" ]; then
    log "WARN criterion4b(drift): cannot read $REPO tree@$REMOTE_REF (API failure) -- cannot compare scripts, skipping (not treated as drift)"
  else
    for pair in \
      "$SELF_DIR/../ci/scripts:.github/scripts/bb-verify" \
      "$SELF_DIR/../ci/bb-verify.md:.github/workflows/bb-verify.md" ; do
      local_src="${pair%%:*}"; remote_path="${pair#*:}"
      if [ -d "$local_src" ]; then
        candidates="$local_src"/*.sh
        for local_f in $candidates; do
          remote_p="$remote_path/$(basename "$local_f")"
          remote_blob=$(jq -r --arg p "$remote_p" '.tree[] | select(.path==$p) | .sha' "$tree_f")
          local_blob=$(git hash-object "$local_f" 2>/dev/null)
          if [ -n "$remote_blob" ] && [ -n "$local_blob" ] && [ "$remote_blob" = "$local_blob" ]; then
            log "criterion4b(drift) OK: $remote_p@$REMOTE_REF == ${local_f##*/} (blob ${local_blob:0:12}…)"
          else
            DRIFT=1
            log "DRIFT: $REPO $remote_p@$REMOTE_REF blob=${remote_blob:-<缺失>} != 本机 $local_f blob=${local_blob:-<不可算>}"
            log "DRIFT: 线上步骤脚本不是本机这份物料。处置 = 把本机 ci/scripts/ 推到 fork main 的 .github/scripts/bb-verify/，再复跑本判据确认转绿。"
          fi
        done
      elif [ -f "$local_src" ]; then
        remote_blob=$(jq -r --arg p "$remote_path" '.tree[] | select(.path==$p) | .sha' "$tree_f")
        local_blob=$(git hash-object "$local_src" 2>/dev/null)
        if [ -n "$remote_blob" ] && [ -n "$local_blob" ] && [ "$remote_blob" = "$local_blob" ]; then
          log "criterion4b(drift) OK: $remote_path@$REMOTE_REF == ${local_src##*/} (blob ${local_blob:0:12}…)"
        else
          DRIFT=1
          log "DRIFT: $REPO $remote_path@$REMOTE_REF blob=${remote_blob:-<缺失>} != 本机 $local_src blob=${local_blob:-<不可算>}"
          log "DRIFT: 线上文档不是本机这份物料。处置 = 把本机 ci/bb-verify.md 推到 fork main 的 .github/workflows/bb-verify.md，再复跑本判据确认转绿。"
        fi
      fi
    done
  fi
fi

# ---- 判据 5：runner labels 红线（防好心人给 amax 加 label 引爆 ci_repo_lock.sh）----
# 唯一合法的 self-hosted runner label 集 = self-hosted,Linux,X64,cpu-server，严格相等、多一个即
# 红线。命中打 journal 的 LABELS REDLINE: 行 + 置 LABELS_BAD=1。
# 取不到 runners 只 WARN、不算命中（与判据④同口径：绝不把 API 故障报成部署事故，也不把「取不到」
# 臆断成「有非法 label」）。本判据只读报警，不改 runner 配置。
LABELS_BAD=0
if [ -z "$runners_json" ]; then
  log "WARN criterion5(labels): cannot read runners list (API/网络失败) -- cannot check, skipping (not treated as a labels violation)"
else
  # 每台 runner 的 label 集与规范集比对（jq sort 与元素顺序无关）；逐台流式输出不相等的机器，
  # 一行一个，列出多/少的 label。注意这里**不能**用 `[ .runners[] ... ]` 数组构造——那样整段
  # 表达式里只有字符串内的 `[...]`，外层 `[` 收不到匹配 `]`，jq 会「unexpected end of file」编译失败、
  # labels_offenders 恒空 → 红线永不触发（静默死代码）。直接 `.runners[] | ...` 流式即可。
  labels_offenders=$(printf '%s' "$runners_json" | jq -r --argjson canon "$CANON_LABELS_JSON" '
    .runners[]
    | ((.labels // []) | map(.name) | sort) as $got
    | ($canon | sort) as $want
    | select($got != $want)
    | "\(.name): got=[\($got|join(","))] extra=[\(($got - $want)|join(","))] missing=[\(($want - $got)|join(","))]"' )
  if [ -n "$labels_offenders" ]; then
    LABELS_BAD=1
    while IFS= read -r off; do
      [ -n "$off" ] || continue
      log "LABELS REDLINE: $off —— self-hosted runner 的 label 集必须严格 == $(printf '%s' "$CANON_LABELS_JSON" | jq -rc 'sort|join(",")')"
    done <<< "$labels_offenders"
    # 专门点名 `check`：它是上游 check.yaml/regression.yml 的 runs-on label，amax 一旦带上就会认领
    # 那些 job 的第一步 ci_repo_lock.sh prepare（repo_reset 对主仓+子模块 git clean -ffd + reset
    # --hard），摧毁持久化热树的全部增量产物，且两把锁互不互斥、并发会同时动同一棵树。
    check_hit=$(printf '%s' "$runners_json" \
      | jq -r '[.runners[] | select(((.labels // []) | map(.name)) | index("check")) | .name] | join(",")')
    if [ -n "$check_hit" ]; then
      log "LABELS REDLINE: runner [$check_hit] 带了上游用的 \`check\` label —— 它会认领 check.yaml/regression.yml 的 job，其 ci_repo_lock.sh prepare 将摧毁持久化热树。处置：在本机 runner 机器上撤下该 label（重跑 config.sh 只带 cpu-server，或按 runner-setup.md §4），**不要**在本脚本里动 runner。"
    fi
    log "LABELS REDLINE: 处置 = 按 runner-setup.md §4 修正 label 集后复跑本判据确认转绿。"
  else
    log "criterion5(labels) OK: $(printf '%s' "$runners_json" | jq -r '.runners|length') runner 台的 label 集均严格 == $(printf '%s' "$CANON_LABELS_JSON" | jq -rc 'sort|join(",")')"
  fi
fi

# ---- 代理可达性探测（独立诊断，不影响 API 调用）----
PX="${HTTPS_PROXY:-${https_proxy:-}}"
if [ -n "$PX" ]; then
  pxcode=$(curl -sS -x "$PX" -o /dev/null -w '%{http_code}' --max-time 12 https://api.github.com 2>/dev/null)
  log "proxy-reachability: -x $PX https://api.github.com -> HTTP ${pxcode:-fail}"
else
  log "proxy-reachability: HTTPS_PROXY unset in this context (API works via direct route)"
fi

# 五条红线（①OFFLINE / ②QUEUED / ③VERDICT-CHANNEL 是 runner 与结论通道侧事实，④DRIFT /
# ⑤LABELS 是部署级事实）任一命中即 exit 1，供 journal 与（去掉 SuccessExitStatus 后的）unit 观察。
RC=0
[ "$OFFLINE" = 1 ] && RC=1
[ "$QUEUED" = 1 ] && RC=1
[ "$VERDICT_CHANNEL_BAD" = 1 ] && RC=1
[ "$DRIFT" = 1 ] && RC=1
[ "$LABELS_BAD" = 1 ] && RC=1
log "watchdog cycle done (dry_run=$DRY_RUN repo=$REPO offline=$OFFLINE queued=$QUEUED verdict_channel_bad=$VERDICT_CHANNEL_BAD drift=$DRIFT labels_bad=$LABELS_BAD rc=$RC)"
exit "$RC"
