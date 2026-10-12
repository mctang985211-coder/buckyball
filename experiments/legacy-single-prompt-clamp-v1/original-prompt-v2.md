请自主执行一次独立的 Buckyball 旧版单 Prompt 自动生成 chip 实验，从本条需求完成环境准备、设计、实现、注册、构建、验证、综合/PPA 报告和个人 fork PR 交付。

实验标识：`legacy-single-prompt-clamp-v1`；执行提示词版本：v2。
新 Ball：`ClampBall`，目录 `examples/balls/clamp/`。
新 chip：`legacy_clamp_v1`。
架构：单 tile、单个 Pebble core 架构实例。
主会话、子 agent 和 CI 验证使用 GPT-6.1 Sol，并记录实际模型与 provider。

## 1. 无人值守、自主性与授权

用户接下来约 9–10 小时不监管。本条已授权本实验必要的调查、工程选择、旧插件适配、依赖准备、构建、仿真、综合、PPA 测量、个人 fork 推送和新 PR 创建，以及全实验最多一张已有重置券的兑换。无需用户预先编写 multi-agent 分工。

除涉及重要问题或变更已规定方向外，禁止因常规问题停止并向用户提问。文件命名、配置接线、模板选择、合法编码选择、缺失指导补齐、构建错误修复、测试组织、普通依赖和路径问题，均根据真实仓库与日志自主处理，记录决定和依据，继续执行。

只有下列情况需要用户决定：必须改变功能语义、Ball 组合、单核拓扑、旧流程优先原则或验收标准；必须使用第二张券、购买额度、切换到额外付费服务；必须向上游仓库写入、合并 PR 或执行未授权的重大破坏性操作；出现用户无法从当前授权中判断的重大问题。提问时说明事实、已尝试措施、影响与必须由用户决定的选项，并继续不依赖答案的工作。

普通环境阻塞先诊断、修复或重试。确实无法自行解除的凭据、网络、许可证、平台审批或硬资源阻塞，保存原始证据与恢复点，继续其他可执行阶段；全部可执行工作完成后仍被堵住，则明确交付未完成状态，不伪造通过，不无限空转等待用户。

预授权不能绕过系统强制审批。启动长运行前检查所需权限是否可用；不通过改工具、换账号或放宽权限绕过拒绝。保持简明进度更新，但不要以反复总结、询问“是否继续”或计划草案代替实际执行。任务完成可以提前交付；9–10 小时是无人值守时段，不要求跑满，也不自动构成放弃未完成工作的期限。

## 2. 工作区与流程优先级

工作区：`/home/ROXY/code/bb_work`。
Buckyball：`/home/ROXY/code/bb_work/buckyball`。
旧插件：`/home/ROXY/code/bb_work/legacy-harness-plugins`。
当前 Harness：`/home/ROXY/code/bb_work/harness`。
上游 Harness：`/home/ROXY/code/deepseek-harness`。

遵守适用的 AGENTS.md。本条需求优先；其他指导冲突时遵循旧插件流程。旧流程缺失的工程指导参考新版 skills；仍缺失的根据工程经验补齐，标明补齐内容、依据与适用范围，不假装文件、工具或技能存在。

先读旧 `chip-designer`、`ball-designer`、`verify-runner` 的提示词、入口、依赖和事件路由，核对阶段、清单和交付接口。插件文件夹本身不是可执行命令。

新版补充来源：
- `buckyball/.agents/skills/{ball-align,chip-designer,check,verify,waveform}/SKILL.md`。
- `harness/.agents/skills/{bb-build-task,bb-ball-task,bb-chip-task,bb-bemu-task,bb-verilator-task,bb-obligations}/SKILL.md`。

新版编排不能替换旧流程的角色与正式 CI 验收路径。MCP 可作为验证执行者的工具接口。用户明确要求独立新 chip，不因新版“现有 chip 够用就复用”的建议取消此目标。

记录基线提交、子模块版本、已有未提交修改与必要未跟踪依赖。建立独立实验检出或等效隔离环境，确保最终被验证的提交含有所需源码。允许必要的旧插件构建、挂载、路径和事件接线修复，保存补丁与说明。不把凭据、无关历史修改和庞大构建产物混入实验提交。不改主线 framework，不启动方法自演化或其他模型实验。

