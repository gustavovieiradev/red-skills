// supervisor — the AFK fleet supervisor public surface.
//
// The implementation is split by responsibility under ./supervisor/*.ts, while
// this original filename remains the stable NodeNext ESM import target.

export {
  SUPERVISOR_DEFAULTS,
  classifySupervisor,
  evaluateDrainBudget,
  evaluateValidationAdmission,
  recordDeath,
  resolveSupervisorConfig,
  validateStallThresholds,
  validateSupervisorProgressThreshold,
  validateSupervisorStaleThreshold,
} from "./supervisor/config.js";
export type {
  CircuitDecision,
  DrainBudgetStatus,
  DrainBudgetTier,
  ElasticResizeRequest,
  ElasticShrinkMode,
  SupervisorConfig,
  SupervisorConfigReader,
  SupervisorHealth,
  SupervisorLiveness,
  ValidationAdmissionDecision,
  ValidationAdmissionInput,
} from "./supervisor/config.js";

export { freshSlot, initSupervisorState } from "./supervisor/runtime.js";
export type {
  FleetHeartbeat,
  FleetHeartbeatEmitResult,
  HeartbeatSlotDetail,
  HeartbeatSlotPid,
  IterDirInfo,
  ReapContestState,
  ReconcileCandidate,
  SlotState,
  SpawnPolicy,
  SupervisorDeps,
  SupervisorEventKind,
  SupervisorEventRecord,
  SupervisorFs,
  SupervisorGh,
  SupervisorProc,
  SupervisorState,
  SweepWork,
  SweepWorker,
  TrunkFreshnessOutcome,
  TrunkFreshnessStatus,
  TrunkMirrorRefreshResult,
} from "./supervisor/runtime.js";

export {
  buildCrashEnvelope,
  buildDiscardEnvelope,
  buildReaperEnvelope,
  decideCrashReconcile,
  reconcileDeadWorkerClaim,
} from "./supervisor/envelopes.js";

export { HEARTBEAT_STATE_REPAIR_AFTER_TICKS } from "./supervisor/heartbeat.js";
export type { TickResult } from "./supervisor/heartbeat.js";

export {
  pollStallDetector,
  reapStalledSlot,
  resolveReapContest,
  sweepParkedSlot,
} from "./supervisor/slot-recovery.js";
export type { ReapContestResolution } from "./supervisor/slot-recovery.js";

export {
  adoptPersistedSlotPids,
  dispatchReconcileIfPossible,
  guardedTick,
  handleDeadSlot,
  runSupervisor,
  superviseTick,
  terminateAll,
} from "./supervisor/fleet.js";
export type { SupervisorAdoptionResult } from "./supervisor/fleet.js";
