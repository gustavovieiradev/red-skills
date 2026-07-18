import { computeHalfOpenBackoff } from "../slot-circuit.js";
import type { DrainBudgetStatus, SupervisorConfig } from "./config.js";
import type { FleetHeartbeat, FleetHeartbeatEmitResult, HeartbeatSlotDetail, HeartbeatSlotPid, SupervisorDeps, SupervisorState, TrunkFreshnessOutcome } from "./types.js";

// ---------- actions (compose deciders, apply via injected IO) ----------

/** Outcome of one supervise tick, for parity assertions / logging. */
export interface TickResult {
  respawned: number[];
  /** Slots whose worker died and were handled (respawn or park). */
  deaths: number[];
  /** Slots parked by a circuit-breaker trip this tick. */
  parked: number[];
  /** Slots that entered idle-park this tick (clean drain, empty queue). */
  idleParked: number[];
  /** Slots whose cooldown expired and a half-open probe was spawned this tick. */
  halfOpened: number[];
  reaped: number[];
  /** Issues re-queued this tick because their claiming worker died mid-attempt
   * and stranded them in `running` (#815, ADR 0071 Pattern 5). One entry per
   * issue the running supervisor reconciled off the dead-slot respawn path. */
  crashReconciled: number[];
  /** Slots into which a reconcile worker was dispatched this tick. */
  reconciledSlots: number[];
  /** Issues the periodic dependency Unblock Sweep promoted to ready-for-agent
   * this tick (#844). Empty when the sweep was throttled, unwired, found nothing
   * to promote, or failed (best-effort). */
  unblocked: number[];
  /** Latest continuous trunk freshness tick outcome, when the seam is wired. */
  trunkFreshness?: TrunkFreshnessOutcome;
  /** Slots removed from the runtime fleet by elastic shrink this tick. */
  retiredSlots: number[];
  /** True when a live directive changed the fleet runner this tick. */
  runnerChanged: boolean;
  /** True when the stop-file was honoured and all workers terminated. */
  stopped: boolean;
  /** Ready-queue depth sampled at the start of this tick (0 on an abandoned
   * tick or when readyQueueDepth is unavailable). Used by emitFleetHeartbeat
   * so the queue is fetched exactly once per tick. */
  queueDepth: number;
  drainBudget?: DrainBudgetStatus;
  /**
   * True when the tick was abandoned — guardedTick timed out or threw. An
   * abandoned tick does NOT advance lastProgressEpoch in the heartbeat; only
   * ticks that complete normally are counted as "forward progress" (#579).
   */
  abandoned: boolean;
}

function fleetSlotCounts(
  state: SupervisorState,
  deps: SupervisorDeps,
): Pick<FleetHeartbeat, "slotsBusy" | "slotsFree" | "slotsTotal" | "slotsParked"> {
  let slotsBusy = 0;
  let slotsFree = 0;
  let slotsParked = 0;
  for (const slot of state.slots) {
    if (slot.parked || slot.idleParked) {
      slotsParked += 1;
    } else if (slot.pid === null) {
      slotsFree += 1;
    } else if (!deps.proc.isAlive(slot.pid)) {
      slotsFree += 1;
    } else {
      slotsBusy += 1;
    }
  }
  return { slotsBusy, slotsFree, slotsTotal: state.slots.length, slotsParked };
}

