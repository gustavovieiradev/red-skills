// runtime/wire.ts — stable public barrel for runtime wiring modules.

export type { RepoContext, AfkPaths } from "./wire/context.js";
export { resolveRepoSlug, resolveRepoContext, afkPaths } from "./wire/context.js";

export type { RunSettings, AttemptGuardArming } from "./wire/run-agent.js";
export { resolveRunSettings, agentLivenessVerdictSync, resolveAttemptGuardArming, resolveAttemptHead, makeRunAgent } from "./wire/run-agent.js";

export type { MonitorInputs, DeadWorkerSweepDeps } from "./wire/monitor.js";
export { readFleetState, reclaimDeadWorkers, collectMonitorInputs } from "./wire/monitor.js";

export {
  STATUSLINE_CACHE_TTL_S,
  STATUSLINE_REFRESH_LOCK_TTL_S,
  resolveStatuslineCacheTtl,
  STATUSLINE_GH_COLD_TIMEOUT_MS,
  withTimeout,
  statuslineCountCachePath,
  parseGitHubRepoSlugFromRemoteUrl,
  inferGitHubRepoSlug,
  applyStatuslineCountCacheLabelDelta,
  editLabelsWithStatuslineCache,
  refreshStatuslineCountCache,
  startDetachedStatuslineCountRefresh,
} from "./wire/statusline-cache.js";
export type { StatuslineRefreshSpawnOptions } from "./wire/statusline-cache.js";

export { collectStatuslineAfk, collectStatuslineFleet, collectStatuslineWorkers, collectStatuslineRepo } from "./wire/statusline.js";

export { collectStatuslineDocs, collectDocsSweepInput, landDocsSweep } from "./wire/docs-sweep.js";

export type { ReapInputs, CollectPrecheckFactsOptions } from "./wire/boot.js";
export { collectReapInputs, collectBootOptions, collectPrecheckFacts, buildBootDeps, buildMinimalBootDeps } from "./wire/boot.js";
