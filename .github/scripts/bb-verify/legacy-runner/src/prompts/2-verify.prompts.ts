/**
 * Verify prompt: the post-back / pre-completion checklist, injected after a
 * successful `gh pr review|comment` call — confirm the verdict actually landed
 * on the PR, then close out with the contract-shaped final answer. Also the
 * last guardrail for the report-level hard requirements (verdict block
 * transcription, head sha line, bind-round caveat, evidence-line gate, and
 * what must NOT be judged FAIL).
 * @module dsh-verify-runner/prompts/2-verify
 */

export function verifyPromptText(): string {
  return `# verify-runner verify（回贴已发出，收尾前逐项核对）

宣布完成前跑完这张清单，任何一项不过就先修正再收尾：

1. 贴后校验：\`gh pr view <PR号> --json comments,reviews\` 读 comments ∪ reviews 两面——PASS 报告
   可能落在 review 而非 comment（\`--comments\` 看不见 reviews）。重读确认首行匹配
   \`^VERDICT: (PASS|FAIL)\` 与报告长度；判贴失（截断/丢失）最多重贴 1 次并只记一次事实，在最终
   回答如实报告。
2. 结论首段照录判定块值（stage/phase/layer/round；\`conflict\` 非「无」时照录冲突行），不重新判定。
3. \`head sha: <headRefOid 原值>\` 行在回贴与最终回答各出现一次（40 位十六进制原值，不缩写、
   不改大小写）；缺这行 = 本轮没出过结论。
4. bind 轮以 probe 结论判 PASS 时，结论显式写「功能收敛未证，需 complete 层或更长预算补全跑」。
5. 性能门禁只认两条：probe 取证行（四种合法形态之一、拼写主体未改；只有散文没有取证行 = 证据
   未交付）与同仪器 delta（prev-found=true 时齐全，缺 delta 即该 stem FAIL）。预算不可比 → 写
   「预算不可比，本轮不作性能结论」。
6. 不得判 FAIL 的项：PR 描述缺优化「三段」（根据上轮热点改了什么/预期哪项改善）只在「遗留风险」
   注明——判定块五段没有一段判它，CI 也不读 PR 描述；「三段齐全」同样不得当作性能证据。没有上轮
   probe 证据的优化声明视为无证据，不臆造。
7. 机制描述逐字对照会话证据（session JSONL / 日志原文），拿不准宁可不写。
8. 最终回答第一行 \`VERDICT: PASS\` 或 \`VERDICT: FAIL\`，随后：判定块照录、head sha 行、命令与
   退出码清单、失败项与疑似归因、回贴结果（链接或失败说明）、遗留风险与建议。`
}