## 3. Chip 与已有 Ball

复用 Pebble core 架构，不新造处理器 core。为实验建立独立的 core 配置/balldomain 与 chip 配置。保持所复用 core 的内存几何与接口合同，核对真实配置后冻结契约。

本 chip 包含 8 个 Ball：`TransposeBall`、`SMatMulBall`、`Im2colBall`、`ToInt8Ball`、`Int2FpBall`、`MatAddBall`、`TraceBall`、新 `ClampBall`。

保留已有 Ball 功能和 ISA 语义，按实验注册域规范安排 ballId，不修改其他注册域。不直接带入 Pebble 默认表中与本实验无关的 Ball。核对端口、SRAM 通道、注册与编译器聚合能支持该组合，配置修正限定在必要接线范围。

补全 chip 配置、Scala 配置类、仿真类、workload、回归清单和 tapeout 配置，名称与路径一致。生成配置由实际安装流程产生，不手改生成物。

## 4. Clamp 功能契约

INT32 向量逐元素执行 `y[i] = min(max(x[i], lo), hi)`。lo、hi 为有符号 INT32，要求 lo <= hi，允许相等。结果逐元素精确一致，无浮点、无误差容限；未越界元素保持不变。

输入、输出各占一个已分配的单 group bank，二者互异。128 位一行，含 4 个 INT32。N 为正且是 4 的倍数，N/4 不超过真实 bank 行数。输出顺序连续，不静默填充、截尾或改布局。

参考 SiLU 的 bank/N 编码与 Relu、MatAdd 的读写实现。优先复用现有 rs1 bank/iter 解码；rs2 低、高 32 位分别表示 lo、hi。先与当前公共解码器核对完整 ISA 编码，写入契约后再实现。`inBW=1`、`outBW=1`，使用既有 Bank、命令和完成握手协议，不引入新总线或内部 SRAM。

非法输入至少覆盖 lo>hi、N=0、非4倍数、超容量、bank越界、未分配、非单group、输入输出别名、最终编码中保留字段非零。编译器拒绝可静态判定的非法参数；BEMU 与 RTL 对各自可观察条件明确失败，不软默认或静默恢复。

## 5. 编码、实现与注册

先盘点目标注册域、全仓 ISA 占用和框架保留值。新 ballId 按目标域合法递增分配；新 funct7 选择合法、未占用且不在保留区的递增值，不从旧文档猜测空闲编码，不重新分配已有 Ball 的 funct7。

完成：功能/ISA/布局/非法输入契约；C测试及独立expected；BEMU `execute_known`、`cycles_after_issue`；Chisel RTL与wrapper；Ball TOML、ISA wrapper；compiler dialect、lowering/export及MLIR测试；core注册与编译器聚合；chip回归清单。

编码使用项目生成链，不维护另一份手写编码真值。Chisel 版本以实际构建文件为准；现有参考检出为6.7.0，不照抄早期prompt中的6.5.0。

检查 ballNum、ballIdMappings、ballISA、ballClass、bid引用、inBW/outBW、路径及重复 ballId/funct7。旧 audit 可用时调用；缺失时建立等效真实静态检查并留证。明确所复用 Ball 原有证据与本次实验新证据的区别。

## 6. 旧流程与验证

按旧职责自主组织 chip lead、Ball 实现与独立验证。宿主支持子agent时可以委派，明确文件职责、交接及真实依赖；单Prompt不禁止子agent。缺少能力时记录差异，不伪称委派成功。子agent不得改他人工作或独立兑换重置券。

保留 Ball `c-bemu→rtl` 和 chip `skeleton→slices→integrate` 阶段及适用门禁。单核不要求模型图切分；不适用阶段说明理由。workload为算子及组合小测试，不要求下载或运行完整大模型。

正式验收走旧个人fork CI派发与报告回流。参考 `verify-runner/scripts/ci-dispatch.mjs`，以及本地 `fork/main` 中的 `.github/workflows/bb-verify.yml`、`.github/scripts/bb-verify/`。先核对远端实际部署或可获得的快照、ref/sha/layer、manifest、状态和artifact接口。旧PR-number YAML不能直接配ref/sha客户端。

