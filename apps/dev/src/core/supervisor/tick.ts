import { encode as encodeToon } from "@reddb-io/toon";
import { computeHalfOpenBackoff, isHalfOpenDue } from "../slot-circuit.js";
import { evaluateDrainBudget, recordDeath, type DrainBudgetStatus, type ElasticResizeRequest, type ElasticShrinkMode, type SupervisorConfig } from "./config.js";
import type { SpawnPolicy } from "./contracts.js";
import { emitSupervisorEvent, freshSlot, type ReconcileCandidate, type SlotState, type SupervisorDeps, type SupervisorState, type TrunkFreshnessOutcome, type TrunkMirrorRefreshResult } from "./contracts.js";
import type { TickResult } from "./heartbeat.js";
import { reconcileDeadWorkerClaim } from "./envelopes.js";
import { pollStallDetector, resolveReapContest, sweepParkedSlot } from "./reaper.js";

export function readDrainBudget(state: SupervisorState, deps: SupervisorDeps, config: SupervisorConfig): DrainBudgetStatus | undefined {
  if (config.drainBudgetUsd === undefined) return undefined;
  let spent = 0;
  try {
    spent = deps.fs.fleetCostUsd?.() ?? 0;
  } catch {
    spent = 0;
  }
  const budget = evaluateDrainBudget(spent, config.drainBudgetUsd);
  if (budget?.tier === "HARD_STOP") state.drainBudgetHardStopped = true;
  return budget;
}

export function logDrainBudgetTransition(
  state: SupervisorState,
  deps: SupervisorDeps,
  budget: DrainBudgetStatus | undefined,
  queueDepth: number,
): void {
  if (!budget || state.lastDrainBudgetTier === budget.tier) return;
  state.lastDrainBudgetTier = budget.tier;
  deps.log?.(
    encodeToon({
      schema_version: "red.afk.drain_budget.v1",
      tier: budget.tier,
      spent_usd: Number(budget.spentUsd.toFixed(4)),
      limit_usd: Number(budget.limitUsd.toFixed(4)),
      percent: Number((budget.percent * 100).toFixed(2)),
      ready_for_agent: queueDepth,
      action:
        budget.tier === "HARD_STOP"
          ? "hard_stop_no_new_spawns_inflight_finish"
          : budget.tier === "CRITICAL"
            ? "new_spawns_downgrade_one_model_tier"
            : "observe",
    }),
  );
}

function spawnPolicyForBudget(
  state: SupervisorState,
  budget: DrainBudgetStatus | undefined,
): SpawnPolicy | "hard-stop" | undefined {
  if (state.drainBudgetHardStopped || budget?.tier === "HARD_STOP") return "hard-stop";
  if (budget?.tier === "CRITICAL") return { taskTierDowngrade: true };
  return undefined;
}

export async function spawnSlotForBudget(
  slot: number,
  deps: SupervisorDeps,
  state: SupervisorState,
  budget: DrainBudgetStatus | undefined,
): Promise<{ pid: number; spawnEpoch: number } | null> {
  const policy = spawnPolicyForBudget(state, budget);
  if (policy === "hard-stop") return null;
  return policy ? deps.proc.spawnSlot(slot, policy) : deps.proc.spawnSlot(slot);
}

async function resolveElasticResize(
  deps: SupervisorDeps,
  config: SupervisorConfig,
): Promise<Required<ElasticResizeRequest>> {
  let request: ElasticResizeRequest | null = null;
  try {
    request = (await deps.resizeRequest?.()) ?? null;
  } catch {
    request = null;
  }
  const target =
    request && Number.isInteger(request.target) && request.target >= 0
      ? request.target
      : config.target;
  return {
    target,
    shrinkMode: request?.shrinkMode ?? config.shrinkMode,
    runner:
      typeof request?.runner === "string" && request.runner.length > 0
        ? request.runner
        : config.runner,
  };
}

