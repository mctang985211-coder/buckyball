/**
 * Run-failed prompt: a `buckyball_bbdev_status` poll reported a terminal
 * `failed` — evidence first, then the attribution decision tree,
 * the probe-round graded failure semantics, and the FAIL post-back's four
 * required elements.
 * @module dsh-verify-runner/prompts/1.1-run-failed
 */

export function runFailedPromptText(): string {
  return `## verify-runner 失败处置（运行终态 failed）

1. 先取证再行动：读 status 返回的 logTail，再看 $BB/log/ 下对应时间戳目录里的仿真日志。
   bdb.ndjson 是 NDJSON，每行一个事件对象（形态见 ci-verification-guide；PMCTRACE 不在 bemu
   侧，仅 RTL/verilator 仿真产出）。不要盲目重试。
2. 失败归因入口（决策树，写进 FAIL 报告的「疑似归因」要素；只做入口判断，不做自动根因分析）：
   1) workload build 挂 → 注册/构建系统问题；2) bemu batch 挂 → 语义/集成问题（先修 C/bemu）；
   3) bemu 过而 verilator 挂 → RTL 问题。归因写「疑似」并给出证据（前序命令是否绿、日志关键行）。
3. probe 轮失败语义（事件量以 \`buckyball_bbdev_probe_read\` 输出为准，分级判定，不做降级路径）：
   - bdb.ndjson 零字节/零 itrace 事件（itrace 仅在 ball-op 触发、mtrace 仅在 mvin/mvout；全标量 host
     fallback 形态物理上产空流）时看清单：未声明 ball 落点期望 → 不是失败，空流本身即形态证据，该
     stem 记 PASS，结论注明「零 ball-op：host fallback 形态（probe 仪器不适用）」并附分析器报错原文；
     声明了 ball 落点期望 → 该 stem FAIL，归因「ball 未执行（layout 管线断点）」。**该形态下 analysis
     步骤以 exit 1 收场不另记失败**：上游分析器在 \`--itrace\` 而零事件时按设计抛 \`no itrace events
     in <bdb>\` 并以 1 退出，这条红属上面的零事件分级覆盖，判据仍是清单的 ball 落点期望，不得再叠加
     一条「analysis 失败」的 FAIL。
   - 其余 analysis 步骤失败（含 bdb.ndjson 末行半截解析错、\`itrace span is 0 cycles\`——有事件却算
     不出跨度，属分析器真失败而非零事件形态）→ 该 stem 记 FAIL，归因「probe trace 分析失败」，原样
     贴报错；不重试、不修剪、不静默改跑别的。
   - 判据（写进报告）：模型级 workload 全跑 >20min 是未优化信号；优化前后仿真时长差 10x+。跨轮
     对比按判定块消费第 9 条的分相规则算。
4. FAIL 回贴（\`gh pr comment <PR号>\`）四要素齐全：①失败命令（原样 command/operation/args）
   ②日志 tail（截取关键段）③疑似归因（决策树入口判定 + 证据与前序命令状态）④ nextest JUnit
   事实（\`buckyball_bbdev_junit_read\` 输出照录）。`
}
