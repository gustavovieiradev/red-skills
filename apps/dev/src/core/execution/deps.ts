import type { RunOptions } from "@reddb-io/red-castle";
import { resolveHostEnvAllowlist } from "../host-env-allowlist.js";
import { buildAgent, type AgentFactories } from "./agent.js";
import type { SandcastleDeps } from "./types.js";

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
