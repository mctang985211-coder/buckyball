#!/usr/bin/env bash
# runner-orphan-sweep.sh —— 按「单元 cgroup 精确归属」清扫 runner 单元的陈旧孤儿进程。
#
# 定位：fork / 本机部署物料，非上游交付物（与 ci/ 下其他物料同一声明）。
# 设计意图：作为 github-actions-runner.service 的 ExecStartPre 使用。基础单元是
# KillMode=process，restart/stop 只给 run.sh 发信号，上一轮的 Runner.Listener /
# run-helper.sh / Runner.Worker / 引擎子进程（java、python3.12、iii、node headless 会话…）
# 会被 reparent 后**继续留在本单元的 cgroup 里**（journal 原文即证据：
#   "Found left-over process 3316777 (Runner.Listener) in control group while starting unit"
#   "Unit process 3289889 (java) remains running after unit stopped"）。
# 残留 listener 还占着 runner session，新 listener 就会陷入
#   "A session for this runner already exists / Runner connect error: Error: Conflict"
# 直到服务端 session TTL 过期（本机实测约 76s：20:34:49 首次 Conflict → 20:35:57 重连成功）。
#
# 为什么不再用 pkill -f 的子串清单（2026-09-07 复审结论，三处缺陷）：
#   (a) 误杀：`iii` 作为子串能命中任何 argv 含「iii」的 ROXY 进程（实测连探针 shell 都被
#       命中）——共享机（503G 多租户）上这是不可接受的杀伤面。
#   (b) 漏杀：真正的长命会话进程 argv 是
#       `node --import tsx/esm apps/cli/src/bin.ts --profile headless`，
#       「dsh --profile headless」这个子串清不到它。
#       ——而它按定义就在 runner 的 cgroup 里（是 job 的子进程），cgroup 清扫能抓到。
#   (c) 漏杀：20:34 事故的真实残留 java / python3.12 里，java 完全不在旧 pattern 里。
#   根因是「用 argv 猜身份」。改成用**归属事实**：孤儿一定留在本单元 cgroup 内，
#   于是清扫面 = systemd 本该在 KillMode=control-group 下杀掉的集合，不多不少。
#
# 安全闸门（全部 fail-closed，任何校验不过都不杀）：
#   0. 目标单元必须是普通 `.service`：user@<uid>.service / init.scope / *.slice / *.target /
#      *.mount 一律拒绝 —— 这类目标的 cgroup 本身就是整个用户会话，误配等于杀掉用户全部进程。
#   1. ControlGroup 必须解析成功、必须落在 /sys/fs/cgroup/user.slice/user-<uid>.slice/
#      user@<uid>.service/ 之下、且最后一级必须正好是目标单元名 —— 防止单元名写错或
#      解析异常时退化成「清扫整个 user.slice」。
#   2. 只碰 cgroup2 单一层级挂载点下的路径（本机 systemd 255 default-hierarchy=unified）。
#   3. 只杀 euid 自己的进程；其他 uid 出现在同一 cgroup 只记录不动手。
#   4. 永远排除自身、自身祖先链、以及自身的全部后代（ExecStartPre 的清扫进程自己就在
#      本单元 cgroup 里；清扫时 fork 出的子进程也会被枚举到）；单元自己的 MainPID 也永不触碰。
#      杀之前还用 /proc/<pid>/cgroup 复核该 pid 仍在本子树内 —— 挡 PID 复用竞态。
#   5. 单元还在 active 且 MainPID 存活时，kill 模式直接拒绝（除非 --force）：手工误跑
#      不能把在飞 job 打掉。ExecStartPre 时刻单元是 activating + MainPID=0，闸门自然放行。
#   6. 默认模式是 --dry-run：忘记传 --kill 的后果是「什么都没杀」，而不是「杀错」。
#
# 失败语义：内部一律 best-effort（无 set -e）。个别进程杀不掉（竞态中自然退出、权限）
# 不算失败，仍 exit 0；只有配置级错误（单元不存在 / cgroup 路径校验不过 / 单元活着却
# 要 kill）才非 0 退出，便于 journal 里区分。unit 侧另有 `-` 前缀兜底，双保险不阻塞启动。
#
# 用法：
#   runner-orphan-sweep.sh                      # 干跑（默认）：只打印将要杀什么，不 kill
#   runner-orphan-sweep.sh --dry-run            # 同上，显式
#   runner-orphan-sweep.sh --kill               # 真杀（unit 的 ExecStartPre 用这个）
#   runner-orphan-sweep.sh --kill --force       # 跳过「单元仍 active」闸门（人工救急，慎用）
#   RUNNER_UNIT=other.service runner-orphan-sweep.sh --dry-run   # 覆盖目标单元
#
# 输出全部走 stdout（systemd 捕获进 journal），前缀 [runner-orphan-sweep] 便于 grep。