每轮一份真实清单，注明stage、phase、chip、stem与预期。派发成功仅为受理，不带 `--wait`；按 `--fetch` 等待终态：0 PASS、1 FAIL、2 INFRA、3仍在运行。FAIL根据证据修复重派；INFRA先修环境。不要反复派发同一运行，不把本地诊断或基础设施冒烟PASS当正式功能通过。

沿用所选Ball/core/chip已有且适用的验收：Clamp小测试、边界值、容量、负例、C/BEMU与RTL一致性、MLIR路径、已有Ball回归，以及至少一个MatAdd→Clamp真实组合输出比较。负例单独判定预期失败，不加入“全部应通过”的普通列表。容量测试优先BEMU；RTL用小用例，波形限于具体诊断。

构建与仿真取得真实终态，保存日志、退出码、版本、提交SHA。走已有bbdev入口；异步MCP按trace_id在同一服务实例中查询到终态。配置安装用项目真实支持的入口。

核对主会话、子agent和CI verifier实际模型/provider，不因主会话选了GPT-6.1 Sol就假设CI配置正确。不得静默改为DeepSeek或额外付费API。

## 7. 综合与 PPA

功能验收后，对本实验完整chip运行现有综合/PPA流程。不要求优化或面积、功耗上限，不要求布局布线或流片签核。

参考 Pebble 的 `tapeout/config.toml`、`area/dc.tcl`、`area/constraints.sdc`、`power/power.tcl`、`power_sim.sh`。新chip顶层、路径、工艺库、SRAM、活动采样正确。参考目标100MHz；报告真实时序，不把目标频率当已达成频率。

交付综合面积与层级面积；时序报告、约束、slack及违规；功耗报告及工具、工艺角、电压温度、活动来源、采样窗口和覆盖范围，区分可取得的动态、漏电等分项。

功耗活动覆盖真实Clamp workload，不套用没有执行活动的采样窗口。功耗流程自身必需的门级活动仿真属于本实验；不因PPA开启无关大模型、FPGA或长时间UVM任务。

缺工具、许可证、库或活动证据时标明缺口与未完成状态，不用手写数字或generic gates冒充工艺PPA。保存报告、网表、命令与产物索引。

## 8. 个人 fork PR

只向 `mctang985211-coder/buckyball` 的 `main` 创建一个新实验PR。禁止向 `DangoSys/buckyball` 或其他上游写入/创建PR。新分支为 `exp/legacy-single-prompt-clamp-v1-<时间戳>`，不续用旧PR。

优先复用VSCode已有GitHub登录，核对CLI真实身份和目标fork写权限，不输出或提交凭据。创建PR显式指定 `--repo`、`--base`、`--head`，不依赖自动选择。

标题：`[Legacy experiment] 单Prompt生成Clamp Ball与单核chip v1`。
正文明确这是独立旧流程实验，说明模型、基线、8个Ball、流程适配、新版指导/经验补齐、实际测试、PPA、失败与未完成项。源码和配置完成并提交后创建PR，不自动合并。认证/网络堵塞时保留本地提交与PR正文草稿，不换目标仓库。

## 9. 最多一张重置券

用户明确授权：本次完整实验最多消耗一张当前账号已有的可用重置券，无需再次询问。额度供主会话、子agent和CI共享；限制是全实验一张，不是每个会话一张。不得购买额度、使用第二张券或切换额外付费API。

本机Codex 0.155.1导出的app-server协议含：
- `account/rateLimits/read`：只读查询额度及可用券。
- `account/rateLimitResetCredit/consume`：兑换，参数 `idempotencyKey`，可选 `creditId`。
- 返回 `outcome`：`reset`、`nothingToReset`、`noCredit`、`alreadyRedeemed`。

这是本机接口检查结果，尚未进行实际兑换验证；执行前重新核对当前版本、认证、券状态和资格，不把历史“有两张券”当实时状态。

启动长运行前准备额度监控和恢复方案。主控统一管理，子agent不得兑换。必要时建立不依赖模型新一轮推理的宿主监控，以便模型调用受限时仍能查询额度、按授权兑换和恢复运行；只用当前版本支持的正式接口，不修改账户或客户端内部数据库来伪造额度。

