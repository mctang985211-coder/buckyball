# legacy-single-prompt-clamp-v1 / prompt v2

Independent legacy experiment. Formal gates and PPA are pending; implementation artifacts are not a PASS.

The original chip and Ball role prompts, deterministic CI scripts, and an explicit GPT-6.1 Sol/OpenAI executor adapter are frozen in `.github/scripts/bb-verify/`. The legacy cumulative chip stage is retained. A separate machine-readable Ball child-phase block preserves c-bemu then RTL checks on this independently configured chip; all child gates must pass before the top verdict can be PASS. Negative inputs are judged independently, requiring a specific real rejection and nonzero exit.

No framework changes, model self-evolution, full-model workloads, upstream writes, or PR merge are authorized or performed. Existing modified/untracked sources in the original checkout are excluded.

Final `experiment-summary.json` and `experiment-report.md` will record actual evidence, failures, PPA gaps, usage and recovery instructions.
