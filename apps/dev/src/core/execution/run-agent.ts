import type { AgentStreamEvent, RunResult } from "@reddb-io/red-castle";
import { parseAgentOutput } from "../agent-output.js";
import { resolveHostEnvAllowlist } from "../host-env-allowlist.js";
import { DEFAULT_STALL_POLL_S, startLaneIdleReaper } from "../lane-idle-reaper.js";
import { deriveSnapshot } from "../reaper-signal.js";
import { isRunnerExhausted } from "../runner-spawn.js";
import {
  buildAgent,
  buildRunOptions,
  enforceStructuredOutput,
  interpretCompletion,
  isExhaustionError,
  isTransientRunnerError,
} from "./agent-builders.js";
import { defaultSchedule, startAttemptGuard, type AttemptProgressInfo, type AttemptTimeoutReason } from "./attempt-guard.js";
import { extractSignalKill } from "./signals.js";
import type { AgentFactories, RunAgentInput, RunAgentResult, SandcastleDeps } from "./types.js";

/**
 * Run the inner agent on the issue via sandcastle and normalise the result.
 *
 * sandcastle's `run()` can signal exhaustion two ways: by throwing an error
 * whose message matches the exhaustion patterns (the common case — the provider
 * raises on a 429 / usage-limit), or by completing with exhaustion text on
 * stdout. Both map to the `exhausted` outcome (no commits, no sentinel). A
 * transient transport / server-overload error maps to `runner-transient`; any
 * OTHER thrown error maps to `no-sentinel` (a recoverable crash) rather than
 * propagating — so an unrecognized runner failure never kills the drain or
 * orphans the issue in `running` (#767).
 *
 * When `attemptTimeoutSeconds` + `headProbe` are supplied, an attempt progress
 * guard runs alongside: if no new commit lands within the cap, the run is
 * aborted (sandcastle kills the in-flight agent, preserving the worktree) and
 * the result is the `timeout` outcome.
 */