set -uo pipefail

UNIT="${RUNNER_UNIT:-github-actions-runner.service}"
MODE="dry-run"   # dry-run | kill；默认干跑 —— 忘传 --kill 的后果是「什么都没杀」，不是「杀错」
MODE_SET=0
FORCE=0
CG_ROOT_DEFAULT="/sys/fs/cgroup"

usage() {
  sed -n 's/^# \{0,1\}//p' "$0" | sed -n '/^用法：/,/^$/p'
}

set_mode() {   # 显式给过两个不同模式 = 用法错误，不猜
  if [[ $MODE_SET -eq 1 && $MODE != "$1" ]]; then
    echo "[runner-orphan-sweep] ERROR: --dry-run 与 --kill 互斥"; exit 2
  fi
  MODE="$1"; MODE_SET=1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) set_mode dry-run ;;
    --kill)    set_mode kill ;;
    --force)   FORCE=1 ;;
    --unit)    shift; UNIT="${1:-}" ;;
    --unit=*)  UNIT="${1#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[runner-orphan-sweep] ERROR: 未知参数：$1"; usage; exit 2 ;;
  esac
  shift
done

log() { echo "[runner-orphan-sweep] $*"; }
die() { log "ERROR: $*"; exit 2; }

[[ -n $UNIT ]] || die "--unit/RUNNER_UNIT 给了空单元名"

# 自检：systemctl --user 必须可用（本脚本只服务 user-level 单元）
command -v systemctl >/dev/null 2>&1 || die "找不到 systemctl"

# cgroup2 单一层级（本机前提）；挂载点异常时宁可不作为
mount_fstype=$(stat -fc '%T' "$CG_ROOT_DEFAULT" 2>/dev/null || echo unknown)
[[ $mount_fstype == cgroup2fs ]] || die "$CG_ROOT_DEFAULT 不是 cgroup2fs（实为 $mount_fstype），拒绝清扫"

load_state=$(systemctl --user show -p LoadState --value "$UNIT" 2>/dev/null | tr -d '[:space:]')
[[ -n $load_state ]] || die "systemctl --user 无法查询单元 $UNIT（user manager 不可达？）"
[[ $load_state == not-found ]] && die "单元 $UNIT 不存在（LoadState=not-found），拒绝清扫"

# 闸门 0：显式黑名单。清扫的杀伤面 = 该单元的整个 cgroup 子树，所以「单元自身的 cgroup
# 就是整个用户会话」的那类目标绝对不能接受（user@<uid>.service 是 user manager 本体，
# init.scope 是它的父作用域）—— 误配这两个会杀掉该用户全部会话进程。
case "$UNIT" in
  user@*.service|init.scope|user.slice|*.slice|*.target|*.mount)
    die "目标 $UNIT 属于「会涵盖整个用户会话」的单元类型，拒绝作为清扫目标" ;;
esac

cg_rel=$(systemctl --user show -p ControlGroup --value "$UNIT" 2>/dev/null | tr -d '[:space:]')
if [[ -z $cg_rel ]]; then
  log "ControlGroup 为空（单元从未起过或已彻底清理）—— 无可清扫对象"
  exit 0
