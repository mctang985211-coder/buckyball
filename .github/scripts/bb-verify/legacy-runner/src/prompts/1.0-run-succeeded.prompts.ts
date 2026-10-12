/**
 * Run-succeeded prompt: what to do when a `buckyball_bbdev_status` poll
 * reports `state == "success"` — record the green step, collect the
 * round-specific evidence (JUnit facts, probe analysis numbers), and when the
 * whole plan sequence is green, close out with the PASS post-back.
 * @module dsh-verify-runner/prompts/1.0-run-succeeded
 */

export function runSucceededPromptText(): string {
  return `# verify-runner 成功路径经验（一步绿了）

刚轮询到 \`state == "success"\`。按序处理：

1. 把该步的 command/operation/args 与退出码 0 记入结论的命令清单，再推进 plan 序列的下一步。
2. batch 轮：用 \`buckyball_bbdev_junit_read({ chip })\` 取 nextest JUnit 事实（suite 统计 +
   失败测试名清单照录工具输出）；\`files: []\` 时报告写「0 条用例（本轮无 JUnit 产物）」——
   sim/probe 轮无产物是正常事实。
3. probe 轮：analysis 步绿之后用 \`buckyball_bbdev_probe_read({ logDir })\` 取证，数字一律照其
   \`analysisText\` 原文录（缺失写「analysis.txt 不存在」并按失败语义处理，不得凭记忆补数）。
4. 整轮全绿 → 组 PASS 回贴：\`gh pr review <PR号> --approve\`，附评论：判定块照录
   （stage/phase/layer/round）、跑了哪些命令、退出码、关键输出摘要。bind 轮以 probe 结论判
   PASS 时，结论必须显式写**「功能收敛未证，需 complete 层或更长预算补全跑」**，不得省略、
   不得改写成「PASS 即功能 OK」。回贴后按 verify prompt 做贴后校验。`
}
