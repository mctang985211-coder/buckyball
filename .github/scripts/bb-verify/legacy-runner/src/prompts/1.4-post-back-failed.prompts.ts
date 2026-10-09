/**
 * Post-back-failed prompt: the `gh pr review|comment` call failed — the
 * verdict has NOT reached the PR, and a verdict that never lands is a failed
 * task (the CI-side comment-presence gate reds on a missing VERDICT line, so
 * the final answer must carry the failure explicitly).
 * @module dsh-verify-runner/prompts/1.4-post-back-failed
 */

export function postBackFailedPromptText(): string {
  return `## verify-runner 失败处置（gh 回贴失败）

gh 回贴失败即任务失败：gh 不可用或命令失败时，最终回答首行写 \`VERDICT: FAIL\` 并注明「回贴失败」
+ 失败命令与 stderr 原样；CI 侧另有评论在场门禁（comments ∪ reviews 查不到
\`^VERDICT: (PASS|FAIL)\` 即判红）形成双保险。`
}