async function applyRunnerDirective(
  state: SupervisorState,
  deps: SupervisorDeps,
  config: SupervisorConfig,
  runner: string,
  result: TickResult,
): Promise<boolean> {
  if (runner === config.runner) return false;
  const from = config.runner;
  await deps.configureRunner?.(runner);
  config.runner = runner;
  await emitSupervisorEvent(deps, {
    kind: "supervisor.scale",
    payload: {
      from: state.slots.length,
      to: state.slots.length,
      mode: "drain-then-retire",
      runner_from: from,
      runner_to: runner,
    },
  });
  for (let i = 0; i < state.slots.length; i += 1) {
    const slot = state.slots[i]!;
    if (slot.retiring) continue;
    slot.retiring = true;
    const pid = slot.pid;
    if (pid !== null && deps.proc.isAlive(pid)) {
      try {
        await deps.proc.requestSlotRetire?.(i, pid);
      } catch {
        // best-effort
      }
    }
  }
  result.runnerChanged = true;
  return true;
}

async function growFleetToTarget(
  state: SupervisorState,
  deps: SupervisorDeps,
  config: SupervisorConfig,
  target: number,
  drainBudget: DrainBudgetStatus | undefined,
  result: TickResult,
): Promise<void> {
  for (const slot of state.slots) {
    slot.retiring = false;
  }
  while (state.slots.length < target) {
    const slotIndex = state.slots.length;
    const slot = freshSlot();
    state.slots.push(slot);
    const spawned = await spawnSlotForBudget(slotIndex, deps, state, drainBudget);
    if (spawned === null) continue;
    slot.pid = spawned.pid;
    slot.spawnEpoch = spawned.spawnEpoch;
    result.respawned.push(slotIndex);
    if (deps.dispatchFleetHook) {
      try {
        await deps.dispatchFleetHook("on_slot_spawn", {
          event: "on_slot_spawn",
          runner: config.runner,
          slot: slotIndex,
          pid: slot.pid,
        });
      } catch {
        // best-effort
      }
    }
  }
}

async function retireSlotAt(
  state: SupervisorState,
  index: number,
  result: TickResult,
): Promise<void> {
  state.slots.splice(index, 1);
  result.retiredSlots.push(index);
}

async function shrinkFleetToTarget(
  state: SupervisorState,
  deps: SupervisorDeps,
  target: number,
  mode: ElasticShrinkMode,
  result: TickResult,
): Promise<void> {
  if (target >= state.slots.length) return;
  for (let i = state.slots.length - 1; i >= target; i -= 1) {
    const slot = state.slots[i]!;
    if (mode === "hard-kill") {
      const pid = slot.pid;
      const info = deps.fs.resolveIterDir(i);
      if (pid !== null && deps.proc.isAlive(pid)) {
        await deps.proc.killTree(pid);
      }
      slot.pid = null;
      slot.stalled = false;
      slot.stallSinceEpoch = 0;
      slot.reaped = false;
      try {
        const reconciled = await reconcileDeadWorkerClaim(info, deps);
        if (reconciled !== null) result.crashReconciled.push(reconciled);
      } catch {
        // best-effort
      }
      await retireSlotAt(state, i, result);
      continue;
    }

    slot.retiring = true;
    const pid = slot.pid;
    if (pid !== null && deps.proc.isAlive(pid)) {
      try {
        await deps.proc.requestSlotRetire?.(i, pid);
      } catch {
        // best-effort
      }
      continue;
    }
    await retireSlotAt(state, i, result);
  }
}

async function retireDrainedSlots(
  state: SupervisorState,
  deps: SupervisorDeps,
  result: TickResult,
): Promise<void> {
  for (let i = state.slots.length - 1; i >= 0; i -= 1) {
    const slot = state.slots[i]!;
    if (!slot.retiring) continue;
    const pid = slot.pid;
    if (pid !== null && deps.proc.isAlive(pid)) continue;
    try {
      const reconciled = await reconcileDeadWorkerClaim(deps.fs.resolveIterDir(i), deps);
      if (reconciled !== null) result.crashReconciled.push(reconciled);
    } catch {
      // best-effort
    }
    await retireSlotAt(state, i, result);
  }
}

