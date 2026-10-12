/**
 * Probe-evidence-missing prompt: `buckyball_bbdev_probe_logdir` or
 * `buckyball_bbdev_probe_read` threw — the round's probe artifact did not
 * materialize (zero log-dir candidates, multi-candidate ambiguity, missing
 * bdb.ndjson). That is a fact about the round, not a call-shape problem: the
 * stem fails with the「probe log-dir 未找到」attribution, and neither the
 * tool nor the session may improvise a path or a number.
 * @module dsh-verify-runner/prompts/1.3-probe-evidence-missing
 */

export function probeEvidenceMissingPromptText(): string {
  return `## verify-runner 失败处置（probe 取证产物缺失）

probe_logdir / probe_read 抛错 = 本轮取证产物没跑出来（零候选、多候选歧义、log-dir 或
bdb.ndjson 不存在），这是事实不是调用形态问题：

1. 该 stem 记 FAIL，归因「probe log-dir 未找到」；报错原文（含工具列出的全部候选 + mtime）
   照录进 FAIL 报告。
2. 不得手工 glob $BB/log/ 兜底、不得取最新目录、不得凭记忆补性能数字——工具不代 pick，会话
   也不许。
3. 唯一例外：报错明指参数形态（chip/stem/simStartedAt 不合法）→ 按报错修正后重试一次；仍抛错
   按上面两条处置。`
}
