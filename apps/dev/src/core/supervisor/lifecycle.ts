import { encode as encodeToon } from "@reddb-io/toon";
import { decideReaperSignal, deriveSnapshot } from "../reaper-signal.js";
import { dispose } from "../disposition.js";
import { validateIssueLifecycleTransition } from "../issue-lifecycle.js";
import { LABEL_CONTESTED, LABEL_HUMAN, LABEL_READY, LABEL_RUNNING, LABEL_RUNNER_ERROR } from "../triage-labels.js";
import { computeHalfOpenBackoff } from "../slot-circuit.js";
import { SUPERVISOR_DEFAULTS, type SupervisorConfig } from "./config.js";
import type { IterDirInfo, ReconcileCandidate, SpawnPolicy, SupervisorDeps } from "./contracts.js";
import { buildDiscardEnvelope, buildReaperEnvelope, reconcileDeadWorkerClaim } from "./envelopes.js";
import { recordDeath } from "./health.js";
import { type SlotState, type SupervisorState } from "./state.js";

/**
 * sweep_parked_slot (supervisor.sh ~767): the circuit-trip sweep. Idempotent
 * per slot via SlotState.swept. For each claimed issue an affected worker held:
 * ensure the runner-error label, post a discard envelope, and rotate labels
 * (+ready-for-agent +runner-error -ready-for-human -running). Every iter dir
 * the parked slot's workers held is removed regardless of claim. A sweep with
 * no observed workers, or with workers that never claimed, posts no envelope and
 * edits no labels but still cleans iter dirs.
 */
export async function sweepParkedSlot(
  slot: number,
  state: SlotState,
  deps: SupervisorDeps,
  config: Pick<SupervisorConfig, "runner">,
): Promise<void> {
  if (state.swept) return;
  state.swept = true;

  // state.pid is the last dead worker's PID — the fs layer uses it as a
  // fallback when the slot log has no boot-stamp (native fleet path).
  const work = deps.fs.parkedSlotWork(slot, state.pid);
  const workerIdsCsv = work.workers.map((w) => w.workerId).join(",");
  // Real fast-death count lives in the circuit ring at the time of the trip,
  // not in the FS layer (which has no visibility into the breaker state).
  const fastDeaths = state.deaths.length;

  // Dispatch on_circuit_trip with the sweep context (slot, worker-ids, death
  // count, supervisor log). Best-effort: hook failure never blocks the sweep.
  if (deps.dispatchFleetHook) {
    try {
      await deps.dispatchFleetHook("on_circuit_trip", {
        event: "on_circuit_trip",
        runner: config.runner,
        slot,
        ...(state.pid !== null ? { pid: state.pid } : {}),
        ...(workerIdsCsv.length > 0 ? { worker_ids: workerIdsCsv } : {}),
        death_count: fastDeaths,
        supervisor_log: work.supervisorLogPath,
      });
    } catch {
      // best-effort
    }
  }

  if (work.workers.length === 0) return;

  const hasAnyClaim = work.workers.some((w) => w.pairs.some((p) => p.issue !== null));
  if (hasAnyClaim) await deps.gh.ensureRunnerErrorLabel();

  for (const worker of work.workers) {
    for (const pair of worker.pairs) {
      if (pair.issue !== null) {
        const body = buildDiscardEnvelope(
          config.runner,
          slot,
          workerIdsCsv,
          fastDeaths,
          work.supervisorLogPath,
        );
        await deps.gh.comment(pair.issue, body);
        await deps.gh.editLabels(
          pair.issue,
          [LABEL_READY, LABEL_RUNNER_ERROR],
          [LABEL_HUMAN, LABEL_RUNNING],
        );
      }
      await deps.fs.removeDir(pair.dir);
    }
  }
}

