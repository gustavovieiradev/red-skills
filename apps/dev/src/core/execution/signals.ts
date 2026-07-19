import type { AgentOutput } from "../agent-output.js";
import { extractAgentOutput } from "@reddb-io/red-castle";
import {
  BLOCKED_SIGNAL,
  COMPLETION_SIGNALS,
  DONE_SIGNAL,
} from "@reddb-io/red-castle/engine";
import { runnerSupportsStructuredOutput } from "../runner-spec.js";
import type { AgentRunner } from "./runtime.js";

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

/** Map an AFK completion signal back to an iteration outcome. */
export function interpretOutcome(signal: string | undefined): AgentOutcome {
  if (signal === DONE_SIGNAL) return "done";
  if (signal === BLOCKED_SIGNAL) return "blocked";
  return "no-sentinel";
}

/**
 * Resolve an attempt outcome from the two coexisting completion channels (ADR
 * 0082 §2). The structured `AgentOutput` wins when present and valid — a
 * schema-validated `success` is authoritative — and its `success` maps to
 * `done`/`blocked` exactly as the sentinel does. When no valid structured block
 * is present the text sentinel path applies untouched ({@link interpretOutcome}),
 * so every non-adopting runner and every legacy stdout keeps its current
 * behaviour. This is what lets a run that emitted a valid structured block but
 * forgot the `<promise>` sentinel yield a definite outcome instead of
 * `no-sentinel` (the #788 failure class).
 */
export function interpretCompletion(
  structured: AgentOutput | undefined,
  signal: string | undefined,
): AgentOutcome {
  if (structured) return structured.success ? "done" : "blocked";
  return interpretOutcome(signal);
}

/**
 * Enforce the native structured-output contract (ADR 0090, #932) on a
 * schema-enabled runner: a `done` outcome only stands when the agent also
 * emitted a valid red-castle `AgentOutput` block. On a schema-enabled runner
 * (claude first) a missing / malformed / schema-invalid `<agent-output>` DOWNGRADES
 * the `done` to `no-sentinel`, so the agent literally cannot terminate "done"
 * without the schema — routing a forgotten schema through the same recovery the
 * forgotten text sentinel already uses. Pure; the `warn` is emitted by the caller.
 *
 * Coexist: for runners WITHOUT native schema support the outcome passes through
 * unchanged, so the text sentinel remains their sole terminal signal. Only a
 * `done` outcome is gated — `blocked` / `no-sentinel` / exhaustion / timeout are
 * never touched (a schema is required to claim success, not to report a block).
 */
export function enforceStructuredOutput(
  runner: AgentRunner,
  outcome: AgentOutcome,
  stdout: string,
): { outcome: AgentOutcome; rejectedReason?: string } {
  if (outcome !== "done" || !runnerSupportsStructuredOutput(runner)) return { outcome };
  const extracted = extractAgentOutput(stdout);
  if (extracted.ok) return { outcome };
  return {
    outcome: "no-sentinel",
    rejectedReason: extracted.reason + (extracted.detail ? `: ${extracted.detail}` : ""),
  };
}
