// supervisor — stable public barrel for the AFK fleet supervisor.
// Keep this filename: NodeNext consumers import ../core/supervisor.js.

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
  type CircuitDecision,
  type DrainBudgetStatus,
  type DrainBudgetTier,
  type ElasticResizeRequest,
  type ElasticShrinkMode,
  type SupervisorConfig,
  type SupervisorConfigReader,
  type SupervisorHealth,
  type SupervisorLiveness,
  type ValidationAdmissionDecision,
  type ValidationAdmissionInput,
} from "./supervisor/config.js";
export {
  freshSlot,
  initSupervisorState,
  type FleetHeartbeat,
  type FleetHeartbeatEmitResult,
  type HeartbeatSlotDetail,
  type HeartbeatSlotPid,
  type IterDirInfo,
  type ReapContestState,
  type ReconcileCandidate,
  type SlotState,
  type SpawnPolicy,
  type SupervisorDeps,
  type SupervisorEventKind,
  type SupervisorEventRecord,
  type SupervisorFs,
  type SupervisorGh,
  type SupervisorProc,
  type SupervisorState,
  type SweepWork,
  type SweepWorker,
  type TrunkFreshnessOutcome,
  type TrunkFreshnessStatus,
  type TrunkMirrorRefreshResult,
} from "./supervisor/contracts.js";
export {
  buildCrashEnvelope,
  buildDiscardEnvelope,
  buildReaperEnvelope,
  decideCrashReconcile,
  reconcileDeadWorkerClaim,
} from "./supervisor/envelopes.js";
export { HEARTBEAT_STATE_REPAIR_AFTER_TICKS, type TickResult } from "./supervisor/heartbeat.js";
export {
  pollStallDetector,
  reapStalledSlot,
  resolveReapContest,
  sweepParkedSlot,
  type ReapContestResolution,
} from "./supervisor/reaper.js";
export { dispatchReconcileIfPossible, handleDeadSlot, superviseTick, terminateAll } from "./supervisor/tick.js";
export { adoptPersistedSlotPids, guardedTick, runSupervisor, type SupervisorAdoptionResult } from "./supervisor/loop.js";