/**
 * reap_stalled_slot (supervisor.sh ~868): hard-reap a slot silent past the kill
 * threshold. Idempotent per slot via SlotState.reaped. Order (every step
 * best-effort past the kill):
 *   1. kill_tree the orchestrator when alive.
 *   2. Free the slot bookkeeping so the next tick respawns it.
 *   3. When an issue number was recovered: post a no-sentinel envelope and
 *      rotate labels back (+ready-for-agent -running).
 *   4. Tear down worktree + iter dir.
 * A worker that died pre-claim (issue null) still kills, frees the slot, and
 * tears down the dir, but posts no envelope and rotates no labels.
 */
export async function reapStalledSlot(
  slot: number,
  state: SlotState,
  deps: SupervisorDeps,
  config: Pick<SupervisorConfig, "reapContestWindowS"> = SUPERVISOR_DEFAULTS,
): Promise<void> {
  if (state.reaped) return;
  state.reaped = true;

  const orchPid = state.pid;
  const info = deps.fs.resolveIterDir(slot);

  // 1. kill_tree the orchestrator — SIGTERM, grace, SIGKILL, confirm exit.
  // `confirmedDead` gates the destructive teardown in step 4: a worker already
  // gone (no pid / not alive) is trivially dead; otherwise we trust killTree's
  // confirmation. Only a definitive `false` (survived SIGKILL) blocks teardown.
  let confirmedDead = true;
  if (orchPid !== null && deps.proc.isAlive(orchPid)) {
    const killed = await deps.proc.killTree(orchPid);
    confirmedDead = killed !== false;
  }

  // 2. Free the slot — next tick respawns it even if cleanup below fails.
  state.pid = null;
  state.stalled = false;
  state.stallSinceEpoch = 0;

  // 3. Envelope + BOUNDED re-claim routing (only with a recovered issue number).
  // The stall-reaper is now capped (#402): it asks recovery.ts whether this
  // attempt may retry. While under the `stalled` cap it rotates back to
  // ready-for-agent CLEAN — no `blocked:*` label rides along, so a re-queued issue
  // never trips the adoption-doctor's "ready-for-agent + blocked:*" hygiene check.
  // Once the cap is exhausted it escalates to ready-for-human carrying
  // `blocked:stalled` (created on the fly) plus a self-explanatory page comment,
  // exactly like the per-issue routeRecovery escalation.
  if (info && info.issue !== null) {
    await deps.gh.comment(info.issue, buildReaperEnvelope(info));
    // The composer owns the bounded re-claim decision + label sets + the
    // budget-exhausted page comment (core/disposition, total map → `stalled` is
    // recoverable, #402). gh.editLabels here is the (issue, add, remove) shape,
    // so the descriptor's (remove, add) sets are applied swapped.
    const disp = dispose("stalled", info.attempt, deps.recoveryEnv ?? {});
    if (disp.decision === "retry") {
      const opened = await openReapContest(slot, state, info, deps, config.reapContestWindowS);
      if (!opened) {
        // CLEAN re-queue: no blocked:* tag rides a re-queued issue.
        await deps.gh.editLabels(info.issue, disp.addLabels, disp.removeLabels);
      }
    } else {
      if (disp.typedLabel !== null) await deps.gh.ensureLabel(disp.typedLabel);
      // Escalation also sheds any stale ready-for-agent — the reaped slot was
      // `running`, never re-queue it. (Context-specific to the reaper; the
      // per-issue routeRecovery only removes `running`.)
      await deps.gh.editLabels(info.issue, disp.addLabels, [...disp.removeLabels, LABEL_READY]);
      if (disp.escalationComment !== null) {
        await deps.gh.comment(info.issue, disp.escalationComment);
      }
    }
  }

  // 4. Teardown — only once the worker is confirmed dead, so the `rm -rf` of the
  // worktree never races a still-live worker still writing into it (#580). A
  // worker that survived SIGKILL leaks its worktree (cleaned up on the next boot
  // sweep), which is strictly safer than corrupting a live checkout.
  if (info && confirmedDead) await deps.fs.teardownIterDir(info);
}

