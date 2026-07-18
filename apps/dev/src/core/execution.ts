// AFK execution backend on @reddb-io/red-castle (ADR 0033).
//
// This file is the stable public barrel for callers that import execution.ts.js.
// Implementation details live in cohesive sibling modules under ./execution/.

export type { AgentStreamEvent } from "@reddb-io/red-castle";
export { BLOCKED_SIGNAL, COMPLETION_SIGNALS, DONE_SIGNAL } from "@reddb-io/red-castle/engine";
export type { AgentOutput } from "./agent-output.js";
export { CODEX_EFFORTS, CLAUDE_EFFORTS, MINIMAX_EFFORTS } from "./runner-spec.js";

export { extractSignalKill } from "./execution/signals.js";
export {
  DEFAULT_ATTEMPT_HARD_CAP_S,
  DEFAULT_ATTEMPT_TIMEOUT_S,
  DEFAULT_IDLE_TIMEOUT_S,
  DEFAULT_MAX_ITERATIONS,
  parseIdleTimeout,
  parseMaxIterations,
} from "./execution/defaults.js";
export type { AgentEffort, AgentOutcome, AgentRunner, RunAgentInput, RunAgentResult, SandboxMode, SandcastleDeps } from "./execution/types.js";
export { DEFAULT_REMOTE } from "./execution/types.js";
export { buildAgent, effortForProvider, OPENROUTER_API_KEY_ENV, type AgentFactories } from "./execution/agent.js";
export { enforceStructuredOutput, interpretCompletion, interpretOutcome } from "./execution/completion.js";
export { buildContinuousPushHook, buildNoLeakCommitMsgHook, buildRunOptions } from "./execution/run-options.js";
export { isExhaustionError, isTransientRunnerError } from "./execution/errors.js";
export {
  exceedsBudget,
  startAttemptGuard,
  type AttemptActivityUsage,
  type AttemptBudget,
  type AttemptBudgetUsage,
  type AttemptProgressInfo,
  type AttemptTimeoutReason,
} from "./execution/attempt-guard.js";
export { runAgent } from "./execution/run-agent.js";
export { defaultSandcastleDeps } from "./execution/deps.js";
