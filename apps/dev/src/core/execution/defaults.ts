

export const DEFAULT_IDLE_TIMEOUT_S = 600;

/**
 * Attempt wall-clock guard (proof-of-PROGRESS): the inner agent is aborted when
 * no NEW commit or other productive signal has landed on the worker branch
 * within this many seconds.
 * `idleTimeoutSeconds` catches *silence* (no output) and `maxIterations` caps
 * *re-invocations*, but a single iteration that stays busy — re-exploring,
 * re-running tests — without ever committing or signalling slips past both and
 * burns cycle indefinitely (the 1h41m #834 hang). The clock resets on every new
 * commit, so a steadily-committing agent is never killed; only one that spins
 * without producing work is.
 */
export const DEFAULT_ATTEMPT_TIMEOUT_S = 2700;

/**
 * Commit-anchored HARD cap on the attempt guard (issue #637): the edit-signal
 * (ADR 0051) may extend the soft deadline only this many seconds past the last
 * commit (or spawn). A busy-but-unproductive agent that re-validates in a loop
 * while occasionally touching a file resets the soft deadline forever — the
 * observed #579 worker burned 5h+ that way. Past the hard cap with no NEW
 * commit, the guard aborts even if worktree/activity signals keep extending the
 * soft deadline, which routes the attempt to the `timeout` terminal where the
 * ADR 0055 reconcile can land an already-committed green branch without
 * re-running the agent.
 */
export const DEFAULT_ATTEMPT_HARD_CAP_S = 5400;

/**
 * The re-invocation ceiling handed to sandcastle's Orchestrator (issue #322).
 *
 * sandcastle's own DEFAULT_MAX_ITERATIONS is 1 (run.js), which cuts the inner
 * agent off after a SINGLE agentic invocation — it explores / writes files but
 * exhausts that one iteration's budget BEFORE it can emit `<promise>DONE</promise>`,
 * so AFK sees no completionSignal → no-sentinel → blocked:crashed and never
 * merges. The completionSignal (DONE/BLOCKED) is the REAL terminator; this is
 * only the safety ceiling for "the agent never signals". 20 is generous vs the
 * broken 1 yet bounded vs runaway: each iteration is itself bounded by
 * `idleTimeoutSeconds`, and DONE/BLOCKED stops the loop early, so a normal issue
 * finishes in 1-3 iterations and 20 is purely the cap — enough headroom for a
 * thorough agent without turning repeated no-sentinel failures into long loops.
 * Raised 12 → 20 because heavy issues (e.g. Rust replication that re-runs the
 * full `cargo test` suite to re-validate) legitimately spend more agentic turns
 * and were hitting the cap with a complete, mergeable branch but no sentinel.
 * The cap is the symptom-bound, not the cure — the real fix is the agent
 * emitting DONE as soon as the gate is green (AGENT-PROMPT) + a runtime salvage
 * of a no-sentinel-but-mergeable branch. Env-tunable via RED_AFK_MAX_ITERATIONS
 * (parsed by `parseMaxIterations`).
 */
export const DEFAULT_MAX_ITERATIONS = 20;

/**
 * Parse a RED_AFK_MAX_ITERATIONS override into a positive integer, or
 * `undefined` when the value is missing / non-numeric / zero / negative — so an
 * operator typo cannot disable the cap or pin it to a value below the default.
 * `undefined` lets `buildRunOptions` fall back to {@link DEFAULT_MAX_ITERATIONS}.
 */
export function parseMaxIterations(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return undefined;
}

/**
 * Parse a RED_AFK_IDLE_TIMEOUT_S override (FIX G) into a positive integer, or
 * `undefined` when missing / non-numeric / zero / negative — typo-safe, mirroring
 * {@link parseMaxIterations}. `undefined` lets `buildRunOptions` fall back to
 * {@link DEFAULT_IDLE_TIMEOUT_S}, so an operator typo cannot disable the idle
 * watchdog or pin it to a nonsensical value.
 */
export function parseIdleTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return undefined;
}
