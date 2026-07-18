import type { AgentStreamEvent, LivenessVerdict, RunOptions, RunResult } from "@reddb-io/red-castle";
import type { AgentOutput } from "../agent-output.js";
import type { AttemptBudget, AttemptBudgetUsage, AttemptProgressInfo, AttemptTimeoutReason } from "./attempt-guard.js";
import type { AgentEffort, AgentOutcome, AgentRunner, SandboxMode } from "./signals.js";

export interface RunAgentInput {
  /** Which agent provider to drive. */
  runner: AgentRunner;
  /** Model id passed to the provider (e.g. "claude-opus-4-8", "gpt-5.4"). */
  model: string;
  effort?: AgentEffort;
  /**
   * Path to the materialised handoff file. Still written to disk (worktree-wipe
   * survival + post-mortem + the `current.handoff` state pointer), but NO LONGER
   * the agent prompt — see {@link RunAgentInput.handoffContent}.
   */
  handoffPath: string;
  /**
   * The verbatim handoff text, delivered to red-castle as an **inline** prompt
   * (`prompt`, source `"inline"`) rather than a `promptFile` template (#758).
   *
   * red-castle runs `{{KEY}}` substitution **and** `` !`command` `` shell
   * expansion on `promptFile` templates, so any issue body carrying a literal
   * `{{…}}` (→ "no matching value" PromptError) or a code span ending in `!`
   * (Rust macros → false `` !` `` shell-exec, #756) crashed prompt resolution
   * before iteration 1 and orphaned the issue in `running`. AFK handoffs are
   * opaque text that never intends either feature, so inline delivery (which
   * red-castle passes through verbatim) is immune to the whole class.
   */
  handoffContent: string;
  /**
   * The AFK exit-protocol contract, delivered as a system prompt rather than
   * appended to the handoff body. red-castle picks the per-CLI delivery: claude
   * `--append-system-prompt` (a real system prompt, out of the user turn);
   * codex/opencode prepend it to the handoff content (no flag exists). Omitted →
   * no contract delivered.
   */
  systemPrompt?: string;
  /** The worker branch sandcastle commits land on (afk/{id}/{N}-{slug}). */
  branch: string;
  /**
   * The remote-tracking ref for the resolved base (e.g. `origin/main`, ADR 0031)
   * the worker branch is forked from. Passed to sandcastle's NamedBranchStrategy
   * `baseBranch` start point so the branch's parent is the freshly-fetched base,
   * not the potentially-stale local branch. process-issue populates this as
   * `${remote}/${base}` after calling `fetchBase`, so the ref is guaranteed current.
   * Sandcastle only honours it when the branch is created new. Defaults to HEAD
   * when omitted.
   */
  base?: string;
  /** Isolation: "none" (default, node-only) | "docker" | "podman". */
  sandboxMode?: SandboxMode;
  /**
   * Absolute host anchor for sandcastle's `.red-castle/` dir + git operations.
   * AFK sets this to the attempt dir so nothing lands at the repo root
   * (everything under .red/). Defaults to process.cwd() in sandcastle when
   * omitted. NOTE: sandcastle resolves `promptFile` against process.cwd(), NOT
   * against `cwd` — so `handoffPath` must stay absolute whenever this is set
   * (AFK's attempt dir is always absolute, so the handoff path already is).
   */
  cwd?: string;
  idleTimeoutSeconds?: number;
  /**
   * The git remote the worker branch is continuously pushed to (issue #191).
   * Only consulted when `continuousPush` is true. Defaults to "origin" — the
   * shell port hard-coded `origin`, so the remote name is the push target, not
   * a `git -C` repo.
   */
  remote?: string;
  /**
   * Restore the AFK continuous-push guarantee (issue #191): when true,
   * `buildRunOptions` injects a sandcastle `host.onWorktreeReady` hook that, in
   * the freshly-created worktree ON THE HOST, (a) force-with-lease pushes the
   * worker branch to the remote up-front and (b) installs a `post-commit` git
   * hook that fire-and-forgets a push after every inner-agent commit — exactly
   * the shell `push_initial` + `install_post_commit_hook` behaviour. So a
   * SIGKILL anywhere mid-iteration preserves the diff on the remote.
   *
   * Off by default: the legacy path (push once after a DONE run) is preserved
   * unless the caller opts in.
   */
  continuousPush?: boolean;
  /**
   * The sandcastle Orchestrator re-invocation ceiling (issue #322). sandcastle
   * defaults this to 1, which stops the inner agent before it can emit DONE;
   * AFK overrides it so the agent iterates until its completionSignal. Omitted →
   * `buildRunOptions` applies {@link DEFAULT_MAX_ITERATIONS}. `makeRunAgent`
   * threads the RED_AFK_MAX_ITERATIONS env override in here when set.
   */
  maxIterations?: number;
  /**
   * Extra environment variables the spawned agent must inherit (FIX J). The
   * `pre_worktree` lifecycle hook (process-issue) computes a mutable `env` slice
   * — the built-in cargo/gradle defaults set `CARGO_TARGET_DIR=.../slot-N` for
   * per-slot build isolation so parallel fleet workers don't deadlock on one
   * target dir. `RunOptions` has NO `env` field, so AFK applies this onto its own
   * `process.env` immediately before the sandcastle `run()` call.
   *
   * MECHANISM / LIMITATION: this is correct ONLY for the default `noSandbox`
   * mode, where the sandcastle-spawned agent inherits the AFK worker process's
   * `process.env` (each fleet worker is its own process, so the mutation is
   * isolated per-worker). Under docker/podman isolation the agent runs in a
   * container that does NOT inherit `process.env`; delivering this env into the
   * container (the sandbox env lane) is out of scope here. Runtime confirmation
   * that the agent's build actually sees CARGO_TARGET_DIR is pending #284.
   */
  env?: Record<string, string>;
  /**
   * Absolute path sandcastle drains its own file-log to (the `logging.path` of
   * the "file" mode). AFK points this at the attempt dir's `afk.log` — our ONE
   * canonical log — so red-castle's setup narration (worktree / sandbox / deps)
   * AND the inner agent's formatted stream land in the same file as the heartbeat
   * lines, under `.red/`. (Was a separate `sandcastle.log`; unified so the log is
   * never empty during setup.)
   * Required to enable {@link onAgentEvent}: sandcastle only surfaces the stream
   * callback in log-to-file mode. Omitted → `buildRunOptions` leaves `logging`
   * unset and sandcastle uses its default location.
   */
  logPath?: string;
  /**
   * Observability seam restoring the agent-lane liveness signal on the native
   * path (the shell era tee'd inner-agent stdout into the lanes; sandcastle now
   * captures the stream itself). When set together with {@link logPath},
   * `buildRunOptions` wires it into sandcastle's `logging.onAgentStreamEvent`,
   * yielding one callback per text chunk / tool call. process-issue forwards
   * each event to `agent.log.toonl` (the clean lane `reaper-signal` /
   * `supervisor-fs` read for liveness) + the firehose — without it the lanes'
   * mtime freezes at iteration start and the stall detector / monitor go blind
   * to a live agent. sandcastle swallows any error this callback throws.
   */
  onAgentEvent?: (event: AgentStreamEvent) => void;
  /**
   * Attempt wall-clock guard cap in seconds (proof-of-progress). When set,
   * `runAgent` aborts the sandcastle run if no NEW commit appears on the worker
   * branch within this window, resetting on each commit. Omitted → no guard
   * (back-compat for callers/tests that don't opt in). See
   * {@link DEFAULT_ATTEMPT_TIMEOUT_S}.
   */
  attemptTimeoutSeconds?: number;
  /**
   * Commit-anchored HARD cap in seconds (issue #637): bounds how long the
   * edit-signal (`progressProbe`) may keep extending the soft deadline past the
   * last commit. Only meaningful when the guard is armed. Omitted → soft cap
   * only (back-compat). See {@link DEFAULT_ATTEMPT_HARD_CAP_S}.
   */
  attemptHardCapSeconds?: number;
  /**
   * Returns the current HEAD sha of the worker branch (the progress signal the
   * guard watches). Best-effort: resolves `undefined` on any git failure, which
   * the guard treats as "no progress observed". Required for the guard to arm.
   */
  headProbe?: () => Promise<string | undefined>;
  /**
   * Returns a monotone-ish "work volume" for the worker's worktree — the total
   * changed lines (added + removed) vs the merge-base, committed AND uncommitted.
   * The guard treats a CHANGE in this value between polls as progress and resets
   * the deadline, so a runner that edits without committing (codex emits DONE
   * only at the end) is not falsely stalled while it is actively producing code.
   * Best-effort: resolves `undefined` on any failure (no edit signal → the guard
   * falls back to the commit-anchored `headProbe` alone — the prior behaviour).
   * Optional: when absent, the guard is purely commit-anchored (ADR 0044).
   */
  progressProbe?: () => Promise<number | undefined>;
  /**
   * Externalized proof-of-life sink (PR-B): invoked once per attempt-guard poll
   * with the progress signal. Opaque to execution.ts — the caller (processIssue)
   * uses it to fire the `on_heartbeat` hook + emit the heartbeat record/state.
   * Only fires when the guard is armed (cap + headProbe present).
   */
  onHeartbeat?: (info: AttemptProgressInfo) => void;
  /**
   * Per-attempt resource budget (#908). When supplied alongside `budgetUsage`,
   * the attempt guard aborts with the `budget-exceeded` outcome once any ceiling
   * is breached. Rides the existing guard poll, so it is active whenever the
   * progress guard is armed (cap + headProbe). Omitted → no budget cap.
   */
  budget?: AttemptBudget;
  /** Sync probe returning the attempt's cumulative usage (the activity meter's
   * `peek()`), read each guard poll to evaluate `budget` and to treat live
   * tool/text activity as productive progress for the soft timeout. */
  budgetUsage?: () => AttemptBudgetUsage;
  /**
   * Goal predicate (ADR 0057): reads the claimed issue's CLOSED state on the
   * existing attempt-guard poll (one issue-state read per tick). When it resolves
   * `true` the attempt is aborted as moot and `runAgent` returns the `goal-moot`
   * outcome (process-issue maps it: own-merge → done, foreign → claim-lost). Only
   * fires when the guard is armed (cap + headProbe present). Omitted → disabled.
   */
  goalProbe?: () => Promise<boolean | undefined>;
  /**
   * Lane-idle stall reaper (issue #363) — the solo-path port of the fleet's
   * passive stall detector + hard stall reaper. COMPLEMENTARY to the #400
   * attempt PROGRESS guard above (which is commit-anchored and caps the whole
   * attempt): this cuts an *idle* hang at the stall threshold (minutes) rather
   * than only at the progress cap, gated on the same busy-predicate so a worker
   * mid-build/test is never killed. Armed only when all of `laneIdleThresholdSeconds`,
   * `laneIdleKillThresholdSeconds`, `laneMtimeProbe`, and `inspectTree` are
   * supplied (no-sandbox only — see `makeRunAgent`). On a kill verdict the run is
   * aborted (sandcastle SIGTERM/SIGKILLs the inner tree) and the outcome is
   * `no-sentinel`, flowing through the existing no-sentinel terminal policy
   * (envelope + label rotation + worktree teardown).
   */
  laneIdleThresholdSeconds?: number;
  /** Lane-idle hard-reap threshold (RED_AFK_STALL_KILL_THRESHOLD_S). Must be
   * strictly greater than `laneIdleThresholdSeconds` — validated at boot by the
   * caller (resolveLaneIdleStallConfig). */
  laneIdleKillThresholdSeconds?: number;
  /** Lane-idle poll cadence in seconds (RED_AFK_STALL_POLL_S). Omitted →
   * DEFAULT_STALL_POLL_S. */
  laneIdlePollSeconds?: number;
  /**
   * Red-castle liveness evaluator verdict probe (ADR 0083 §3). Returns the
   * combined lane-recency + process-cross-check verdict from the attempt's
   * `liveness.lane.jsonl` — the un-poisonable signal (#1022). Required to arm
   * the lane-idle reaper.
   */
  livenessVerdictProbe?: () => LivenessVerdict | null;
  /**
   * Inner-agent process-tree snapshot for the lane-idle reaper's busy-predicate
   * (reduced by deriveSnapshot). Required to arm the reaper. The real wiring
   * (runtime/proc-tree.ts) is safe-by-default — a failed `ps` reports busy, so a
   * flaky inspection can never authorise a kill.
   */
  inspectTree?: () => readonly import("../reaper-signal.js").ProcessSnapshotEntry[];
}