/**
 * handle_dead_slot (supervisor.sh ~994): a slot whose worker exited. Record the
 * death against the circuit breaker; on a trip park the slot and run the trip
 * sweep, otherwise respawn. Returns whether the slot parked. Compose recordDeath
 * (pure) then apply the spawn / sweep side effects.
 *
 * A clean exit (exit code 0, i.e. NO_MORE_TASKS / empty queue drain) is exempt
 * from the circuit breaker: it is never a fast-death, so K consecutive drains
 * can never trip the breaker. When the queue is empty the slot idle-parks
 * (no sweep, no discard envelope); when the queue has work it respawns
 * immediately. Non-zero / unknown exit codes follow the original breaker logic.
 *
 * The spawning flag is set around the spawnSlot await so that a tick abandoned
 * by the guardedTick ceiling (hung gh/ps call elsewhere in the tick) does not
 * double-spawn the slot on the next pass.
 */
export async function handleDeadSlot(
  slot: number,
  state: SlotState,
  deps: SupervisorDeps,
  config: SupervisorConfig,
  queueDepth = 0,
  spawnPolicy?: SpawnPolicy | "hard-stop",
): Promise<{ parked: boolean }> {
  const spawn = async (): Promise<{ pid: number; spawnEpoch: number } | null> => {
    if (spawnPolicy === "hard-stop") return null;
    return spawnPolicy ? deps.proc.spawnSlot(slot, spawnPolicy) : deps.proc.spawnSlot(slot);
  };
  // Half-open probe death: resolve the circuit transition before the normal path.
  if (state.parked && state.halfOpen) {
    const now = deps.now();
    const lifetime = state.spawnEpoch > 0 ? now - state.spawnEpoch : 0;
    const fastDeath = state.spawnEpoch > 0 && lifetime < config.fastDeathThresholdS;
    state.halfOpen = false;
    state.pid = null;
    if (fastDeath) {
      // Probe fast-died: re-park with next backoff step, sweep already ran on
      // the original trip so we do NOT re-sweep.
      state.backoffStep++;
      state.tripEpoch = now;
      deps.log?.(
        `circuit re-parked: slot ${slot} probe fast-death (${lifetime}s), ` +
          `next backoff=${computeHalfOpenBackoff(state.backoffStep, config)}s step=${state.backoffStep}`,
      );
      return { parked: true };
    }
    // Probe survived long enough: close the circuit and reset backoff.
    state.parked = false;
    state.backoffStep = 0;
    state.tripEpoch = 0;
    state.swept = false; // allow sweep on a future trip
    state.deaths = []; // reset the fast-death ring
    deps.log?.(`circuit closed: slot ${slot} probe succeeded (${lifetime}s), backoff reset`);
    // Respawn immediately so the closed slot has a live worker.
    state.spawning = true;
    try {
      const spawned = await spawn();
      if (spawned === null) return { parked: true };
      state.pid = spawned.pid;
      state.spawnEpoch = spawned.spawnEpoch;
    } finally {
      state.spawning = false;
    }
    state.stalled = false;
    state.stallSinceEpoch = 0;
    state.reaped = false;
    // Circuit-close spawn: on_slot_spawn fires; on_respawn does NOT (this is a
    // circuit recovery, not a plain post-death respawn). Best-effort.
    if (deps.dispatchFleetHook) {
      try {
        await deps.dispatchFleetHook("on_slot_spawn", {
          event: "on_slot_spawn",
          runner: config.runner,
          slot,
          ...(state.pid !== null ? { pid: state.pid } : {}),
        });
      } catch {
        // best-effort
      }
    }
    return { parked: false };
  }

  const exitCode = deps.proc.lastExitCode?.(slot) ?? null;
  const cleanExit = exitCode === 0;

  if (cleanExit) {
    if (queueDepth === 0) {
      // Clean drain with empty queue → idle-park (no sweep, no discard envelope).
      state.pid = null;
      state.idleParked = true;
      return { parked: true };
    }
    // Clean drain but queue has work → respawn immediately without feeding the breaker.
    state.spawning = true;
    try {
      const spawned = await spawn();
      if (spawned === null) {
        state.pid = null;
        return { parked: true };
      }
      state.pid = spawned.pid;
      state.spawnEpoch = spawned.spawnEpoch;
    } finally {
      state.spawning = false;
    }
    state.stalled = false;
    state.stallSinceEpoch = 0;
    state.reaped = false;
    // Clean-exit respawn: on_slot_spawn + on_respawn. Best-effort.
    if (deps.dispatchFleetHook) {
      try {
        await deps.dispatchFleetHook("on_slot_spawn", {
          event: "on_slot_spawn",
          runner: config.runner,
          slot,
          ...(state.pid !== null ? { pid: state.pid } : {}),
        });
        await deps.dispatchFleetHook("on_respawn", {
          event: "on_respawn",
          runner: config.runner,
          slot,
          ...(state.pid !== null ? { pid: state.pid } : {}),
        });
      } catch {
        // best-effort
      }
    }
    return { parked: false };
  }

  // Non-clean exit: record against the circuit breaker.
  const now = deps.now();
  const decision = recordDeath(state.deaths, state.spawnEpoch, now, config);
  state.deaths = decision.deaths;

  if (decision.trip) {
    state.parked = true;
    state.tripEpoch = now;
    await sweepParkedSlot(slot, state, deps, config);
    state.pid = null;
    return { parked: true };
  }

  state.spawning = true;
  try {
    const spawned = await spawn();
    if (spawned === null) {
      state.pid = null;
      return { parked: true };
    }
    state.pid = spawned.pid;
    state.spawnEpoch = spawned.spawnEpoch;
  } finally {
    state.spawning = false;
  }
  // A respawn opens a fresh worker lifetime; clear any stale stall flags.
  state.stalled = false;
  state.stallSinceEpoch = 0;
  state.reaped = false;
  // Non-clean respawn: on_slot_spawn + on_respawn. Best-effort.
  if (deps.dispatchFleetHook) {
    try {
      await deps.dispatchFleetHook("on_slot_spawn", {
        event: "on_slot_spawn",
        runner: config.runner,
        slot,
        ...(state.pid !== null ? { pid: state.pid } : {}),
      });
      await deps.dispatchFleetHook("on_respawn", {
        event: "on_respawn",
        runner: config.runner,
        slot,
        ...(state.pid !== null ? { pid: state.pid } : {}),
      });
    } catch {
      // best-effort
    }
  }
  return { parked: false };
}

