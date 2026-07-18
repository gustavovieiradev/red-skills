import type { RunOptions } from "@reddb-io/red-castle";
import { COMPLETION_SIGNALS } from "@reddb-io/red-castle/engine";
import { buildLineRedactor } from "../../runtime/outbound-redaction.js";
import { AGENT_OUTPUT_CLOSE } from "../agent-output.js";
import { DEFAULT_IDLE_TIMEOUT_S, DEFAULT_MAX_ITERATIONS } from "./defaults.js";
import { DEFAULT_REMOTE, type RunAgentInput, type SandcastleDeps } from "./types.js";

/** The sandcastle `host.onWorktreeReady` hook command shape. */
type HostHookCommand = NonNullable<NonNullable<NonNullable<RunOptions["hooks"]>["host"]>["onWorktreeReady"]>[number];

/**
 * Build the single `host.onWorktreeReady` hook command that restores the AFK
 * continuous-push guarantee (issue #191) for a host-visible worktree.
 *
 * sandcastle runs `host.onWorktreeReady` ON THE HOST with cwd = the worktree it
 * just created (noSandbox worktree mode and bind-mount worktree mode), so this
 * command, in that worktree:
 *   (a) force-with-lease pushes the worker branch to the remote up-front
 *       (`push_initial`), and
 *   (b) installs a `post-commit` git hook that fire-and-forgets a push after
 *       every inner-agent commit (`install_post_commit_hook`), into an AFK-owned
 *       hooks dir the worktree's `core.hooksPath` is then pointed at — which also
 *       bypasses the consumer repo's commit-phase hooks for AFK's commits (#840).
 *
 * Every step is best-effort: a network / auth failure logs to stderr (via the
 * shell `||` fallbacks) but never returns non-zero, so the hook can NOT abort
 * the run. The post-commit hook itself ends in `|| true` for the same reason
 * (git ignores a post-commit exit status, but we belt-and-braces it).
 *
 * The hook is written with `git rev-parse --absolute-git-dir` so it lands in the
 * linked worktree's own gitdir (`afk-hooks/`) and the `core.hooksPath` redirect is
 * set `--worktree`, never leaking into the primary checkout or a sibling
 * worktree — the primary branch's hooks stay exactly as the consumer wrote them.
 */
export function buildContinuousPushHook(branch: string, remote: string): HostHookCommand {
  // Single-quoted heredoc body so the inner `$()` / `HEAD` are evaluated when
  // the post-commit hook RUNS, not when it is written. The outer `sh -c` script
  // is itself single-quoted at the call site, so embedded single quotes in the
  // heredoc are avoided; we use printf with the literal hook text instead.
  const initialPush = `git push ${remote} -u "HEAD:refs/heads/${branch}" --force-with-lease >/dev/null 2>&1 || echo "[afk] warn: initial push for ${branch} failed, continuing without remote backup" >&2`;
  // The post-commit hook content (issue #191). Written via printf so we never
  // depend on a heredoc surviving the sh -c quoting. The trailing `|| true`
  // keeps the hook a pure side-effect.
  const hookBody = [
    "#!/usr/bin/env sh",
    "# AFK continuous-push hook (issue #191)",
    "# Fire-and-forget: push the worker branch to the remote after every commit so",
    "# a SIGKILL of the orchestrator at any point preserves the diff on the remote.",
    `git push ${remote} HEAD --force-with-lease 2>/dev/null || true`,
    "",
  ].join("\n");
  // Install the post-commit hook into an AFK-OWNED hooks dir (`afk-hooks`) inside
  // the worktree's gitdir, then point the worktree's `core.hooksPath` at it (issue
  // #840). This single redirect does three things at once:
  //   (a) BYPASSES the consumer repo's commit-phase hooks (pre-commit / commit-msg
  //       / pre-push) for every AFK commit — those live in the COMMON gitdir's
  //       `hooks/`, which `core.hooksPath` now shadows; redundant with AFK's own
  //       feedback gate + backpressure + `.red/config.yaml` lifecycle hooks, and a
  //       reformat-and-restage hook would otherwise break the one-path-staged
  //       invariant (false BLOCKED).
  //   (b) KEEPS AFK's own post-commit push firing — it is the only hook in
  //       `afk-hooks`. (A linked worktree never fires hooks from its private gitdir
  //       `hooks/` — only the common dir or `core.hooksPath` — so the redirect is
  //       also what makes the issue #191 push hook actually run here.)
  //   (c) STAYS worktree-scoped via `git config --worktree`, so the primary
  //       checkout's hooks are untouched (the primary branch is sacred). We never
  //       fall back to a non-worktree `core.hooksPath`, which would leak into the
  //       common config and silence the consumer's hooks in the primary checkout.
  // The bypass is commit-phase only: this runs in `onWorktreeReady`, after
  // the worktree exists and before the inner agent starts.
  const installHook = [
    'gd=$(git rev-parse --absolute-git-dir 2>/dev/null) || gd=""',
    'if [ -n "$gd" ]; then',
    '  hd="$gd/afk-hooks"',
    '  mkdir -p "$hd" 2>/dev/null || true',
    `  printf '%s' "$HOOK_BODY" > "$hd/post-commit" 2>/dev/null && chmod 0755 "$hd/post-commit" 2>/dev/null || echo "[afk] warn: could not install post-commit hook" >&2`,
    '  git config extensions.worktreeConfig true 2>/dev/null || true',
    '  git config --worktree core.hooksPath "$hd" 2>/dev/null || echo "[afk] warn: could not redirect core.hooksPath — consumer git hooks may fire on AFK commits" >&2',
    "else",
    '  echo "[afk] warn: could not resolve .git dir — post-commit hook not installed" >&2',
    "fi",
  ].join("\n");
  // HOOK_BODY is exported inline so the heredoc-free printf above reads it. The
  // whole script is wrapped in `sh -c` and always exits 0 (best-effort).
  const script = [`HOOK_BODY=${shSingleQuote(hookBody)}`, "export HOOK_BODY", initialPush, installHook, "exit 0"].join(
    "\n",
  );
  return { command: `sh -c ${shSingleQuote(script)}` };
}

