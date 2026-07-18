// AFK execution backend public barrel. The implementation lives in ./execution/*
// so consumers can keep importing this NodeNext .ts.js specifier unchanged.

export type { AgentStreamEvent } from "@reddb-io/red-castle";
export { BLOCKED_SIGNAL, COMPLETION_SIGNALS, DONE_SIGNAL } from "@reddb-io/red-castle/engine";
export type { AgentOutput } from "./agent-output.js";

export type { AgentEffort, AgentOutcome, AgentRunner, SandboxMode } from "./execution/signals.js";
export {
  DEFAULT_ATTEMPT_HARD_CAP_S,
  DEFAULT_ATTEMPT_TIMEOUT_S,
  DEFAULT_IDLE_TIMEOUT_S,
  DEFAULT_MAX_ITERATIONS,
  extractSignalKill,
  parseIdleTimeout,
  parseMaxIterations,
} from "./execution/signals.js";

export type { AgentFactories, RunAgentInput, RunAgentResult, SandcastleDeps } from "./execution/types.js";
export { DEFAULT_REMOTE } from "./execution/types.js";

export type {
  AttemptActivityUsage,
  AttemptBudget,
  AttemptBudgetUsage,
  AttemptProgressInfo,
  AttemptTimeoutReason,
} from "./execution/attempt-guard.js";
export { exceedsBudget, startAttemptGuard } from "./execution/attempt-guard.js";

export {
  CODEX_EFFORTS,
  CLAUDE_EFFORTS,
  MINIMAX_EFFORTS,
  OPENROUTER_API_KEY_ENV,
  buildAgent,
  buildContinuousPushHook,
  buildNoLeakCommitMsgHook,
  buildRunOptions,
  effortForProvider,
  enforceStructuredOutput,
  interpretCompletion,
  interpretOutcome,
  isExhaustionError,
  isTransientRunnerError,
} from "./execution/agent-builders.js";

export { defaultSandcastleDeps, runAgent } from "./execution/run-agent.js";