/**
 * dispatchReconcileIfPossible — attempt to dispatch ONE reconcile worker into
 * the first free slot (ADR 0055, #562). Called at the end of every superviseTick,
 * after normal lifecycle handling (respawn / stall / reap). Returns the slot
 * index of the dispatched worker, or null when no dispatch occurred.
 *
 * A "free slot" is one that is not parked and has no live pid — typically freed
 * by the stall-reaper within the same tick. The heavy validate+land runs in the
 * worker process (its own timeout), off the tick's critical path.
 *
 * Both `deps.proc.spawnReconcileWorker` and `deps.gh.findReconcileCandidate` are
 * optional — when either is absent this is a no-op, preserving backward
 * compatibility with existing SupervisorDeps implementations (tests, boot-only).
 */
export async function dispatchReconcileIfPossible(
  state: SupervisorState,
  deps: SupervisorDeps,
): Promise<number | null> {
  if (!deps.proc.spawnReconcileWorker || !deps.gh.findReconcileCandidate) return null;

  // Find the first free slot: not parked and no live pid.
  const freeIdx = state.slots.findIndex((s) => !s.parked && s.pid === null);
  if (freeIdx < 0) return null;

  // Cheap detection: one gh label query + remote branch list via the injected closure.
  let candidate: ReconcileCandidate | null = null;
  try {
    candidate = await deps.gh.findReconcileCandidate();
  } catch {
    return null;
  }
  if (candidate === null) return null;

  // Dispatch the reconcile worker into the free slot.
  const spawned = await deps.proc.spawnReconcileWorker(freeIdx, candidate);
  const slot = state.slots[freeIdx]!;
  slot.pid = spawned.pid;
  slot.spawnEpoch = spawned.spawnEpoch;
  // Clear stale stall/reap flags — this is a fresh worker start.
  slot.stalled = false;
  slot.stallSinceEpoch = 0;
  slot.reaped = false;
  return freeIdx;
}

