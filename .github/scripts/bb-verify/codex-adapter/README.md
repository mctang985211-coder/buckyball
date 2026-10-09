# Legacy Codex CI adapter

Required adaptation for this authorized personal-fork experiment only. Original deterministic stage/manifest/binding/slices/perf scripts and verdict/status/artifact contracts are retained. Original plan body is extracted without behavioral changes into legacy-plan.ts for Node24 native TypeScript execution. Original prompts are retained in legacy-runner/src/prompts and rendered into legacy-prompts.md. DSH event prompts become conditional static guidance; this is an explicit event-routing adaptation, not an assertion that Codex supports DSH events.

Official codex-cli 0.155.1 supports --ignore-user-config (verified in local exec --help). Existing ChatGPT login is used with requested gpt-6.1-sol and provider openai. No DeepSeek, relay or paid API key is used. The host preserves JSONL events, exact final report, CLI exitCode and session metadata/usage. Requested fields are not actual model evidence; runtime session metadata is checked independently and missing/mismatched identity prevents PASS.

bbdev-mcp.py adds the original deterministic plan to the same real bbdev FastMCP process that submits and polls trace_ids. Compiler/workload/BEMU/RTL operations retain bbdev execution semantics. Config install alone uses the actual CLI. Missing exact tool equivalence is INFRA.

Negative tests must not enter ordinary pass-required stems. A separate expected-failure manifest and backend run requires terminal failure, nonzero simulation returncode, matching task/binary identity and explicit expected panic/assert text in trace-bound logs. Build/network/tool failure, missing logs or cancellation cannot satisfy a negative. Old manifest had no expected-failure semantics; this is an explicitly recorded engineering completion rather than a changed normal gate.