async function branchHeadForContest(deps: SupervisorDeps, branch: string): Promise<string | undefined> {
  try {
    return await deps.attemptBranchHead?.(branch);
  } catch {
    return undefined;
  }
}

function logReapContest(
  deps: SupervisorDeps,
  event: "opened" | "reclaimed" | "expired",
  details: Record<string, string | number | undefined>,
): void {
  deps.log?.(
    encodeToon({
      schema_version: "red.afk.reap_contest.v1",
      event,
      ...details,
    }),
  );
}

async function openReapContest(
  slot: number,
  state: SlotState,
  info: IterDirInfo,
  deps: SupervisorDeps,
  windowS: number,
): Promise<boolean> {
  if (info.issue === null || !info.branch || windowS <= 0) return false;
  const openedEpoch = deps.now();
  const deadlineEpoch = openedEpoch + windowS;
  const headAtReap = await branchHeadForContest(deps, info.branch);

  validateIssueLifecycleTransition({
    edge: "contest",
    fromLabels: [LABEL_RUNNING],
    removeLabels: [],
    addLabels: [LABEL_CONTESTED],
  });
  await deps.gh.editLabels(info.issue, [LABEL_CONTESTED], []);
  state.contest = {
    issue: info.issue,
    branch: info.branch,
    headAtReap,
    openedEpoch,
    deadlineEpoch,
  };
  logReapContest(deps, "opened", {
    slot,
    issue: info.issue,
    branch: info.branch,
    head_at_reap: headAtReap,
    deadline_epoch: deadlineEpoch,
  });
  return true;
}

export type ReapContestResolution = "pending" | "reclaimed" | "expired" | null;

export async function resolveReapContest(
  slot: number,
  state: SlotState,
  deps: SupervisorDeps,
  _config: Pick<SupervisorConfig, "reapContestWindowS"> = SUPERVISOR_DEFAULTS,
): Promise<ReapContestResolution> {
  const contest = state.contest;
  if (contest === null) return null;

  const now = deps.now();
  const currentHead = await branchHeadForContest(deps, contest.branch);
  if (
    now <= contest.deadlineEpoch &&
    contest.headAtReap !== undefined &&
    currentHead !== undefined &&
    currentHead !== contest.headAtReap
  ) {
    validateIssueLifecycleTransition({
      edge: "contest-reclaimed",
      fromLabels: [LABEL_RUNNING, LABEL_CONTESTED],
      removeLabels: [LABEL_CONTESTED],
      addLabels: [],
    });
    await deps.gh.editLabels(contest.issue, [], [LABEL_CONTESTED]);
    state.contest = null;
    logReapContest(deps, "reclaimed", {
      slot,
      issue: contest.issue,
      branch: contest.branch,
      head_at_reap: contest.headAtReap,
      head_at_resolution: currentHead,
    });
    return "reclaimed";
  }

  if (now < contest.deadlineEpoch) return "pending";

  validateIssueLifecycleTransition({
    edge: "contest-expired",
    fromLabels: [LABEL_RUNNING, LABEL_CONTESTED],
    removeLabels: [LABEL_RUNNING, LABEL_CONTESTED],
    addLabels: [LABEL_READY],
  });
  await deps.gh.editLabels(contest.issue, [LABEL_READY], [LABEL_RUNNING, LABEL_CONTESTED]);
  state.contest = null;
  logReapContest(deps, "expired", {
    slot,
    issue: contest.issue,
    branch: contest.branch,
    head_at_reap: contest.headAtReap,
    head_at_resolution: currentHead,
  });
  return "expired";
}

/**
 * pollStallDetector (supervisor.sh ~611): sample every non-parked slot. Flag /
 * clear the stall bit from the agent-lane mtime vs the stall threshold, then —
 * for a slot silent past the kill threshold and not yet reaped — gate the
 * irreversible kill behind the reaper-signal predicate. The kill fires only
 * when decideReaperSignal returns "kill" (idle past threshold AND no active
 * build/test descendant AND flat cpu); a busy worker is left alone. Composes
 * deriveSnapshot + decideReaperSignal — never re-implements them.
 */
