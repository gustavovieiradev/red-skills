// AFK execution backend public surface.
//
// Kept at this exact path because consumers import the NodeNext-emitted
// `execution.ts.js` specifier. Implementation lives in sibling modules under
// `./execution/`; this file is the compatibility barrel.

export type { AgentStreamEvent } from "@reddb-io/red-castle";
export { BLOCKED_SIGNAL, COMPLETION_SIGNALS, DONE_SIGNAL } from "@reddb-io/red-castle/engine";
export type { AgentOutput } from "./agent-output.js";

export type { AgentOutcome } from "./execution/signals.js";
export { extractSignalKill, interpretOutcome, interpretCompletion, enforceStructuredOutput } from "./execution/signals.js";

export type {
  AgentEffort,
  AgentFactories,
  AgentRunner,
  RunAgentInput,
  RunAgentResult,
  SandcastleDeps,
  SandboxMode,
} from "./execution/runtime.js";
export {
  buildAgent,
  buildContinuousPushHook,
  buildNoLeakCommitMsgHook,
  buildRunOptions,
  defaultSandcastleDeps,
  DEFAULT_ATTEMPT_HARD_CAP_S,
  DEFAULT_ATTEMPT_TIMEOUT_S,
  DEFAULT_IDLE_TIMEOUT_S,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_REMOTE,
  effortForProvider,
  OPENROUTER_API_KEY_ENV,
  parseIdleTimeout,
  parseMaxIterations,
  runAgent,
  CODEX_EFFORTS,
  CLAUDE_EFFORTS,
  MINIMAX_EFFORTS,
} from "./execution/runtime.js";

export type {
  AttemptActivityUsage,
  AttemptBudget,
  AttemptBudgetUsage,
  AttemptProgressInfo,
  AttemptTimeoutReason,
} from "./execution/attempt-guard.js";
export { exceedsBudget, startAttemptGuard } from "./execution/attempt-guard.js";

export { isExhaustionError, isTransientRunnerError } from "./execution/error-classification.js";