export async function runAgent(deps: SandcastleDeps, input: RunAgentInput): Promise<RunAgentResult> {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  // FIX F: continuous-push is a host.onWorktreeReady hook, which sandcastle only
  // runs for host-visible worktrees (noSandbox / bind-mount). Under docker/podman
  // the agent works in an isolated copy the hook can't see, so the push silently
  // never fires — a SIGKILL mid-run loses every intermediate commit with no
  // backup. Surface that the resilience guarantee does not apply (behaviour
  // unchanged; advisory only).
  if (input.continuousPush && (input.sandboxMode === "docker" || input.sandboxMode === "podman")) {
    warn(
      `[afk] warn: continuous-push is unavailable under ${input.sandboxMode} isolation; ` +
        "intermediate commits are not backed up mid-run — final sync only.",
    );
  }
  // FIX J: deliver the pre_worktree hook env (e.g. CARGO_TARGET_DIR=.../slot-N)
  // to the sandcastle-spawned agent. RunOptions has no `env` field, so for the
  // default noSandbox mode — where the agent inherits this worker process's
  // env — we apply it to process.env right before the run. Each fleet worker is
  // its own process, so this is isolated per-worker. Under docker/podman the env
  // must enter the container instead (sandbox env lane) — out of scope (#284).
  for (const [k, v] of Object.entries(input.env ?? {})) process.env[k] = v;

  // Attempt progress guard (proof-of-progress): abort the run if no new commit
  // lands within the cap. Armed only when both the cap and a headProbe are
  // supplied; otherwise behaviour is unchanged.
  const now = deps.now ?? (() => Date.now());
  const makeController = deps.makeAbortController ?? (() => new AbortController());
  const schedule = deps.schedule ?? defaultSchedule;
  let guard:
    | { stop: () => void; firedTimeout: () => boolean; firedGoalMoot: () => boolean; firedBudget: () => boolean }
    | undefined;
  let timeoutReason: AttemptTimeoutReason | undefined;
  let laneReaper: { stop: () => void; firedReap: () => boolean } | undefined;
  let controller: AbortController | undefined;
  let heartbeatIntervalMs = 60_000;
  let lastHeartbeatEmitMs: number | undefined;
  const emitHeartbeat = (info: AttemptProgressInfo): void => {
    lastHeartbeatEmitMs = info.nowMs;
    input.onHeartbeat?.(info);
  };
  const pulseCodexHeartbeatFromStream = (event: AgentStreamEvent): void => {
    if (!input.onHeartbeat || input.runner !== "codex" || !input.headProbe) return;
    if (event.type === "raw" || event.type === "sessionId") return;
    const nowMs = now();
    if (lastHeartbeatEmitMs !== undefined && nowMs - lastHeartbeatEmitMs < heartbeatIntervalMs) return;
    void (async () => {
      let head: string | undefined;
      try {
        head = await input.headProbe?.();
      } catch {
        head = undefined;
      }
      emitHeartbeat({ head, lastProgressMs: nowMs, nowMs });
    })();
  };
  const agentEventSink: RunAgentInput["onAgentEvent"] | undefined =
    input.onAgentEvent || input.runner === "codex"
      ? (event) => {
          input.onAgentEvent?.(event);
          pulseCodexHeartbeatFromStream(event);
        }
      : undefined;
  if (input.attemptTimeoutSeconds && input.attemptTimeoutSeconds > 0 && input.headProbe) {
    const capMs = input.attemptTimeoutSeconds * 1000;
    heartbeatIntervalMs = Math.min(capMs, 60_000);
    controller = makeController();
    const cap = input.attemptTimeoutSeconds;
    const hardCap = input.attemptHardCapSeconds;
    guard = startAttemptGuard({
      capMs,
      intervalMs: Math.min(capMs, 60_000),
      headProbe: input.headProbe,
      ...(input.progressProbe ? { progressProbe: input.progressProbe } : {}),
      ...(hardCap && hardCap > 0 ? { hardCapMs: hardCap * 1000 } : {}),
      now,
      schedule,
      ...(input.goalProbe ? { goalProbe: input.goalProbe } : {}),
      ...(input.budget && input.budgetUsage ? { budget: input.budget, budgetUsage: input.budgetUsage } : {}),
      ...(input.budgetUsage ? { activityUsage: input.budgetUsage } : {}),
      ...(input.inspectTree ? { activeDescendantProbe: () => deriveSnapshot(input.inspectTree!()).activeDescendant } : {}),
      abort: (reason) => {
        if (reason === "stalled" || reason === "edit-loop-stall" || reason === "hard-cap") timeoutReason = reason;
        controller?.abort(
          new Error(
            reason === "goal-moot"
              ? "afk: attempt mooted — the claimed issue is already CLOSED (goal predicate, ADR 0057)"
              : reason === "budget"
                ? "afk: attempt aborted — per-attempt resource budget exceeded (#908)"
                : reason === "hard-cap"
                  ? `afk: attempt aborted — no new commit within ${hardCap}s despite worktree edits (hard cap, stalled)`
                  : reason === "edit-loop-stall"
                    ? `afk: attempt aborted — worktree diff kept changing without new high-water progress within ${cap}s (edit-loop-stall)`
                    : `afk: attempt aborted — no new commit within ${cap}s (stalled)`,
          ),
        );
      },
      // Externalized proof-of-life (PR-B): each poll fires the caller's opaque
      // heartbeat sink (firehose record + state.last_progress_at + on_heartbeat
      // hook). execution.ts stays ignorant of what it does.
      ...(input.onHeartbeat ? { onTick: emitHeartbeat } : {}),
    });
  }

  // Lane-idle stall reaper (issue #363): the solo-path port of the fleet's
  // passive stall detector + hard stall reaper. COMPLEMENTARY to the progress
  // guard above (commit-anchored) — this cuts an *idle* hang at the stall
  // threshold, gated on the same busy-predicate. Armed when both thresholds plus
  // the lane probe + tree inspector are supplied. Shares the run's
  // AbortController so a kill tears down the same inner tree; runs on its own
  // side-channel poll (independent of the inner-agent stream) so a fully-hung
  // runner is still observed.
  if (
    input.laneIdleThresholdSeconds &&
    input.laneIdleThresholdSeconds > 0 &&
    input.laneIdleKillThresholdSeconds &&
    input.laneIdleKillThresholdSeconds > 0 &&
    input.livenessVerdictProbe &&
    input.inspectTree
  ) {
    if (!controller) controller = makeController();
    const killController = controller;
    const pollS = input.laneIdlePollSeconds && input.laneIdlePollSeconds > 0 ? input.laneIdlePollSeconds : DEFAULT_STALL_POLL_S;
    laneReaper = startLaneIdleReaper({
      spawnEpoch: Math.floor(now() / 1000),
      stallThresholdS: input.laneIdleThresholdSeconds,
      stallKillThresholdS: input.laneIdleKillThresholdSeconds,
      intervalMs: pollS * 1000,
      livenessVerdict: input.livenessVerdictProbe,
      inspectTree: input.inspectTree,
      // The lane reaper reasons in epoch SECONDS; the shared clock `now` is ms.
      now: () => Math.floor(now() / 1000),
      schedule,
      abort: () =>
        killController.abort(
          new Error(`afk: attempt reaped — agent lane idle past ${input.laneIdleKillThresholdSeconds}s with no active build/test (stalled)`),
        ),
    });
  }

  let result: RunResult;
  try {
    const options = buildRunOptions(deps, agentEventSink ? { ...input, onAgentEvent: agentEventSink } : input);
    result = await deps.run(controller ? { ...options, signal: controller.signal } : options);
  } catch (error) {
    // The lane-idle reaper aborted: agent lane silent past the kill threshold
    // with no active build/test descendant + flat cpu → genuinely stuck. Map to
    // no-sentinel so it flows through the existing no-sentinel terminal policy.
    // Checked before the progress guard: an idle hang trips the faster lane layer
    // first, and "no-sentinel" is the issue-mandated outcome for a lane-idle reap.
    if (laneReaper?.firedReap()) {
      return {
        outcome: "no-sentinel",
        branch: input.branch,
        commits: [],
        stdout: `afk: attempt reaped — agent lane idle past ${input.laneIdleKillThresholdSeconds}s with no active build/test (stalled)`,
      };
    }
    // The goal predicate fired (ADR 0057): the claimed issue is already CLOSED,
    // so the attempt is moot. Surface the dedicated outcome — process-issue maps
    // it deterministically (own-merge → done, foreign close → claim-lost) without
    // a terminal envelope. Checked before the stall guard: a goal-moot abort sets
    // its own flag and firedTimeout() excludes it, so they never collide.
    if (guard?.firedGoalMoot()) {
      return {
        outcome: "goal-moot",
        branch: input.branch,
        commits: [],
        stdout: "afk: attempt mooted — the claimed issue is already CLOSED (goal predicate, ADR 0057)",
      };
    }
    // The budget guard aborted: the attempt breached a resource ceiling (#908)
    // — distinct from a stall (it may have been actively working, just too
    // expensively). Surface the dedicated `budget-exceeded` outcome so
    // process-issue salvages the partial work and parks it for a human rather
    // than blind-retrying a runaway. Checked before firedTimeout (firedTimeout
    // already excludes the budget abort, but order keeps intent explicit).
    if (guard?.firedBudget()) {
      return {
        outcome: "budget-exceeded",
        branch: input.branch,
        commits: [],
        stdout: "afk: attempt aborted — per-attempt resource budget exceeded (#908)",
      };
    }
    // The progress guard aborted: alive but not committing → stalled.
    if (guard?.firedTimeout()) {
      return {
        outcome: "timeout",
        branch: input.branch,
        commits: [],
        timeoutReason: timeoutReason ?? "stalled",
        stdout:
          timeoutReason === "edit-loop-stall"
            ? `afk: attempt aborted — worktree diff kept changing without new high-water progress within ${input.attemptTimeoutSeconds}s (edit-loop-stall)`
            : timeoutReason === "hard-cap"
              ? `afk: attempt aborted — no new commit within ${input.attemptHardCapSeconds}s despite worktree edits (hard cap, stalled)`
              : `afk: attempt aborted — no new commit within ${input.attemptTimeoutSeconds}s (stalled)`,
      };
    }
    if (isExhaustionError(error)) {
      return { outcome: "exhausted", branch: input.branch, commits: [], stdout: "" };
    }
    if (isTransientRunnerError(error)) {
      return {
        outcome: "runner-transient",
        branch: input.branch,
        commits: [],
        stdout: error instanceof Error ? error.message : String(error),
      };
    }
    // External-signal kill (#1308): the Orchestrator sets the message to
    // "${provider.name} exited with code N" when the inner process exits
    // non-zero. When N is in the 128–192 range (Unix convention: 128 +
    // signal_number), the process was killed by an OS signal — record the
    // signal name so the terminal record is actionable, distinct from a plain
    // crash. Same bounded recovery policy as `no-sentinel` (`crashed` cap).
    const signalKill = extractSignalKill(error);
    if (signalKill) {
      return {
        outcome: "signal-killed",
        branch: input.branch,
        commits: [],
        stdout: `afk: inner agent killed by ${signalKill.signal} (exit code ${signalKill.exitCode})`,
      };
    }
    // Any OTHER thrown runner error (an error class we don't yet recognize):
    // do NOT rethrow. A rethrow propagates uncaught past the per-issue loop,
    // kills the whole orchestrator mid-drain, and leaves the claimed issue
    // orphaned in `running` (the failure mode behind #766's 529 incident). Map
    // it to `no-sentinel` instead — the same outcome a crashed agent produces —
    // so the per-issue loop runs its graceful recovery: it posts a crash
    // envelope carrying this error text, rotates the label off `running`, and
    // pages `ready-for-human` (bounded by RED_AFK_RETRY_CRASH). The drain
    // survives every runner error class, known or not. (#767)
    return {
      outcome: "no-sentinel",
      branch: input.branch,
      commits: [],
      stdout: error instanceof Error ? error.message : String(error),
    };
  } finally {
    guard?.stop();
    laneReaper?.stop();
  }
  // A run that completed but surfaced exhaustion text on stdout (rather than
  // throwing) is also exhaustion — match the stdout the same way run_inner does.
  if (result.completionSignal === undefined && isRunnerExhausted(result.stdout ?? "")) {
    return { outcome: "exhausted", branch: result.branch, commits: result.commits, stdout: result.stdout };
  }
  // Structured-output completion adapter (ADR 0090): prefer a valid AgentOutput
  // block over the text sentinel. A run that emitted the structured block but no
  // sentinel now yields a definite `done`/`blocked` instead of `no-sentinel`.
  const agentOutput = parseAgentOutput(result.stdout ?? "");
  const rawOutcome = interpretCompletion(agentOutput, result.completionSignal);
  // Enforce the structured-output gate for schema-capable runners (ADR 0082,
  // #932): a claude DONE with no valid <agent-output> block is downgraded to
  // no-sentinel so the agent cannot claim success without the schema contract.
  const enforced = enforceStructuredOutput(input.runner, rawOutcome, result.stdout ?? "");
  if (enforced.rejectedReason) {
    warn(`[afk] warn: AgentOutput ${enforced.rejectedReason} — downgraded to ${enforced.outcome}`);
  }
  return {
    outcome: enforced.outcome,
    branch: result.branch,
    commits: result.commits,
    completionSignal: result.completionSignal,
    ...(agentOutput ? { agentOutput } : {}),
    stdout: result.stdout,
  };
}

