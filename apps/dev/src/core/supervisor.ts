// supervisor — stable public barrel for the AFK fleet supervisor.
// Implementation lives in cohesive modules under ./supervisor/*.js; keep this
// filename stable because consumers import it through the generated .ts.js path.

export {
  SUPERVISOR_DEFAULTS,
  evaluateDrainBudget,
  evaluateValidationAdmission,
  resolveSupervisorConfig,
  validateStallThresholds,
  validateSupervisorStaleThreshold,
  validateSupervisorProgressThreshold,
} from "./supervisor/config.js";
export type {
  DrainBudgetStatus,
  DrainBudgetTier,
  ElasticResizeRequest,
  ElasticShrinkMode,
  SupervisorConfig,
  SupervisorConfigReader,
  ValidationAdmissionDecision,
  ValidationAdmissionInput,
} from "./supervisor/config.js";

export { classifySupervisor, recordDeath } from "./supervisor/health.js";
export type { CircuitDecision, SupervisorHealth, SupervisorLiveness } from "./supervisor/health.js";

export type {
  FleetHeartbeat,
  FleetHeartbeatEmitResult,
  HeartbeatSlotDetail,
  HeartbeatSlotPid,
  IterDirInfo,
  ReconcileCandidate,
  SpawnPolicy,
  SupervisorDeps,
  SupervisorEventKind,
  SupervisorEventRecord,
  SupervisorFs,
  SupervisorGh,
  SupervisorProc,
  SweepWork,
  SweepWorker,
  TrunkFreshnessOutcome,
  TrunkFreshnessStatus,
  TrunkMirrorRefreshResult,
} from "./supervisor/contracts.js";

export { freshSlot, initSupervisorState } from "./supervisor/state.js";
export type { ReapContestState, SlotState, SupervisorState } from "./supervisor/state.js";

export {
  buildCrashEnvelope,
  buildDiscardEnvelope,
  buildReaperEnvelope,
  decideCrashReconcile,
  reconcileDeadWorkerClaim,
} from "./supervisor/envelopes.js";

export type { TickResult } from "./supervisor/tick-result.js";

export { HEARTBEAT_STATE_REPAIR_AFTER_TICKS } from "./supervisor/heartbeat.js";

export {
  dispatchReconcileIfPossible,
  handleDeadSlot,
  pollStallDetector,
  reapStalledSlot,
  resolveReapContest,
  sweepParkedSlot,
  terminateAll,
} from "./supervisor/lifecycle.js";
export type { ReapContestResolution } from "./supervisor/lifecycle.js";

export { superviseTick } from "./supervisor/tick.js";

export { adoptPersistedSlotPids, guardedTick, runSupervisor } from "./supervisor/runner.js";
export type { SupervisorAdoptionResult } from "./supervisor/runner.js";
