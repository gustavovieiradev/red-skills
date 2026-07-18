import { BLOCKED_SIGNAL, COMPLETION_SIGNALS, DONE_SIGNAL } from "@reddb-io/red-castle/engine";

// Re-exported so process-issue / run can type their agent-event sink without
// importing the sandcastle package directly (execution.ts is the single seam
// coupled to sandcastle, ADR 0033).
export type { AgentStreamEvent } from "@reddb-io/red-castle";

// The runners with a first-class sandcastle agent provider. `opencode` (ADR
// 0059) is endpoint-agnostic — OpenCode itself routes `<provider>/<model>` slugs
// to OpenAI / OpenRouter / MiniMax / any OpenAI-compatible endpoint using the
// first set auth env-var (`OPENAI_API_KEY` > `MINIMAX_API_KEY` >
// `OPENROUTER_API_KEY`, see `opencode-env.ts`). AFK only propagates the key
// through `OpenCodeOptions.env`; OpenCode owns endpoint resolution. `opencode`
// is accepted only as an explicit pin (`--runner opencode` /
// `RED_AFK_RUNNER=opencode`), never auto-sniffed (runner-detection.ts), since
// no host session is OpenCode. `claude-minimax` (PRD #788) is likewise an
// explicit-pin-only lane: it reuses the unchanged `claude-code` provider but
// injects a MiniMax Anthropic-compat auth env and forces the `MiniMax-M3` model
// (see {@link buildAgent} and `minimax-env.ts`). `hermes` is a runner-neutral
// fallback contract with NO sandcastle provider, so it is not in this union —
// process-issue coerces it onto a backed runner before spawning.
export type AgentRunner = "claude" | "codex" | "opencode" | "claude-minimax";
export type SandboxMode = "none" | "docker" | "podman";
export type AgentEffort = "low" | "medium" | "high" | "xhigh" | "max";
// `exhausted` is surfaced when sandcastle's run() signals quota / rate-limit
// (RUNNER_EXHAUSTED in the shell port). `runner-transient` is surfaced when the
// runner transport/setup path failed before AFK got a usable agent result (for
// example Codex websocket 502 / thread-start failures). Both ride the same
// outcome union so process-issue can branch on them without treating the worker
// as crashed.
// `timeout` is surfaced when AFK's attempt wall-clock guard aborts a run that is
// alive but making no progress (no new commit within the cap) — the "productive
// infinite loop" the idle / max-iteration / stall guards all miss. It maps to the
// `stalled` terminal outcome downstream (→ blocked:stalled, ready-for-human),
// preserving the worktree/PR.
// `goal-moot` (ADR 0057): the attempt-guard poll observed the claimed issue
// already CLOSED, so the attempt's goal is already reflected in the world. The
// inner agent is aborted and process-issue maps it to a deterministic terminal
// outcome (own-merge → done, foreign close → claim-lost) without envelope spam.
export type AgentOutcome =
  | "done"
  | "blocked"
  | "no-sentinel"
  // External-signal kill (#1308): the inner process was terminated by an OS
  // signal (SIGKILL/SIGTERM). Carries the signal name in stdout. Routed to
  // `signal-killed` in AttemptOutcome so the kill cause is recorded distinctly
  // from a generic crash — same recovery policy as `no-sentinel`.
  | "signal-killed"
  | "exhausted"
  | "runner-transient"
  | "timeout"
  | "budget-exceeded"
  | "goal-moot";

/** AFK's canonical sentinels, registered as sandcastle completion signals. */
export { BLOCKED_SIGNAL, COMPLETION_SIGNALS, DONE_SIGNAL };


/** Unix signal exit-code convention: exit code = 128 + signal number. */
const SIGNAL_EXIT_NAMES: Record<number, string> = {
  1: "SIGHUP",
  2: "SIGINT",
  3: "SIGQUIT",
  9: "SIGKILL",
  11: "SIGSEGV",
  13: "SIGPIPE",
  15: "SIGTERM",
};

/**
 * Returns the signal name and raw exit code if the error message matches the
 * Orchestrator's "exited with code N" pattern and N is in the signal range
 * (128–192, i.e. 128 + signal 0–64). Returns null for any other error (#1308).
 */
export function extractSignalKill(error: unknown): { signal: string; exitCode: number } | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /exited with code (\d+)/.exec(message);
  if (!match) return null;
  const exitCode = parseInt(match[1], 10);
  if (exitCode < 128 || exitCode > 192) return null;
  const signalNum = exitCode - 128;
  const signal = SIGNAL_EXIT_NAMES[signalNum] ?? `SIG${signalNum}`;
  return { signal, exitCode };
}

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
