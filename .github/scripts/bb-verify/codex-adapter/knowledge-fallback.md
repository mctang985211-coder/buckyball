# Explicit v2 knowledge fallback for the legacy verifier

Authority: `experiments/legacy-single-prompt-clamp-v1/original-prompt-v2.md`, section 2: the user requires old roles and stages; missing old engineering guidance is supplemented by current skills, then documented engineering experience. This supplemental instruction takes precedence over the legacy hints' assumption that two named skills exist. The frozen legacy prompt remains unchanged.

## Discover and record actual sources

Before execution, search the checkout `.agents/skills`, this adapter, `/home/ROXY/code/bb_work/harness/.agents/skills`, and `/home/ROXY/code/deepseek-harness/.agents/skills` for actual `ci-verification-guide` and `bb-knowledge` files. Record each exact file path read, or `absent` after search. Do not pretend a skill tool exists or that invocation succeeded. In this Codex adapter, read actual SKILL.md files using read-only shell tools; reading a file is knowledge loading, not a fake skill invocation.

If an old skill is absent, continue using the following real sources. Ordinary missing guidance alone does not block the authorized round. Report the mapping, missing sources, and limits. Required execution tools and factual artifacts still must exist.

- Checkout `.agents/skills/check/SKILL.md`: registration consistency; inspect actual `bbdev/mcp/tools/validate.py` and chip/core include wiring.
- Checkout `.agents/skills/verify/SKILL.md` and `.agents/skills/ball-align/SKILL.md`: golden ctest semantics, actual MCP build/simulation protocol and fail-hard semantics. Read other relevant descriptions such as chip-designer/waveform only when applicable.
- `/home/ROXY/code/bb_work/harness/.agents/skills/bb-build-task/SKILL.md`: config install is the one CLI operation and precedes builds; actual MCP compiler/workload entrypoints.
- `/home/ROXY/code/bb_work/harness/.agents/skills/bb-bemu-task/SKILL.md`: same-instance trace_id, asynchronous status to terminal, actual workload filename and log evidence.
- `/home/ROXY/code/bb_work/harness/.agents/skills/bb-verilator-task/SKILL.md`: real chip/binary MCP arguments, RTL artifact prerequisites; no invented config parameter.
- `/home/ROXY/code/bb_work/harness/.agents/skills/bb-obligations/SKILL.md`: applicable evidence obligations; this is knowledge, never a replacement stage workflow.

These exact harness paths and filenames were read during preparation. Verify their presence at execution. Names `bb-build`, `bb-bemu`, `bb-verilator` without `-task` are not claimed to exist. If a mapped file is absent, record it and read the actual source contracts below; do not create or modify skills/source/configuration.

## Old guidance replacement by live facts and bounded engineering experience

The following supplements are explicitly engineering guidance, scoped to this experiment's old chip/skeleton + ClampBall/c-bemu (and subsequent admitted slices/rtl). They do not add a new orchestration role or relax any acceptance gate.

1. The sole command plan is the unchanged `buckyball_bbdev_plan` and admitted extension topPlans/childPlans. Keep injected `[stage]`, `[manifest]`, `[binding]`, `[slices-gate]`, `[perf-gate]` unchanged. Newer skills provide protocol knowledge; they do not change stages, order or acceptance. Inspect `legacy-plan.ts` when old guide prose is unavailable.
2. Read live `.github/workflows/check.yaml`, original deterministic `legacy-runner/scripts/{infer-stage,validate-manifest,binding-check,slices-verify,probe-loop-check,manifest}.mjs`, chip regression TOMLs and target config. Resolve facts from this frozen SHA; do not reuse remembered geometry or stage identities.
3. Translate unchanged plan steps only to exact tools returned by MCP list_tools and actual `bbdev/mcp/tools/*.py`. Config install already has host execution evidence. All other build/simulation operations use the admitted MCP, never direct build shell commands. A missing exact execution tool is INFRA.
4. Retain each real submit trace_id in this service and poll `bbdev_task_status` to terminal. Accepted/queued/processing is not PASS. On genuine build/simulation failure, preserve exit/args/SHA/log paths and classify the cause; do not manufacture a successful retry or substitute prewarm output.
5. Five positive stems require real terminal success plus declared golden comparisons. Nine runtime negatives are separate: actual terminal simulation failure with the specified panic/assert and exact host checker match. Twelve MLIR rejects and optional exact C API 4-object/48-reject matrix require actual compiler execution through their admitted host tools. Missing dependencies, unrelated diagnostics, signals, timeout and unavailable evidence do not count as an expected reject.
6. This round makes no probe/perf/RTL claim. If a later phase needs an unavailable old probe evidence tool or exact semantics, report INFRA rather than guessing or weakening that gate. Missing ordinary prose guidance is different from missing execution/evidence capability.

## Truthful final classification

First line may be `VERDICT: PASS`, `VERDICT: FAIL`, or `VERDICT: INFRA`. This authorization overrides the legacy two-value final-answer assumption.

- PASS: every original top gate, independent Ball plan, ordinary positive, admitted negative and compiler matrix has actual matching terminal evidence at the frozen SHA; model/provider/CLI identity is verified.
- FAIL: actual verified source content, semantic comparison, compilation, legal admission or explicit content gate fails with attributable evidence.
- INFRA: authentication/model request fails before actual inference; required tool/service/dependency/evidence is unavailable; transport/runtime failure prevents the gate; actual identity cannot be proven. Record raw cause and incomplete scope. An actual compiler source error is FAIL, whereas missing compiler/header/tool dependency is INFRA. No successful model execution means no functional PASS or unsupported content FAIL claim.

Keep original role, readonly scope, no dispatch/push/credit, and no tracked source edits. Report actual missing guidance and the real fallback read paths without claiming nonexistent skills were invoked.