/** The git remote the continuous-push hook targets when none is supplied. */
export const DEFAULT_REMOTE = "origin";

export interface RunAgentResult {
  outcome: AgentOutcome;
  branch: string;
  commits: readonly { sha: string }[];
  completionSignal?: string;
  timeoutReason?: AttemptTimeoutReason;
  /**
   * The validated structured completion (ADR 0082) when the agent emitted a
   * well-formed `<agent-output>` block. Carries `summary`, `key_changes_made`,
   * and `key_learnings` for the PR body / audit trail / memory ingestion, plus
   * the `should_fully_stop` outer-loop signal. Absent when the run completed via
   * the text sentinel alone (the coexistence fallback).
   */
  agentOutput?: AgentOutput;
  stdout: string;
}


/** Provider factories + the sandcastle `run` entrypoint, injected for testing. */
export interface SandcastleDeps {
  run: (options: RunOptions) => Promise<RunResult>;
  agentFor: (runner: AgentRunner, model: string, opts?: { effort?: AgentEffort }) => RunOptions["agent"];
  /**
   * Build the sandbox provider for a mode. `opts.mountPath` (issue #405) is the
   * absolute host attempt dir: under docker/podman it is added as a bind-mount at
   * the identical path inside the container so the attempt dir's proof-of-life
   * lane (afk.state.toon / agent.log.toonl / log.toonl) AND the worktree
   * sandcastle creates under it are host-visible in real time — the precondition
   * for arming the progress guard + heartbeat under isolation. Ignored for the
   * host-native `none` mode (no container to mount into).
   */
  sandboxFor: (mode: SandboxMode, opts?: { mountPath?: string }) => RunOptions["sandbox"];
  /**
   * Optional warn sink for degrade-safe diagnostics (FIX D effort drop, FIX F
   * continuous-push-under-isolation notice). Defaults to `console.warn` in the
   * real wiring; tests inject a recorder. Never throws — these are advisories.
   */
  warn?: (message: string) => void;
  /** Injectable clock (ms) for the attempt guard. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Injectable periodic scheduler for the attempt guard — runs `fn` every `ms`
   * and returns a cancel function. Defaults to a `setInterval` wrapper (with
   * `unref` so it never keeps the process alive). Tests inject a manual pump.
   */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Injectable `AbortController` factory for the attempt guard. Defaults to
   * `() => new AbortController()`. */
  makeAbortController?: () => AbortController;
}

/**
 * The subset of the sandcastle package surface `buildAgent` needs — the three
 * provider factories AFK can drive. Injected so the runner→provider mapping
 * (model slug, effort/variant gating, auth env passthrough) is unit-testable
 * with fakes, without importing the package (which pulls real provider deps).
 * `defaultSandcastleDeps` supplies the real `core.{claudeCode,codex,opencode}`.
 */
export interface AgentFactories {
  claudeCode: (model: string, options?: { effort?: AgentEffort; env?: Record<string, string> }) => RunOptions["agent"];
  codex: (model: string, options?: { effort?: AgentEffort }) => RunOptions["agent"];
  opencode: (model: string, options?: { variant?: string; env?: Record<string, string> }) => RunOptions["agent"];
}