function isoFromEpoch(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

export const HEARTBEAT_STATE_REPAIR_AFTER_TICKS = 2;

function buildSlotDetails(
  state: SupervisorState,
  config: Pick<SupervisorConfig, "halfOpenBaseS" | "halfOpenCapS">,
): HeartbeatSlotDetail[] {
  const details: HeartbeatSlotDetail[] = [];
  for (let i = 0; i < state.slots.length; i++) {
    const slot = state.slots[i]!;
    if (slot.idleParked) {
      details.push({ index: i, status: "idle-parked" });
    } else if (slot.parked && slot.halfOpen) {
      details.push({ index: i, status: "half-open" });
    } else if (slot.parked) {
      const retryAt =
        slot.tripEpoch > 0
          ? slot.tripEpoch + computeHalfOpenBackoff(slot.backoffStep, config)
          : undefined;
      details.push({ index: i, status: "open", ...(retryAt !== undefined ? { retryAt } : {}) });
    }
  }
  return details;
}

function buildSlotPidMap(state: SupervisorState): HeartbeatSlotPid[] {
  const out: HeartbeatSlotPid[] = [];
  for (let i = 0; i < state.slots.length; i += 1) {
    const pid = state.slots[i]!.pid;
    if (pid !== null && Number.isSafeInteger(pid) && pid > 0) {
      out.push({ slot: i, pid });
    }
  }
  return out;
}

function pruneEpochsInWindow(epochs: readonly number[], now: number, windowS: number): number[] {
  const floor = now - Math.max(1, windowS);
  return epochs.filter((epoch) => epoch >= floor);
}

function updateChurnStats(
  state: SupervisorState,
  result: Pick<TickResult, "deaths" | "respawned">,
  now: number,
  windowS: number,
): FleetHeartbeat["churn"] {
  const resolvedWindowS = Math.max(1, windowS);
  state.churnDeathEpochs = pruneEpochsInWindow(state.churnDeathEpochs, now, resolvedWindowS);
  state.churnRespawnEpochs = pruneEpochsInWindow(state.churnRespawnEpochs, now, resolvedWindowS);
  for (const _ of result.deaths) state.churnDeathEpochs.push(now);
  for (const _ of result.respawned) state.churnRespawnEpochs.push(now);
  state.churnDeathEpochs = pruneEpochsInWindow(state.churnDeathEpochs, now, resolvedWindowS);
  state.churnRespawnEpochs = pruneEpochsInWindow(state.churnRespawnEpochs, now, resolvedWindowS);
  return {
    deaths: state.churnDeathEpochs.length,
    respawns: state.churnRespawnEpochs.length,
    windowS: resolvedWindowS,
  };
}

export async function emitFleetHeartbeat(
  state: SupervisorState,
  deps: SupervisorDeps,
  result: TickResult,
  config: Pick<SupervisorConfig, "runner" | "target" | "shrinkMode" | "halfOpenBaseS" | "halfOpenCapS" | "circuitWindowS">,
): Promise<{ heartbeat: FleetHeartbeat; write: FleetHeartbeatEmitResult }> {
  // Queue depth was fetched once by superviseTick at the start of this tick
  // and stored in result.queueDepth — reuse it here so there is exactly one
  // readyQueueDepth call per tick (0 on a stop tick or abandoned tick).
  const readyForAgent = result.queueDepth;
  const epoch = deps.now();
  const churn = updateChurnStats(state, result, epoch, config.circuitWindowS);
  const heartbeat: FleetHeartbeat = {
    ts: isoFromEpoch(epoch),
    epoch,
    lastProgressEpoch: state.lastProgressEpoch,
    runner: config.runner,
    target: config.target,
    shrinkMode: config.shrinkMode,
    readyForAgent,
    ...fleetSlotCounts(state, deps),
    spawnsThisTick: result.respawned.length,
    churn,
    ...(result.drainBudget ? { drainBudget: result.drainBudget } : {}),
    ...(result.trunkFreshness ?? state.lastTrunkFreshness
      ? { trunkFreshness: result.trunkFreshness ?? state.lastTrunkFreshness }
      : {}),
    slotDetails: buildSlotDetails(state, config),
    slotPids: buildSlotPidMap(state),
  };
  let rawWrite: FleetHeartbeatEmitResult | void = undefined;
  try {
    rawWrite = await deps.emitFleetHeartbeat?.(heartbeat);
  } catch {
    // best-effort: heartbeat IO must never affect supervisor scheduling.
  }
  return {
    heartbeat,
    write: rawWrite ?? { stateWritten: true, firehoseWritten: true },
  };
}

function shortError(message: string | undefined): string {
  return message && message.length > 0 ? ` error=${message}` : "";
}

export function trunkFreshnessEventPayload(outcome: TrunkFreshnessOutcome | undefined): Record<string, string | number> {
  if (outcome === undefined) return {};
  return {
    trunk_freshness_status: outcome.status,
    trunk_freshness_refreshed_at_epoch: outcome.refreshedAtEpoch,
    trunk_freshness_interval_s: outcome.intervalS,
    ...(outcome.nextDueEpoch !== undefined ? { trunk_freshness_next_due_epoch: outcome.nextDueEpoch } : {}),
    ...(outcome.remoteRef !== undefined ? { trunk_freshness_remote_ref: outcome.remoteRef } : {}),
    ...(outcome.mirrorRef !== undefined ? { trunk_freshness_mirror_ref: outcome.mirrorRef } : {}),
    ...(outcome.sha !== undefined ? { trunk_freshness_sha: outcome.sha } : {}),
    ...(outcome.message !== undefined ? { trunk_freshness_message: outcome.message } : {}),
  };
}

export async function superviseHeartbeatStateWrite(
  state: SupervisorState,
  deps: SupervisorDeps,
  heartbeat: FleetHeartbeat,
  write: FleetHeartbeatEmitResult,
): Promise<void> {
  if (write.stateWritten) {
    state.lastHeartbeatStateWriteEpoch = heartbeat.epoch;
    state.heartbeatStateWriteMisses = 0;
    return;
  }

  state.heartbeatStateWriteMisses += 1;
  if (state.heartbeatStateWriteMisses < HEARTBEAT_STATE_REPAIR_AFTER_TICKS) return;

  const staleForS =
    state.lastHeartbeatStateWriteEpoch > 0
      ? heartbeat.epoch - state.lastHeartbeatStateWriteEpoch
      : heartbeat.epoch;
  deps.log?.(
    `heartbeat state writer stale: misses=${state.heartbeatStateWriteMisses} ` +
      `stale_for_s=${staleForS}${shortError(write.stateError)}; rewriting current tick snapshot`,
  );

  let repair: FleetHeartbeatEmitResult | void;
  try {
    repair = await deps.repairFleetHeartbeat?.(heartbeat);
  } catch (err) {
    deps.log?.(`heartbeat state repair threw: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (repair?.stateWritten) {
    state.lastHeartbeatStateWriteEpoch = heartbeat.epoch;
    state.heartbeatStateWriteMisses = 0;
    deps.log?.(`heartbeat state repair wrote epoch=${heartbeat.epoch}`);
  } else {
    deps.log?.(
      `heartbeat state repair failed: misses=${state.heartbeatStateWriteMisses}` +
        shortError(repair?.stateError),
    );
  }
}