async function refreshTrunkMirrorIfDue(
  state: SupervisorState,
  deps: SupervisorDeps,
  config: Pick<SupervisorConfig, "trunkFreshnessIntervalS">,
): Promise<TrunkFreshnessOutcome | undefined> {
  if (!deps.refreshTrunkMirror) return undefined;

  const now = deps.now();
  const intervalS = Math.max(1, config.trunkFreshnessIntervalS);
  if (state.lastTrunkFreshnessEpoch > 0 && now - state.lastTrunkFreshnessEpoch < intervalS) {
    const throttled: TrunkFreshnessOutcome = {
      status: "throttled",
      refreshedAtEpoch: state.lastTrunkFreshnessEpoch,
      nextDueEpoch: state.lastTrunkFreshnessEpoch + intervalS,
      intervalS,
    };
    state.lastTrunkFreshness = throttled;
    return throttled;
  }

  state.lastTrunkFreshnessEpoch = now;
  let outcome: TrunkFreshnessOutcome;
  try {
    const refreshed = await deps.refreshTrunkMirror();
    outcome = {
      ...refreshed,
      refreshedAtEpoch: now,
      intervalS,
    };
  } catch (err) {
    outcome = {
      status: "failed",
      refreshedAtEpoch: now,
      intervalS,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  state.lastTrunkFreshness = outcome;
  return outcome;
}

/**
 * superviseTick — advance the health-check loop one cycle (the body of
 * supervisor.sh's `while :` at ~1122-1141). In order:
 *   1. honour the stop-file: terminate every worker and return early.
 *   2. refresh the fleet-owned trunk mirror when the throttle allows it.
 *   3. sample ready-queue depth (single fetch per tick, shared with heartbeat).
 *   4. un-park idle-parked slots when the queue has work.
 *   5. respawn / park dead non-parked, non-idle-parked, non-spawning slots.
 *   6. poll the passive stall detector + gated hard reaper (pollStallDetector).
 *   7. reconcile dispatch: fill a free slot with a reconcile worker if eligible.
 *
 * `stopRequested` is the injected stop-file probe (the bash `[[ -f $STOP_FILE ]]`
 * check). The real loop is `while (!await superviseTick(...).stopped)`.
 */
export async function superviseTick(
  state: SupervisorState,
  deps: SupervisorDeps,
  config: SupervisorConfig,
  stopRequested: () => boolean,
): Promise<TickResult> {
  const result: TickResult = {
    respawned: [],
    deaths: [],
    parked: [],
    idleParked: [],
    halfOpened: [],
    reaped: [],
    crashReconciled: [],
    reconciledSlots: [],
    unblocked: [],
    retiredSlots: [],
    runnerChanged: false,
    stopped: false,
    queueDepth: 0,
    abandoned: false,
  };

  if (stopRequested()) {
    await terminateAll(state, deps);
    result.stopped = true;
    return result;
  }

  result.trunkFreshness = await refreshTrunkMirrorIfDue(state, deps, config);

  // Sample queue depth once per tick for idle-park / un-park decisions and the
  // fleet heartbeat. Best-effort: 0 on any failure or missing implementation.
  let queueDepth = 0;
  try {
    queueDepth = (await deps.gh.readyQueueDepth?.()) ?? 0;
  } catch {
    queueDepth = 0;
  }
  result.queueDepth = queueDepth;
  const drainBudget = readDrainBudget(state, deps, config);
  result.drainBudget = drainBudget;
  logDrainBudgetTransition(state, deps, drainBudget, queueDepth);
  const spawnPolicy = spawnPolicyForBudget(state, drainBudget);

  const resize = await resolveElasticResize(deps, config);
  const runnerChanged = await applyRunnerDirective(state, deps, config, resize.runner, result);
  config.target = resize.target;
  config.shrinkMode = resize.shrinkMode;
  const slotsBeforeResize = state.slots.length;
  if (resize.target !== slotsBeforeResize) {
    await emitSupervisorEvent(deps, {
      kind: "supervisor.scale",
      payload: {
        from: slotsBeforeResize,
        to: resize.target,
        mode: resize.shrinkMode,
      },
    });
  }
  if (resize.target > state.slots.length && !runnerChanged) {
    for (const slot of state.slots) slot.retiring = false;
  }
  if (resize.target > state.slots.length && spawnPolicy !== "hard-stop") {
    await growFleetToTarget(state, deps, config, resize.target, drainBudget, result);
  } else if (resize.target < state.slots.length) {
    await shrinkFleetToTarget(state, deps, resize.target, resize.shrinkMode, result);
  }
  await retireDrainedSlots(state, deps, result);

  for (let i = 0; i < state.slots.length; i += 1) {
    await resolveReapContest(i, state.slots[i]!, deps, config);
  }

  // Un-park idle-parked slots when the queue has work to do.
  for (let i = 0; i < state.slots.length; i += 1) {
    const slot = state.slots[i]!;
    if (!slot.idleParked || queueDepth === 0) continue;
    if (spawnPolicy === "hard-stop") continue;
    slot.idleParked = false;
    slot.spawning = true;
    try {
      const spawned = await spawnSlotForBudget(i, deps, state, drainBudget);
      if (spawned === null) continue;
      slot.pid = spawned.pid;
      slot.spawnEpoch = spawned.spawnEpoch;
      slot.stalled = false;
      slot.stallSinceEpoch = 0;
      slot.reaped = false;
    } finally {
      slot.spawning = false;
    }
    result.respawned.push(i);
    // Idle-unpark spawn: notify on_slot_spawn. Best-effort.
    if (deps.dispatchFleetHook) {
      try {
        await deps.dispatchFleetHook("on_slot_spawn", {
          event: "on_slot_spawn",
          runner: config.runner,
          slot: i,
          ...(slot.pid !== null ? { pid: slot.pid } : {}),
        });
      } catch {
        // best-effort
      }
    }
  }

  // Schedule half-open probes for circuit-tripped slots whose cooldown has expired.
  // A parked slot without a probe (halfOpen=false) transitions to half-open when
  // now - tripEpoch >= backoff(step). The probe is a normal worker spawn; its death
  // is handled by handleDeadSlot which detects the halfOpen flag.
  {
    const now = deps.now();
    for (let i = 0; i < state.slots.length; i += 1) {
      const slot = state.slots[i]!;
      if (!slot.parked || slot.halfOpen || slot.spawning) continue;
      if (spawnPolicy === "hard-stop") continue;
      if (!isHalfOpenDue(slot.tripEpoch, slot.backoffStep, now, config)) continue;
      deps.log?.(
        `circuit half-open: slot ${i} cooldown expired, spawning probe ` +
          `(backoff=${computeHalfOpenBackoff(slot.backoffStep, config)}s step=${slot.backoffStep})`,
      );
      slot.halfOpen = true;
      slot.spawning = true;
      try {
        const spawned = await spawnSlotForBudget(i, deps, state, drainBudget);
        if (spawned === null) continue;
        slot.pid = spawned.pid;
        slot.spawnEpoch = spawned.spawnEpoch;
        slot.stalled = false;
        slot.stallSinceEpoch = 0;
        slot.reaped = false;
      } finally {
        slot.spawning = false;
      }
      result.halfOpened.push(i);
      // Half-open probe spawn: notify on_slot_spawn. Best-effort.
      if (deps.dispatchFleetHook) {
        try {
          await deps.dispatchFleetHook("on_slot_spawn", {
            event: "on_slot_spawn",
            runner: config.runner,
            slot: i,
            ...(slot.pid !== null ? { pid: slot.pid } : {}),
          });
        } catch {
          // best-effort
        }
      }
    }
  }

  // Respawn / park dead non-parked, non-idle-parked, non-spawning slots.
  // `slot.spawning` guards against a duplicate spawn when the enclosing tick
  // was abandoned mid-spawnSlot by the guardedTick ceiling.
  // Also processes half-open probe deaths (parked=true, halfOpen=true).
  for (let i = 0; i < state.slots.length; i += 1) {
    const slot = state.slots[i]!;
    // Skip: open (parked but not probing), idleParked, or spawning in-flight.
    if ((slot.parked && !slot.halfOpen) || slot.idleParked || slot.spawning) continue;
    const pid = slot.pid;
    if (pid === null || !deps.proc.isAlive(pid)) {
      if (pid !== null) {
        deps.log?.(`dead slot reconciled: slot ${i} pid=${pid}`);
        await emitSupervisorEvent(deps, {
          kind: "supervisor.dead-slot-reconcile",
          payload: { slot: i, pid },
        });
      }
      // Dispatch on_slot_death before the slot is recycled. Best-effort.
      if (deps.dispatchFleetHook) {
        try {
          await deps.dispatchFleetHook("on_slot_death", {
            event: "on_slot_death",
            runner: config.runner,
            slot: i,
            ...(pid !== null ? { pid } : {}),
          });
        } catch {
          // best-effort
        }
      }
      // Capture the dead worker's iter dir BEFORE handleDeadSlot respawns the
      // slot — a respawn rebinds resolveIterDir(i) to the NEW worker's dir, so
      // the stranded claim must be snapshotted here, while it still resolves.
      const deadInfo = deps.fs.resolveIterDir(i);
      result.deaths.push(i);
      if (spawnPolicy === "hard-stop") {
        slot.pid = null;
        slot.stalled = false;
        slot.stallSinceEpoch = 0;
        slot.reaped = false;
        try {
          const reconciled = await reconcileDeadWorkerClaim(deadInfo, deps);
          if (reconciled !== null) result.crashReconciled.push(reconciled);
        } catch {
          // best-effort, same as the respawn path.
        }
        continue;
      }
      const { parked } = await handleDeadSlot(i, slot, deps, config, queueDepth, spawnPolicy);
      if (parked) {
        // A circuit-trip park already swept this slot's claimed issues
        // (sweepParkedSlot); an idle-park drained cleanly with no live claim.
        // Neither needs the crash reconcile.
        if (slot.idleParked) result.idleParked.push(i);
        else result.parked.push(i);
      } else {
        result.respawned.push(i);
        // #815: the respawn reused the slot for a NEW issue, so a worker that
        // died mid-attempt (agent finished, no terminal envelope) would leave
        // its old claim stranded in `running` forever — invisible to the drain
        // until a fleet reboot runs the boot sweep. Reconcile it here on the
        // live loop instead. Best-effort: a failure leaves it for the boot sweep.
        try {
          const reconciled = await reconcileDeadWorkerClaim(deadInfo, deps);
          if (reconciled !== null) result.crashReconciled.push(reconciled);
        } catch {
          // never let a reconcile failure abort the tick.
        }
      }
    }
  }

  // Passive stall detector + gated hard reaper.
  const reaped = await pollStallDetector(state, deps, config);
  result.reaped = reaped;

  // Reconcile dispatch: use any free slot (e.g. just stall-reaped) for a parked
  // candidate. Best-effort; a failure or absent candidate is silently skipped.
  if (spawnPolicy !== "hard-stop") {
    const reconciledSlot = await dispatchReconcileIfPossible(state, deps);
    if (reconciledSlot !== null) result.reconciledSlots.push(reconciledSlot);
  }

  // Periodic dependency Unblock Sweep (#844). The boot-time sweep and the
  // event-driven close-cascade are both best-effort; when a cascade misses an
  // unblock AND the remaining queue is all dependency-blocked, the fleet idles
  // (ready:0) → spawns no worker → the boot sweep never re-runs → the dependent
  // is stranded forever. Running the idempotent sweep here self-heals that within
  // one interval with NO worker spawn. Throttled to unblockSweepIntervalS so a
  // drained tracker costs ~no extra gh calls (the sweep itself is a single `gh
  // issue list` that short-circuits when there are no blocked:dependency issues).
  if (deps.unblockSweep) {
    const now = deps.now();
    const due =
      state.lastUnblockSweepEpoch === 0 ||
      now - state.lastUnblockSweepEpoch >= config.unblockSweepIntervalS;
    if (due) {
      // Stamp BEFORE awaiting so a slow/hung sweep can't be re-fired by the next
      // tick; the guardedTick ceiling still abandons a wedged tick independently.
      state.lastUnblockSweepEpoch = now;
      try {
        result.unblocked = await deps.unblockSweep();
      } catch {
        // Best-effort: a failed sweep is retried on the next due tick.
      }
    }
  }

  return result;
}

/**
 * terminate_all (supervisor.sh ~1036): kill every live slot worker on shutdown
 * via the wait-and-escalate killTree (SIGTERM → grace → SIGKILL → confirm), so a
 * SIGTERM-ignoring worker does not survive the supervisor's exit (#580).
 * Best-effort.
 */
export async function terminateAll(state: SupervisorState, deps: SupervisorDeps): Promise<void> {
  for (const slot of state.slots) {
    const pid = slot.pid;
    if (pid !== null && deps.proc.isAlive(pid)) {
      await deps.proc.killTree(pid);
    }
  }
}
