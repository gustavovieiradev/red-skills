// supervisor — public barrel for the AFK fleet supervisor.
// Keep this filename stable: consumers import ../core/supervisor.js.

export {
  SUPERVISOR_DEFAULTS,
  evaluateDrainBudget,
  evaluateValidationAdmission,
  resolveSupervisorConfig,
  validateStallThresholds,
  validateSupervisorStaleThreshold,
  validateSupervisorProgressThreshold,
  classifySupervisor,
  recordDeath,
} from "./supervisor/config.js";
export type {
  SupervisorConfig,
  ElasticShrinkMode,
  ElasticResizeRequest,
  DrainBudgetTier,
  DrainBudgetStatus,
  ValidationAdmissionInput,
  ValidationAdmissionDecision,
  SupervisorConfigReader,
  SupervisorLiveness,
  SupervisorHealth,
  CircuitDecision,
} from "./supervisor/config.js";
export {
  freshSlot,
  initSupervisorState,
} from "./supervisor/types.js";
export type {
  ReconcileCandidate,
  SupervisorProc,
  SupervisorFs,
  SpawnPolicy,
  SupervisorGh,
  HeartbeatSlotDetail,
  HeartbeatSlotPid,
  TrunkFreshnessStatus,
  TrunkFreshnessOutcome,
  TrunkMirrorRefreshResult,
  FleetHeartbeat,
  FleetHeartbeatEmitResult,
  SupervisorEventKind,
  SupervisorEventRecord,
  IterDirInfo,
  SweepWorker,
  SweepWork,
  SupervisorDeps,
  ReapContestState,
  SlotState,
  SupervisorState,
} from "./supervisor/types.js";
export {
  buildDiscardEnvelope,
  buildReaperEnvelope,
  buildCrashEnvelope,
  decideCrashReconcile,
  reconcileDeadWorkerClaim,
} from "./supervisor/envelopes.js";
export {
  HEARTBEAT_STATE_REPAIR_AFTER_TICKS,
} from "./supervisor/heartbeat.js";
export type {
  TickResult,
} from "./supervisor/heartbeat.js";
export {
  sweepParkedSlot,
  reapStalledSlot,
  resolveReapContest,
  pollStallDetector,
} from "./supervisor/reap.js";
export type {
  ReapContestResolution,
} from "./supervisor/reap.js";
export {
  handleDeadSlot,
  dispatchReconcileIfPossible,
  terminateAll,
} from "./supervisor/lifecycle.js";
export {
  superviseTick,
} from "./supervisor/tick.js";
export {
  adoptPersistedSlotPids,
  runSupervisor,
  guardedTick,
} from "./supervisor/run.js";
export type {
  SupervisorAdoptionResult,
} from "./supervisor/run.js";