export async function pollStallDetector(
  state: SupervisorState,
  deps: SupervisorDeps,
  config: Pick<SupervisorConfig, "stallThresholdS" | "stallKillThresholdS" | "runner" | "reapContestWindowS">,
): Promise<number[]> {
  const now = deps.now();
  const reaped: number[] = [];

  for (let i = 0; i < state.slots.length; i += 1) {
    const slot = state.slots[i]!;
    if (slot.parked || slot.idleParked) continue;

    // Skip freshly-spawned slots (startup window: same guard as old computeStalled).
    if (!(slot.spawnEpoch > 0) || !(now - slot.spawnEpoch >= config.stallThresholdS)) continue;

    // Evaluator verdict: stale lane + no live descendants → stalled. Live
    // descendants → alive even when the lane is silent (wedged substrate guard).
    const verdict = deps.fs.workerLivenessVerdict(i, config.stallThresholdS * 1000);
    const flagged = verdict !== null && verdict.status === "stalled";

    if (flagged) {
      if (!slot.stalled) {
        slot.stalled = true;
        // Anchor the stall window to the last observed lane activity. When the
        // lane record age is known, compute the epoch; otherwise anchor to now.
        const stallSince =
          verdict.laneAgeMs !== undefined
            ? now - Math.round(verdict.laneAgeMs / 1000)
            : now;
        slot.stallSinceEpoch = stallSince;
        // Dispatch on_stall_detected on first detection. Best-effort.
        if (deps.dispatchFleetHook) {
          try {
            await deps.dispatchFleetHook("on_stall_detected", {
              event: "on_stall_detected",
              runner: config.runner,
              slot: i,
              ...(slot.pid !== null ? { pid: slot.pid } : {}),
              stall_since: stallSince,
              idle_seconds:
                verdict.laneAgeMs !== undefined ? Math.round(verdict.laneAgeMs / 1000) : 0,
            });
          } catch {
            // best-effort
          }
        }
      }
      // Hard-reap escalation: candidacy alone is not death — gate the kill.
      const since = slot.stallSinceEpoch;
      if (since > 0 && now - since >= config.stallKillThresholdS && !slot.reaped) {
        const orchPid = slot.pid;
        const snapshot =
          orchPid !== null
            ? deriveSnapshot(deps.proc.inspectTree(orchPid))
            : { activeDescendant: false, cpuPct: 0 };
        const decision = decideReaperSignal({
          idleSeconds: now - since,
          idleThresholdSeconds: config.stallKillThresholdS,
          activeDescendant: snapshot.activeDescendant,
          cpuPct: snapshot.cpuPct,
        });
        if (decision === "kill") {
          // Dispatch on_stall_reap as a veto gate: a non-zero exit from any
          // command cancels the kill for this pass so a worker mid a long
          // build/test is not reaped unfairly. Best-effort: a hook throw is
          // treated as no-veto so the gate can never be silently disabled.
          let vetoed = false;
          if (deps.dispatchFleetHook) {
            try {
              const fleetResult = await deps.dispatchFleetHook("on_stall_reap", {
                event: "on_stall_reap",
                runner: config.runner,
                slot: i,
                ...(orchPid !== null ? { pid: orchPid } : {}),
                idle_seconds: now - since,
                stall_since: since,
              });
              vetoed = fleetResult.vetoed;
            } catch {
              // best-effort: hook throw → treat as no-veto
            }
          }
          if (!vetoed) {
            await reapStalledSlot(i, slot, deps, config);
            reaped.push(i);
          }
        }
      }
    } else if (slot.stalled) {
      slot.stalled = false;
      slot.stallSinceEpoch = 0;
    }
  }

  return reaped;
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