启动时查询，模型活动期间周期查询。周或短时余量<=5%时加强检查、保存checkpoint；这只是本实验监控阈值，不代表后台必然允许兑换。确认需要且后端允许时使用一张适用券，优先选最早到期的一张。无需为了测试接口提前兑换。

兑换前在实验账本持久化选定creditId、唯一UUID形式idempotencyKey、当前状态与时间。采用锁或等效单执行者机制。全实验的网络重试只能使用同一creditId和同一idempotencyKey，禁止生成新key或换第二张券。

`reset`视为本次额度恢复；`alreadyRedeemed`只表示该key此前成功，核对账本与实时状态，不能当作又获得一次恢复。`nothingToReset`表示当前不具备重置资格，不宣称成功；继续只读监控，仍仅允许同一逻辑兑换。`noCredit`、认证失败或网络失败先核对状态，未知结果不能通过另兑一张来“保险”。

成功后更新账本，核对额度及券状态，关闭后续兑换权限，继续任务。日志记录时间、券类型/状态、额度前后、返回值及重试次数，不记录凭据。

若当前宿主无法执行兑换或自动恢复，留下准确阻塞与恢复点，不声称已用券。额度和宿主权限无法由prompt本身保证；一张券也不保证足够完成所有工作。必要时在授权范围内等待自然恢复或继续无需模型调用的已授权任务，禁止因余额不足购买额度。最终报告说明兑换成功/未使用/状态不确定及原因。

## 10. Token、耗时与恢复记录

从本次执行开始记录开始/结束时间、阶段耗时，覆盖准备、设计、实现、修复、CI排队/运行、PPA和PR。总耗时用墙钟，不把并行阶段相加冒充墙钟。时间注明UTC或Asia/Shanghai。

统计主会话、子agent、CI verifier、重试和压缩调用，使用宿主/框架真实usage，按session/run/request去重；不要重复累加累计快照。分别报告输入、输出、缓存、推理字段，标明子集关系，避免重复计入总token。

统计仅限本实验，已有调查与其他实验不混入。缺少某部分时标“不可获得/部分统计”，不从文本长度、Plus百分比或模型自述伪造总量。token不等同Plus额度。报告各阶段/会话模型与usage来源。

每个重要阶段和额度告警保存checkpoint，包含当前提交、未提交补丁、进行中的CI/trace_id、已完成证据、下一步。恢复时读取记录并续接，不重复运行已完成且产物未变的昂贵任务，不漏计重试成本。

## 11. 最终交付

交付原始prompt、环境/版本清单、功能/ISA契约、源码/配置/注册、阶段清单、测试证据、PPA报告、提交SHA、个人fork PR或草稿。

输出 `experiment-summary.json` 与 `experiment-report.md`，至少包含：各阶段状态、失败和阻塞；最终8个Ball/拓扑/bank几何/编码/变更；功能、性能和PPA结果及证据范围；旧流程修复、新版skill参考、经验补齐与偏离；实际模型/provider；总token、分项和完整性；起止时间、总墙钟与阶段耗时；重置券状态与兑换记录；个人fork PR；未完成项与恢复办法。

自主完成已授权工程，不停在方案、提案或skeleton。无法完成的部分保留真实证据，不降低判据或伪造PASS。

## 参考来源

- 旧角色与阶段：`legacy-harness-plugins/chip-designer/src/prompts/{core,0.2-design-hints}.prompts.ts`、`ball-designer/src/prompts/{0-hints,1.0-audit-accept}.prompts.ts`。
- 旧派发：`legacy-harness-plugins/verify-runner/scripts/ci-dispatch.mjs`；Buckyball本地`fork/main`工作流快照。
- 工程方法：第2节所列Buckyball/Harness skills；已有Relu、MatAdd、SiLU和Pebble实现。
- 根prompt写法：用户提供的早期ColNormBall需求。相关旧conductor及handoff协议未确认存在，不作为硬依赖。
- 重置接口：当前安装Codex导出的schema及`/home/ROXY/code/ref/codex/codex-rs/app-server/src/request_processors/account_processor/rate_limit_resets.rs`。运行时重新确认接口与资格。
