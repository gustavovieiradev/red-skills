import type { RunOptions } from "@reddb-io/red-castle";
import { RUNNER_SPECS } from "../runner-spec.js";
import type { AgentEffort, AgentRunner } from "./types.js";

// The per-provider accepted-effort sets + the full RUNNER_SPECS policy table now
// live in `runner-spec.ts` (issue #823) — the single seam for per-runner provider
// policy. Re-exported here so existing `execution.ts` importers keep working.
/**
 * Validate a requested effort against a provider's accepted set ({@link
 * RUNNER_SPECS}). Returns the effort when accepted, or `undefined` when it must
 * be dropped (degrade to the provider default). Pure — the warn is emitted by
 * the caller (`buildAgent`).
 */
export function effortForProvider(
  runner: AgentRunner,
  effort: AgentEffort | undefined,
): AgentEffort | undefined {
  if (effort === undefined) return undefined;
  return RUNNER_SPECS[runner].efforts.includes(effort) ? effort : undefined;
}

/**
 * @deprecated Retained for source-level back-compat with the #626 contract; the
 * env-precedence resolver (`opencode-env.ts`) is the source of truth now. New
 * callers should use `OPENCODE_AUTH_ENV_PRECEDENCE` from there.
 */
export const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";

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

/**
 * Map a runner+model+effort to a sandcastle agent provider, reading any provider
 * env passthrough from `env`. Pure: the package factories and the environment are
 * injected.
 *
 * - **claude / codex**: the requested effort is gated per provider (FIX D, see
 *   {@link effortForProvider}); an out-of-range value is DROPPED to the provider
 *   default with a warn rather than cast through to a runtime rejection. It is
 *   passed as the provider's numeric `effort` option.
 * - **opencode** (ADR 0059, amended): the model is `<provider>/<model>` where
 *   the leading segment tells OpenCode which endpoint to dispatch to
 *   (`openrouter/...`, `openai/...`, `minimax/...`, …). AFK's effort maps to
 *   OpenCode's `variant` (its own reasoning knob — a free-form string,
 *   distinct from the numeric effort the other two take), so no gating
 *   applies. The auth key — whichever precedence entry is set, see
 *   `opencode-env.ts` — is delivered through `OpenCodeOptions.env` (the auth
 *   seam). When NO auth env-var is set, no `env` option is added; OpenCode
 *   falls back to its own default lookup and surfaces its own auth error if no
 *   key is available through any other channel.
 */
export function buildAgent(
  factories: AgentFactories,
  runner: AgentRunner,
  model: string,
  opts: { effort?: AgentEffort } | undefined,
  env: NodeJS.ProcessEnv,
  warn?: (message: string) => void,
): RunOptions["agent"] {
  const spec = RUNNER_SPECS[runner];
  const requested = opts?.effort;
  const authEnv = spec.resolveAuthEnv?.(env);

  // opencode (ADR 0059): the effort is OpenCode's free-form `variant` (not
  // gated), and the model `<provider>/<model>` slug is forwarded verbatim — the
  // leading segment tells OpenCode which endpoint to dispatch to. The auth key
  // (precedence owned by opencode-env.ts) rides in on `OpenCodeOptions.env`;
  // with no key set, no `env` option is added and OpenCode owns the fallback.
  if (spec.channel === "variant") {
    const options: { variant?: string; env?: Record<string, string> } = {};
    if (requested !== undefined) options.variant = requested;
    if (authEnv) options.env = authEnv;
    return factories.opencode(model, Object.keys(options).length > 0 ? options : undefined);
  }

  // effort channel (claude / codex / claude-minimax): gate the requested effort
  // against the spec's accepted set (FIX D). A runner with a `defaultEffort`
  // (claude-minimax → "low", PRD #794) CAPS a rejected/absent effort to it and
  // always passes it explicitly so the inner spawn never auto-selects a thinking
  // tier; a runner without one DROPS a rejected effort to the provider default.
  const accepted = requested !== undefined && spec.efforts.includes(requested);
  const effort = accepted ? requested : spec.defaultEffort;
  if (requested !== undefined && !accepted) {
    warn?.(
      spec.defaultEffort !== undefined
        ? `[afk] warn: effort '${requested}' triggers thinking which MiniMax-M3 does not accept; ` +
            `capping to '${spec.defaultEffort}' for runner '${runner}' ` +
            `(accepted: ${spec.efforts.join(", ")}).`
        : `[afk] warn: effort '${requested}' is not accepted by runner '${runner}' ` +
            `(accepted: ${spec.efforts.join(", ")}); ` +
            "falling back to the provider default.",
    );
  }

  // `forcedModel` (claude-minimax → MiniMax-M3) discards the resolved tier model.
  const targetModel = spec.forcedModel ?? model;
  if (spec.factory === "codex") {
    // The codex provider takes no `env` seam; codex never resolves an auth env.
    return factories.codex(targetModel, effort !== undefined ? { effort } : undefined);
  }
  const options: { effort?: AgentEffort; env?: Record<string, string> } = {};
  if (effort !== undefined) options.effort = effort;
  if (authEnv) options.env = authEnv;
  return factories.claudeCode(targetModel, Object.keys(options).length > 0 ? options : undefined);
}