/**
 * Wire the real sandcastle providers. Imported lazily so a test that only
 * exercises the pure mapping never pulls the provider subpaths, and so the
 * provider import paths are the single place coupled to the package layout.
 */
export async function defaultSandcastleDeps(): Promise<SandcastleDeps> {
  const [core, noSandboxMod, dockerMod, podmanMod] = await Promise.all([
    import("@reddb-io/red-castle"),
    import("@reddb-io/red-castle/sandboxes/no-sandbox"),
    import("@reddb-io/red-castle/sandboxes/docker"),
    import("@reddb-io/red-castle/sandboxes/podman"),
  ]);
  // FIX D / ADR 0059: the per-provider mapping (effort gating for claude/codex,
  // effort→`variant` for opencode, and the opencode auth env passthrough) lives
  // in the pure `buildAgent`, unit-tested with fake factories. Here we just
  // bind the real `core.*` factories and `process.env` — `buildAgent` reads
  // whichever of OPENAI_API_KEY / MINIMAX_API_KEY / OPENROUTER_API_KEY is set
  // (opencode-env.ts) and forwards it through `OpenCodeOptions.env`. The casts
  // narrow the shared option shape to each provider's option literal —
  // `buildAgent` only ever passes options the factory accepts.
  const warn = (m: string) => console.warn(m);
  const factories: AgentFactories = {
    claudeCode: (model, options) => core.claudeCode(model, options as Parameters<typeof core.claudeCode>[1]),
    codex: (model, options) => core.codex(model, options as Parameters<typeof core.codex>[1]),
    opencode: (model, options) => core.opencode(model, options as Parameters<typeof core.opencode>[1]),
  };
  const agentFor: SandcastleDeps["agentFor"] = (runner, model, opts) =>
    buildAgent(factories, runner, model, opts, process.env, warn);
  const sandboxFor: SandcastleDeps["sandboxFor"] = (mode, opts) => {
    // Issue #405: bind-mount the host attempt dir at the identical path so the
    // worktree sandcastle creates under it + the proof-of-life lane files are
    // host-visible in real time, arming the progress guard + heartbeat under
    // isolation. The mount uses an identity host→sandbox path so host probes
    // (branchHead / worktree diffstat) resolve the same locations the agent
    // writes. hostPath must exist (process-issue creates the attempt dir before
    // the run), else sandcastle fails fast with a clear error.
    const mounts = opts?.mountPath ? [{ hostPath: opts.mountPath, sandboxPath: opts.mountPath }] : undefined;
    if (mode === "docker") return dockerMod.docker(mounts ? { mounts } : undefined);
    if (mode === "podman") return podmanMod.podman(mounts ? { mounts } : undefined);
    // Host-env minimization (issue #1368): the agent process inherits only the
    // allowlisted host env (shell basics, ssh/git/gh, agent auth, RED_*, the
    // language toolchains) — never the full process.env with unrelated host
    // secrets. RED_AFK_HOST_ENV_ALLOW extends the list; the literal `*`
    // disables minimization (pre-#1368 behavior). Per-attempt env delivered by
    // mutating process.env (the FIX J lane) stays visible because those keys
    // (CARGO*, RED_*) are allowlisted.
    const hostEnvAllowlist = resolveHostEnvAllowlist(process.env);
    return noSandboxMod.noSandbox(hostEnvAllowlist ? { hostEnvAllowlist } : undefined);
  };
  return { run: core.run as SandcastleDeps["run"], agentFor, sandboxFor, warn };
}