/**
 * Install the AFK-owned `commit-msg` hook that fail-closes public-output leaks
 * before an inner agent can put them in git history (#1366).
 *
 * AFK redirects `core.hooksPath` to the worktree-private `afk-hooks` directory
 * for the same reason as continuous push: consumer hooks are bypassed, but AFK
 * still owns the hooks it needs in its isolated worktree.
 */
export function buildNoLeakCommitMsgHook(): HostHookCommand {
  const hookBody = [
    "#!/usr/bin/env sh",
    "# AFK no-leak commit-msg hook (issue #1366)",
    "msg=${1:-}",
    'if [ -n "$msg" ] && grep -F "claude.ai/code/session_" "$msg" >/dev/null 2>&1; then',
    '  echo "[afk] blocked commit message: redact Claude session links as [REDACTED_CLAUDE_SESSION]" >&2',
    "  exit 1",
    "fi",
    'if [ -n "$msg" ]; then',
    "  env | while IFS='=' read -r name value; do",
    '    [ -n "$value" ] || continue',
    "    [ ${#value} -ge 8 ] || continue",
    '    upper=$(printf "%s" "$name" | tr "[:lower:]" "[:upper:]")',
    '    case "$upper" in',
    "      *TOKEN*|*SECRET*|*PASSWORD*|*APIKEY*|*API_KEY*|*API-KEY*) ;;",
    "      *) continue ;;",
    "    esac",
    '    if grep -F -- "$value" "$msg" >/dev/null 2>&1; then',
    "      exit 42",
    "    fi",
    "  done",
    "  rc=$?",
    '  if [ "$rc" -eq 42 ]; then',
    '    echo "[afk] blocked commit message: redact sensitive environment variable value as [REDACTED_SECRET]" >&2',
    "    exit 1",
    "  fi",
    "fi",
    "exit 0",
    "",
  ].join("\n");
  const installHook = [
    'gd=$(git rev-parse --absolute-git-dir 2>/dev/null) || gd=""',
    'if [ -n "$gd" ]; then',
    '  hd="$gd/afk-hooks"',
    '  mkdir -p "$hd" 2>/dev/null || true',
    `  printf '%s' "$HOOK_BODY" > "$hd/commit-msg" 2>/dev/null && chmod 0755 "$hd/commit-msg" 2>/dev/null || echo "[afk] warn: could not install commit-msg no-leak hook" >&2`,
    '  git config extensions.worktreeConfig true 2>/dev/null || true',
    '  git config --worktree core.hooksPath "$hd" 2>/dev/null || echo "[afk] warn: could not redirect core.hooksPath — AFK commit-msg guard may not fire" >&2',
    "else",
    '  echo "[afk] warn: could not resolve .git dir — commit-msg no-leak hook not installed" >&2',
    "fi",
  ].join("\n");
  const script = [`HOOK_BODY=${shSingleQuote(hookBody)}`, "export HOOK_BODY", installHook, "exit 0"].join("\n");
  return { command: `sh -c ${shSingleQuote(script)}` };
}

/** POSIX single-quote escaping: wrap in single quotes, replacing each embedded
 * single quote with the `'\''` idiom. Keeps the embedded git push / hook body
 * intact through the `sh -c '<script>'` layer. */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Build the sandcastle `run` options for one issue iteration (pure). */