fi
[[ $cg_rel == /* ]] || die "ControlGroup 不是绝对路径：$cg_rel"

CG="${CG_ROOT_DEFAULT}${cg_rel}"

# 闸门 1：路径必须仍在「本用户 user@<uid>.service」之下，且最后一级 == 单元名。
# 这一步挡掉的是「解析出了 user.slice / user@uid.service 之类的父级」这种最危险的误配。
case "$CG" in
  "$CG_ROOT_DEFAULT"/user.slice/user-[0-9]*/user@[0-9]*.service/*) : ;;
  *) die "ControlGroup 不在 user@<uid>.service 之下，疑似解析异常：$CG" ;;
esac
cg_leaf="${CG##*/}"
[[ $cg_leaf == "$UNIT" ]] || die "ControlGroup 末级（$cg_leaf）与目标单元名（$UNIT）不一致，拒绝清扫：$CG"
[[ $cg_leaf == *.service ]] || die "目标单元末级不是 .service：$cg_leaf"
[[ -d $CG ]] || { log "cgroup 目录不存在（$CG）—— 无可清扫对象"; exit 0; }

# 闸门 5：单元还活着就不要真杀（除非 --force）
active_state=$(systemctl --user show -p ActiveState --value "$UNIT" 2>/dev/null | tr -d '[:space:]')
main_pid=$(systemctl --user show -p MainPID --value "$UNIT" 2>/dev/null | tr -d '[:space:]')
[[ -n $main_pid ]] || main_pid=0
if [[ $MODE == kill && $FORCE -eq 0 && $active_state == active && $main_pid != 0 ]]; then
  die "单元当前 active（MainPID=$main_pid），真杀会打掉在飞 job；确认无 job 后再 --force（或走 restart 由 ExecStartPre 自动清扫）"
fi

self_pid=$$
my_uid=$(id -u)

# 祖先链（含自身）。用于：(i) 把自己和上级 shell 排除；(ii) 判断候选是否自己的后代。
ancestors_of() {
  local p="$1" guard=0
  while [[ $p =~ ^[0-9]+$ ]] && (( p > 0 )) && (( guard < 64 )); do
    printf '%s\n' "$p"
    p=$(awk '/^PPid:/{print $2}' "/proc/$p/status" 2>/dev/null) || return 0
    [[ -n $p ]] || return 0
    guard=$((guard + 1))
  done
}

self_chain="$(ancestors_of "$self_pid" | tr '\n' ' ')"

is_self_or_ancestor() {
  case " $self_chain " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# 候选是否是我的后代（我 fork 出来的 helper 也在本 cgroup 里，必须放过）
is_my_descendant() {
  local p="$1"
  while [[ $p =~ ^[0-9]+$ ]] && (( p > 1 )); do
    [[ $p == "$self_pid" ]] && return 0
    p=$(awk '/^PPid:/{print $2}' "/proc/$p/status" 2>/dev/null) || return 1
    [[ -n $p ]] || return 1
  done
  return 1
}

# 枚举：本单元 cgroup 子树里所有 cgroup.procs（v2 的「无内部进程」规则下进程都在叶子 cgroup，
# 所以整棵子树都要看，而不只是单元自身那一级）。
pids_file=$(mktemp) || die "mktemp 失败"
trap 'rm -f "$pids_file"' EXIT
find "$CG" -name cgroup.procs -exec cat {} + 2>/dev/null | sort -un > "$pids_file"

total=$(wc -l < "$pids_file" | tr -d '[:space:]')
log "unit=$UNIT mode=$MODE force=$FORCE cgroup=$cg_rel active=$active_state MainPID=$main_pid 候选 pid 数=$total"

# 对活单元干跑时，下面这些 WOULD-KILL 指的是「当前这一代」的 helper/listener，而不是孤儿。
# 它们之所以在真正的 ExecStartPre 时刻可以被杀，是因为那一刻本次 ExecStart 还没起，
# cgroup 里任何活着的东西都必然是上一代留下的。这里提示一句，免得看日志的人误读。
if [[ $MODE == dry-run && $active_state == active && $main_pid != 0 ]]; then
  log "NOTE: 单元正在运行 —— 下面的 WOULD-KILL 是**当前存活会话**的清单（本次干跑不会动它们）；"
  log "      在真正的 ExecStartPre 时刻，本次 ExecStart 尚未启动，同样的清单即为上一代孤儿。"
  log "      想只看真孤儿：先确认空闲再对 stopped 状态的单元干跑，或用 systemctl show -p MainPID 判读。"
fi

if [[ -z $total || $total == 0 ]]; then
  log "cgroup 内无进程 —— 无需清扫"
  exit 0
fi

killed=0 skipped=0 foreign=0 failed=0
for pid in $(cat "$pids_file"); do
  [[ $pid =~ ^[0-9]+$ ]] || continue
  st="/proc/$pid/status"
  if [[ ! -r $st ]]; then
    skipped=$((skipped + 1)); continue          # 枚举后自然退出的竞态，忽略
  fi
  if is_self_or_ancestor "$pid" || is_my_descendant "$pid"; then
    log "keep  pid=$pid 清扫进程自身/祖先/后代（ExecStartPre 就跑在本单元 cgroup 内）"
    skipped=$((skipped + 1)); continue
  fi

  # 单元自己的 MainPID 属于「本次启动」而不是孤儿，任何情况下都不动（保守项）
  if [[ $main_pid != 0 && $pid == "$main_pid" ]]; then
    log "keep  pid=$pid 是本单元 MainPID（非孤儿）"
    skipped=$((skipped + 1)); continue
  fi

  pid_uid=$(awk '/^Uid:/{print $2}' "$st" 2>/dev/null)
  comm=$(cat "/proc/$pid/comm" 2>/dev/null | tr -d '\n')
  args=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | sed 's/[[:space:]]+$//')
  pcgroup=$(awk -F'::' '{print $2}' "/proc/$pid/cgroup" 2>/dev/null)

  # 二次确认归属：/proc/<pid>/cgroup 必须仍指向我锁定的这棵子树
  case "$pcgroup" in
    "$cg_rel"|"$cg_rel"/*) : ;;
    *) log "skip  pid=$pid comm=${comm:-?} 已不在本单元 cgroup（$pcgroup）"
       skipped=$((skipped + 1)); continue ;;
  esac

  if [[ -n $pid_uid && $pid_uid != "$my_uid" ]]; then
    log "DENY  pid=$pid comm=${comm:-?} uid=$pid_uid != euid=$my_uid（只记录不杀）"
    foreign=$((foreign + 1)); continue
  fi

  if [[ $MODE == dry-run ]]; then
    log "WOULD-KILL pid=$pid ppid=$(awk '/^PPid:/{print $2}' "$st" 2>/dev/null) comm=${comm:-?} uid=${pid_uid:-?} args=${args:-<empty>}"
    skipped=$((skipped + 1))
    continue
  fi

  if kill -9 "$pid" 2>/dev/null; then
    killed=$((killed + 1))
    log "KILLED pid=$pid comm=${comm:-?} uid=${pid_uid:-?} args=${args:-<empty>}"
  else
    failed=$((failed + 1))
    log "miss  pid=$pid comm=${comm:-?} kill -9 失败（多为已退出的竞态），不视为错误"
  fi
done

# 复核：清扫后再数一次「真正的外来残留」。计数必须排除清扫进程自身及其祖先后代，
# 否则会把自己在 cgroup 里 fork 出的瞬时 helper 也算成残留（journal 里会误导）。
live_nonself() {
  local n=0 p
  for p in $(find "$CG" -name cgroup.procs -exec cat {} + 2>/dev/null | sort -un); do
    [[ $p =~ ^[0-9]+$ ]] || continue
    [[ -r "/proc/$p/status" ]] || continue
    is_self_or_ancestor "$p" && continue
    is_my_descendant "$p" && continue
    [[ $main_pid != 0 && $p == "$main_pid" ]] && continue
    n=$((n + 1))
  done
  printf '%s' "$n"
}

left=$(live_nonself)
log "summary mode=$MODE 候选=$total 实杀=$killed 保留/跳过=$skipped 他uid拒绝=$foreign 失败=$failed 残留(不含清扫进程自身树)=$left"
exit 0
