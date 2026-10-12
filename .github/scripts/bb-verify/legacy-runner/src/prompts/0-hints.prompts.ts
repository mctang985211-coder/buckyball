/**
 * Hints prompt: success-path execution guidance, injected after
 * `buckyball_bbdev_plan` returns the command sequence — the moment the agent
 * is about to execute. Carries skill discovery (upstream style: skills are
 * repo-maintained via the `.dsh/skills` submodule and are loaded with
 * `skill({ name })`; their content is never embedded here) and the tool
 * discipline of the execution phase.
 * @module dsh-verify-runner/prompts/0-hints
 */

export function hintsPromptText(): string {
  return `# verify-runner hints

命令序列已由 \`buckyball_bbdev_plan\` 生成。开始执行前，先完成知识加载，再按下面的纪律执行。

## 技能发现（先于一切执行）

1. 列出可用的 skills（\`.agents/skills\` 目录，形态为 \`<name>/SKILL.md\` 目录或 \`<name>.md\` 文件；
   由仓库侧的 skills 子模块维护，内容不在本 prompt 复述）。
2. 读每个 skill 的 frontmatter \`description\` / \`whenToUse\`；命中本任务主题的，调
   \`skill({ name: "<exact-name>" })\` 并遵循它。
3. 两个必查项：执行前调 skill \`ci-verification-guide\`（命令序列生成规则、probe 轮机制、回贴与
   证据行格式、白名单设计理由、NDJSON 事件格式——执行到对应环节按 skill 规则办）；查 buckyball
   仓库事实调 skill \`bb-knowledge\`（按检索配方在 $BB 活树现查 check.yaml 结构、绑定布局、batch
   toml 落点等，不引用行号与 pin，不凭记忆写数值）。

## 工具纪律（硬约束）

- 命令生成的唯一入口是 \`buckyball_bbdev_plan({ stage, phase, layer, chip, stems, models, probes,
  probeBudget, perf, compilerTouched })\`：返回 \`{steps, skippedLanes, skippedProbes}\`，\`steps\` 是
  有序 \`{command, operation, args}\` 列表，逐项喂给 submit，不得手工拼装、增删或改写命令；生成规则
  见 ci-verification-guide，不在此复述。
- \`skippedLanes\`（\`{lane, toml, reason}\`）= 实物缺失被裁剪的 lane，结论照录，不算失败。
  \`skippedProbes\` = 声明了却没落成 probe 成对步骤的 probe（\`{stem, minutes?, reason}\`），照录不算
  失败——它是「这条取证本轮没跑」的事实记录，不得当成跑了、更不得拿缺失去编性能结论。
- \`probes\` 直接取 \`[manifest]\` 的 probe 声明（\`[{stem, minutes}]\`）——probe 步骤由 plan 成对
  生成，不在会话里拼；\`perf\` / \`compilerTouched\` 同理照录注入值。\`models\` 照录 \`[manifest]\`
  注入的 models=（采集口径：只认「整行只有一个 \`--model <模型键>\`」的声明行 \`MODEL_DECL\`，
  一个模型一行；命令行 fence 与散文提及都不算声明）。不得从 PR body 文字自行凑 models；报告
  正文谈模型就写模型名，别让 flag 词形顶到行首——不合声明形态的行会被清单语法门点名成 PRE-FAIL。
- probe 轮 log-dir 回填（命令唯一入口的执行细则）：plan 为每个 probe stem 生成成对两步——
  \`bebop-bemu --sim … --pk --itrace --mtrace\` 与 \`bebop-bemu --analysis '--chip <c> --log-dir
  <PROBE-LOG-DIR:<stem>> --itrace --mtrace'\`。第二步的占位符：第 1 步 status 到终态（success 或
  budget 到点的 cancelled）后，用 \`buckyball_bbdev_probe_logdir({chip, stem, simStartedAt})\` 取回
  本轮唯一绝对路径，只替换该占位符后 submit——不得手工 glob、不得整条重写 analysis 命令（占位符
  未回填会被 submit 拒绝，probe_logdir 零候选／多候选会抛错，届时按对应失败处置 prompt 办）。
- 触达 bbdev 只有三件套：\`buckyball_bbdev_submit\`（提交即返回 taskId/logPath/pid）、
  \`buckyball_bbdev_status\`（state/exitCode/日志尾部）、\`buckyball_bbdev_cancel\`（进程组
  SIGTERM，约 5s 后升级 SIGKILL）。
- 只读取证工具：
  - \`buckyball_bbdev_probe_logdir({ chip, stem, simStartedAt })\`：analysis 步骤 \`--log-dir\` 的
    **唯一**定位入口（只读）——按 \`*-<chip>-*-bemu-<stem>\` 匹配 \`$BB/log/\` 下的目录，剔掉 mtime
    不晚于 \`simStartedAt\` 的更早轮次遗留；恰好唯一候选才返回 \`{logDir, mtime}\`，零候选与多候选
    歧义**都直接抛错**并列出全部候选 + mtime。它不取最新、不兜底，所以回填只能取它的返回值；它
    抛错就是「本轮 log-dir 没跑出来」的事实，按 FAIL 归因，不得改用手工 glob；
  - \`buckyball_bbdev_junit_read({ chip })\`：batch 轮 nextest JUnit 事实（suite 统计 + 失败测试名
    清单），三形态落点全探，每个文件带 mtime 供与本轮对时；无产物时如实返回 \`files: []\`；
  - \`buckyball_bbdev_probe_read({ logDir })\`：bdb.ndjson 元数据（字节数、**mtime（与本轮次对时**——它
    报的是取证产物自身的时间，log-dir 取哪个不由它决定，见上一条）、行数、itrace 事件数、
    mvin/mvout 事件数），附 \`analysisText\`（\`<log-dir>/analysis.txt\` 原文，缺失 \`null\` +
    \`analysisNote\` 注明）；大文件流式统计，不整读。
- 禁止直接运行 bbdev / verilator / mill / cmake / cargo / nextest 等任何构建或仿真命令。
- args 必须是完整的一个字符串（如 "--chip toy --test elf-tests --clean-before"），由 bbdev
  内部 shlex 解析。唯一例外是 args-free 操作 \`config install\`（上游该 op 是布尔开关）：
  必须省略 args，带子参数会被工具直接拒绝。
- 白名单外的命令会被工具拒绝（firesim / bebop-p2e / ip（op generate|replace）/ uvm / yosys / dc 及
  旧 verilator/vcs 均不开放；kernel 仅开放 build，且 plan 只为上游 kernel 车道认识的模型——
  \`KERNEL_MODELS\`，plan 时从 $BB/bbdev 源码实读——生成这步，其余模型 \`kernel --build\` 必报
  unknown kernel model，plan 跳过并在该模型 workload 步骤 note 里写明理由）。开放/关闭的完整
  设计论证见 ci-verification-guide 白名单节，此处不重述。
- submit 后用 status 轮询（建议间隔 30s+；RTL 构建与全量回归可达数十分钟，耐心等待）。
  **只有 state == "success" 才允许进入下一步**；failed/cancelled 或 status 抛错都不算过。
- 串行语义分两层：**同 chip 串行 = 工具级守卫**——同一 chip 已有运行中任务时 submit 直接抛错，
  先 status 取前一个任务的终态再重试；**跨 chip 互斥 = CI 作业级**——由 workflow 的
  \`concurrency\` 组 + 持久化根 flock 承担，本工具不做跨 chip 判定。

## probe 轮（性能探针）

probe 轮回答「慢在哪」，不回答「对不对」：功能门禁语义不变，probe 只产出性能证据，不参与
PASS/FAIL 裁决（probe 流程本身失败除外，按失败处置 prompt 的分级语义记 FAIL）。适用对象：bind
轮的模型 stem、证据清单声明了 \`probe: <stem> <分钟>\` 的 stem；轻量算子 stem 照旧全跑。probe 行
的相位白名单（\`c-bemu\` / \`bind\` / 无 phase 带 models）与「其余相位 plan 无 probe 步骤」的机制见
ci-verification-guide；清单在那些相位声明 \`probe:\` 已被 \`[manifest]\` 判 PRE-FAIL（判定块消费
第 2 条），会话不会看到它们。plan 返回非空 \`skippedProbes\` 时照录其 reason，不得当跑过。

职责边界：probe 机制——截断运行、trace 采集、analysis、预算执行、结果呈现——全部归本
verifier；「改哪里」的优化决策归 coding 插件。迭代闭环是跨 PR 轮次的 Ping-Pong：单轮只跑
一次 probe、贴一次数据，**绝不自动多轮迭代**。probe PASS 只回答「通路通 + 数据拿到」。
流程（严格按序，不允许变体；每步经三件套 submit）：

1. 按 bbdev_plan 生成的 probe 步骤 submit（\`bebop-bemu --sim\`，带 \`--pk --itrace --mtrace\`）；
2. 按 budget 轮询 status（缺省 3 分钟；\`probe: <stem> <分钟>\` 可覆盖），到点未结束 →
   \`buckyball_bbdev_cancel\`（SIGTERM→约 5s→SIGKILL）。**budget 到点的 cancelled 属预期，不按
   失败处理**；
3. \`bebop-bemu --analysis '--chip <c> --log-dir <第 1 步 log-dir 绝对路径> --itrace --mtrace'\`
   submit（log-dir 取法见「工具纪律」的 log-dir 回填条）；
4. 回贴证据段：已跑周期数、funct 周期占比 Top-5、mtrace 占用率，加**一行机器可读取证行**（下一轮的
   \`[perf-gate]\` 靠它检索对照数；四种合法形态、零事件哨兵字面量、一轮一仪器、行首装饰容忍边界
   见 ci-verification-guide——拼写主体不得改，写成 \`周期数=\` / \`probe_evidence:\` 一律按「本轮
   证据未交付」处理；只有散文没有取证行 = 证据未交付）。`
}