export function buildRunOptions(deps: SandcastleDeps, input: RunAgentInput): RunOptions {
  // Fork the worker branch off the resolved base (ADR 0031) via sandcastle's
  // NamedBranchStrategy start point, so a pinned/locked base is the branch's
  // parent rather than HEAD. `baseBranch` is only consulted when the branch is
  // created new; the caller (process-issue) fetches the ref first so it is
  // current. Omitting `base` reverts to sandcastle's HEAD default.
  const branchStrategy: NonNullable<RunOptions["branchStrategy"]> = {
    type: "branch",
    branch: input.branch,
    ...(input.base ? { baseBranch: input.base } : {}),
  };
  // host.onWorktreeReady runs ON THE HOST in the freshly-created worktree BEFORE
  // the inner agent starts (host-visible worktree modes only). Host hooks ride
  // here, in order:
  //   1. No-leak commit-msg guard (#1366) — ALWAYS injected: reject public
  //      output leaks before they enter history.
  //   2. Continuous-push guarantee (issue #191) — injected only when enabled:
  //      push the branch up-front and install the post-commit push hook.
  // sandcastle only runs these for host-visible worktrees (noSandbox / bind-mount
  // worktree mode); for fully-isolated providers the agent works in a synced copy
  // the hooks can't see (final sync only).
  const worktreeReady: HostHookCommand[] = [buildNoLeakCommitMsgHook()];
  if (input.continuousPush) {
    worktreeReady.push(buildContinuousPushHook(input.branch, input.remote ?? DEFAULT_REMOTE));
  }
  const hooks: RunOptions["hooks"] = { host: { onWorktreeReady: worktreeReady } };
  // Observability lane (native-path liveness): point sandcastle's file-log at
  // the attempt dir's afk.log (the unified log, set by the caller) and, when a
  // sink is provided, forward each
  // agent stream event to it via `logging.onAgentStreamEvent`. sandcastle only
  // exposes the stream callback in "file" logging mode, so the callback rides
  // alongside the path. Omitting `logPath` leaves `logging` unset (sandcastle
  // default) — backward-compatible for callers/tests that don't observe.
  const logging: RunOptions["logging"] | undefined = input.logPath
    ? {
        type: "file",
        path: input.logPath,
        // Capture-time leak masking (issue #1368): every textual stream event
        // (raw line, text/reasoning message, result, tool-call args) passes
        // through the precomputed line redactor BEFORE the event sink and the
        // verbose file sink, so secrets/session links/host identity never
        // reach the firehose, heartbeat vitals, or log tails that envelopes
        // later relay. Defense-in-depth under the outbound scrubOutbound seam.
        redactLine: buildLineRedactor(),
        ...(input.onAgentEvent ? { onAgentStreamEvent: input.onAgentEvent } : {}),
      }
    : undefined;
  return {
    agent: deps.agentFor(input.runner, input.model, { effort: input.effort }),
    // Bind-mount the host attempt dir into the container at the identical path
    // (issue #405) so the proof-of-life lane + the worktree sandcastle creates
    // under it are host-visible mid-run — the precondition for arming the guard +
    // heartbeat under docker/podman. `none` ignores `mountPath` (no container).
    sandbox: deps.sandboxFor(input.sandboxMode ?? "none", input.cwd ? { mountPath: input.cwd } : undefined),
    // Re-anchor sandcastle's `.red-castle/` dir + git ops at the caller's cwd
    // (AFK's per-attempt dir under .red/) so nothing is generated at the repo
    // root. Omitted → sandcastle defaults to process.cwd().
    ...(input.cwd ? { cwd: input.cwd } : {}),
    // Deliver the handoff INLINE (verbatim), not as a `promptFile` template:
    // red-castle expands `{{KEY}}` + `` !`cmd` `` only for templates, which
    // crashed prompt resolution on opaque issue-body content (#756, #758). AFK
    // passes no promptArgs, so inline is a clean pass-through.
    prompt: input.handoffContent,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    branchStrategy,
    // Structured-output completion adapter (ADR 0090), claude-first rollout
    // (#919/#932). For the claude runner, register the `<agent-output>` closing
    // tag as an ADDITIONAL completion signal so the turn can terminate on the
    // schema-validated structured block ALONE — curing the `no-sentinel` class
    // for it — while the `<promise>` sentinels stay valid (coexistence). Every
    // other runner keeps just the sentinels until its own adoption slice lands.
    completionSignal:
      input.runner === "claude"
        ? [...COMPLETION_SIGNALS, AGENT_OUTPUT_CLOSE]
        : [...COMPLETION_SIGNALS],
    // sandcastle defaults maxIterations to 1, which stops the agent before it
    // can emit DONE (issue #322). Set a generous, env-tunable ceiling so the
    // completionSignal stays the real terminator.
    maxIterations: input.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    idleTimeoutSeconds: input.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_S,
    ...(hooks ? { hooks } : {}),
    ...(logging ? { logging } : {}),
  };
}
