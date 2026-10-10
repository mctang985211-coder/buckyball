/**
 * Input-rejected prompt: `buckyball_bbdev_plan` or `buckyball_bbdev_submit`
 * threw — the call itself was rejected (bad plan input, whitelist violation,
 * args-free operation given args, unbackfilled placeholder, same-chip
 * conflict), or the environment could not launch bbdev at all. Call-shape
 * rejections are fixed and retried per the error message; an
 * environment-level failure blocks the whole execution surface and ends the
 * task as FAIL.
 * @module dsh-verify-runner/prompts/1.2-input-rejected
 */

export function inputRejectedPromptText(): string {
  return `## verify-runner 失败处置（plan/submit 拒绝调用）

抛错 = 调用形态问题，按报错修正后重试，不得改跑白名单外的命令绕过：

- plan 参数被驳回（stage/phase/layer/stems/models/probes 形态）→ 对照判定块注入值修正，不自行
  发明取值。
- 白名单外 command/operation → 换用 plan 生成的白名单内步骤；plan 不生成的步骤就是本期不开放。
- \`config install\` 带了 args → 省略 args 重提（该 op 上游是布尔开关）。
- 占位符未回填（\`<PROBE-LOG-DIR:<stem>>\`）→ 先用 \`buckyball_bbdev_probe_logdir\` 取回本轮
  log-dir，只替换该占位符后重提，不得整条重写 analysis 命令。
- 同 chip 已有运行中任务 → 先 status 轮询前一个任务到终态再重提。

报错是环境级（bbdev 不在 PATH、配置的 bbdevRunner 不可用、spawn 失败）→ 执行面不可用，重试无
意义：报错原文记入 FAIL 报告的失败项与疑似归因，按任务失败收尾。`
}
