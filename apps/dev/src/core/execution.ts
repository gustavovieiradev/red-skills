// AFK execution backend public surface.
//
// Keep this filename stable: NodeNext consumers import `core/execution.ts.js`.
// Implementation modules live under `core/execution/`.

export type { AgentStreamEvent } from "@reddb-io/red-castle";
export { BLOCKED_SIGNAL, COMPLETION_SIGNALS, DONE_SIGNAL } from "@reddb-io/red-castle/engine";

export {
  DEFAULT_ATTEMPT_HARD_CAP_S,
  DEFAULT_ATTEMPT_TIMEOUT_S,
  DEFAULT_IDLE_TIMEOUT_S,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_REMOTE,
  CODEX_EFFORTS,
  CLAUDE_EFFORTS,
  MINIMAX_EFFORTS,
  OPENROUTER_API_KEY_ENV,
  buildAgent,
  buildRunOptions,
  defaultSandcastleDeps,
  effortForProvider,
  enforceStructuredOutput,
  extractSignalKill,
  interpretCompletion,
  interpretOutcome,
  isExhaustionError,
  isTransientRunnerError,
  parseIdleTimeout,
  parseMaxIterations,
  runAgent,
} from "./execution/runtime.js";

export type {
  AgentEffort,
  AgentFactories,
  AgentOutcome,
  AgentOutput,
  AgentRunner,
  RunAgentInput,
  RunAgentResult,
  SandcastleDeps,
  SandboxMode,
} from "./execution/runtime.js";

export { buildContinuousPushHook, buildNoLeakCommitMsgHook } from "./execution/hooks.js";

export { exceedsBudget, startAttemptGuard } from "./execution/attempt-guard.js";

export type {
  AttemptActivityUsage,
  AttemptBudget,
  AttemptBudgetUsage,
  AttemptProgressInfo,
  AttemptTimeoutReason,
} from "./execution/attempt-guard.js";
