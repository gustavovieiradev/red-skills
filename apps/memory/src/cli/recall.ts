import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { access, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DEFAULT_MEMORY_EVENT_RETENTION_DAYS, type MemoryConfig, readConfig, resolveL2Policy, resolveNotesDir, resolveStoreUri, skillTelemetryEnabled } from "../config.js";
import { createMemoryBackup, listMemoryBackups, readMemoryBackupManifest, restoreMemoryBackup } from "../backup.js";
import { buildMemoryCapabilityCatalog } from "../capability-catalog.js";
import { buildMemoryCapsule, type MemoryCapsuleSourceKind } from "../capsule.js";
import { buildMemoryAssetInventory } from "../asset-inventory.js";
import { buildMemoryAssetInventoryViewerArtifact } from "../asset-inventory-viewer.js";
import { buildMemoryAgentIntegrationStatus } from "../agent-integration-status.js";
import { buildMemoryAgentIntegrationStatusViewerArtifact } from "../agent-integration-status-viewer.js";
import { buildMemoryReferenceRadar } from "../references-radar.js";
import type { CommunityAnalyticsReport } from "../communities.js";
import { buildCommunitiesViewerArtifact } from "../communities-viewer.js";
import type { CommunityDigestReport } from "../community-digest.js";
import type { HubReport, HubRankBy, HubReportRow } from "../hub-report.js";
import type { SuggestedQuestionsReport } from "../suggested-questions.js";
import type { MemoryGlobalSearchReport } from "../global-search.js";
import { buildContextPack, type ContextPack } from "../context-pack.js";
import { buildContextPackViewerArtifact } from "../context-pack-viewer.js";
import { claimCheck, type ClaimCheckResult } from "../claim-check.js";
import { buildDocBundle } from "../doc-bundle.js";
import { buildDocBundleViewerArtifact } from "../doc-bundle-viewer.js";
import { buildDocBacklinksReport } from "../doc-backlinks.js";
import { buildDocBacklinksViewerArtifact } from "../doc-backlinks-viewer.js";
import { buildDocCoverageReport } from "../doc-coverage.js";
import { buildDocCoverageViewerArtifact } from "../doc-coverage-viewer.js";
import { buildDocEvidencePack } from "../doc-evidence-pack.js";
import { buildDocEvidencePackViewerArtifact } from "../doc-evidence-pack-viewer.js";
import { buildDocReferenceGraphReport } from "../doc-reference-graph.js";
import { buildDocReferenceGraphViewerArtifact } from "../doc-reference-graph-viewer.js";
import { buildDocRelatedReport } from "../doc-related.js";
import { buildDocRelatedViewerArtifact } from "../doc-related-viewer.js";
import { restoreDocsFromMemory } from "../doc-restore.js";
import { readDoc, searchDocs } from "../doc-search.js";
import { buildDocSearchViewerArtifact } from "../doc-search-viewer.js";
import { diagnose, prune } from "../doctor.js";
import { ask, neighbors, path as shortestPath, search, traverse } from "../engine.js";
import { exportGraph, toEdge } from "../export.js";
import { buildArchitectureOverview } from "../architecture-overview.js";
import { buildGraphContract, validateGraphContract, type GraphContract } from "../graph-contract.js";
import { extractConversation, extractStructuredTranscript, factsToGraph, resolveProvider } from "../extract-conversation.js";
import { buildMemoryExtractionStatus } from "../extraction-status.js";
import { buildMemoryExtractionStatusViewerArtifact } from "../extraction-status-viewer.js";
import { buildCodeDriftReport, type CodeDriftCountGroup } from "../code-drift-report.js";
import { aliasEngineeringCode, isCuratedSuggestedEngineeringCode, loadEngineeringCodeCuration, promoteEngineeringCode, resolveEngineeringCodeAlias, saveEngineeringCodeCuration, suggestedEngineeringCodes, type EngineeringCodeCurationState } from "../code-curation.js";
import { formatOutput, parseInput, type RawPayload } from "../hook-adapters.js";
import { dispatch, type HookEvent, type Runner } from "../hook-runtime.js";
import { refreshFromGit, type VcsEvent } from "../vcs-refresh.js";
import { installGitHooks, uninstallGitHooks } from "../vcs-hooks-install.js";
import { importAmsDump } from "../import-ams.js";
import { importComplementaryMapFile, type ComplementaryMapSourceKind } from "../import-complementary-map.js";
import { runPromote } from "../promote.js";
import { runAfkLifecycle } from "../afk-lifecycle.js";
import { approveInboxItem, inboxItemToProvenance, listInboxItems, markInboxItemPromoted, quarantineInboxItem, readInboxItem, rejectInboxItem, type InboxStatus, type MemoryInboxItem } from "../inbox.js";
import { approveEvidenceCard, createEvidenceCard, listEvidenceCards, readEvidenceCard, rejectEvidenceCard, type CreateEvidenceCardInput, type EvidenceCard, type EvidenceCardStatus, type EvidenceCitation, type EvidenceProposalApplyState } from "../evidence-card.js";
import { graphRecallResult, renderSignalProvenance, type GraphRecallResult, type GraphRecallHit } from "../graph-recall.js";
import { buildMemoryGovernanceReport, type MemoryGovernanceReport } from "../governance.js";
import { buildMemoryGovernanceViewerArtifact } from "../governance-viewer.js";
import { MemoryStore, factToNode } from "../graph-store.js";
import { HistoricalMemoryStore } from "../historical-memory-store.js";
import { buildMemoryMapContextSlice } from "../map-context.js";
import { createMemoryHttpServer } from "../http-server.js";
import { ingestGuidance } from "../audit-marker.js";
import { evaluateDriftGuard } from "../drift-guard.js";
import { appendContextPackGenerationEvent, appendMemoryEvent, appendRecallObservationEvent, driftCaughtToMemoryEvent } from "../memory-events.js";
import { buildRecallTelemetryReport, recallObservationFromContextPack, renderRecallTelemetryReport } from "../recall-telemetry.js";
import { collectCandidates, ingestProject, refreshFiles, renderIngestReportToon } from "../ingest.js";
import { defaultIgnorePatterns, formatScopeReport, planScope, readMemoryIgnore, resolvePreset, writeMemoryIgnore } from "../scope.js";
import { initGraph, initMarkdownOnly } from "../init.js";
import { lintMemory, type LintReport } from "../lint.js";
import { buildMemoryLayersReport } from "../memory-layers.js";
import { buildMemoryLayersViewerArtifact } from "../memory-layers-viewer.js";
import { applyProviderEnv, redDbProviderClient } from "../provider-client.js";
import { redactSensitiveValue, scanPrivacy, type PrivacyFinding, type PrivacyReport } from "../privacy.js";
import { buildProvenanceReport, findNodeForProvenance, formatProvenanceHuman } from "../provenance.js";
import { buildSkillRecommendations, renderSkillRecommendationsSection } from "../skill-recommendations.js";
import { computeProposalPriority, sortProposalSummaries } from "../proposal-priority.js";
import { buildPrePrMemoryReview, type PrePrMemoryReview, type PrePrReviewSection } from "../pre-pr-review.js";
import { buildPrePrReviewViewerArtifact } from "../pre-pr-review-viewer.js";
import { bootstrapProjectMemory } from "../project-bootstrap.js";
import { buildLearningDebtReport } from "../learning-debt.js";
import { buildLearningDebtViewerArtifact } from "../learning-debt-viewer.js";
import { buildOnboardingMap } from "../onboarding-map.js";
import { buildOnboardingMapViewerArtifact } from "../onboarding-map-viewer.js";
import { buildMemoryMapFreshnessReport } from "../map-freshness.js";
import { buildMemoryOperationalDashboard, buildMemoryOperationalDashboardArtifact, type MemoryOperationalDashboard } from "../operational-dashboard.js";
import { buildConfidenceReport, renderConfidenceMarkdown } from "../confidence.js";
import { buildPathExplainReport } from "../path-explain.js";
import { buildPathExplainViewerArtifact } from "../path-explain-viewer.js";
import { buildPreflightBrief } from "../preflight.js";
import { buildReadinessEnvelope, type MemoryReadinessEnvelope } from "../readiness.js";
import { buildReadinessViewerArtifact } from "../readiness-viewer.js";
import { buildMemoryRoutingGuide, type MemoryRoutingAgent, type MemoryRoutingGuide } from "../routing-guide.js";
import { buildMemoryRoutingGuideViewerArtifact } from "../routing-guide-viewer.js";
import { buildSessionTimeline } from "../session-timeline.js";
import { buildSessionTimelineViewerArtifact } from "../session-timeline-viewer.js";
import { current as sessionCurrent, end as sessionEnd, ensure as sessionEnsure, start as sessionStart } from "../session-manager.js";
import { appendEvent as workingAppendEvent, getRawTranscript as workingGetRaw, listEvents as workingListEvents, setRawTranscript as workingSetRaw } from "../working-memory.js";
import { evictL2 } from "../working-memory-evict.js";
import { executeReadOnlyMemoryOperation, listReadOnlyMemoryOperations, type ReadOnlyMemoryOperation } from "../operations.js";
import { executeMemoryOperationFromTransport, writeViewerArtifact, viewerCliSummary } from "../operation-transport-adapter.js";
import { buildMemoryHandoff } from "../handoff.js";
import { buildMemoryHandoffViewerArtifact } from "../handoff-viewer.js";
import { buildWorkFrontier } from "../work-frontier.js";
import { buildWorkFrontierViewerArtifact } from "../work-frontier-viewer.js";
import { buildHookCoverageReport } from "../hook-coverage.js";
import { buildHookCoverageViewerArtifact } from "../hook-coverage-viewer.js";
import { buildMemoryHealthReport, engineEventHealth, type MemoryHealthReport } from "../memory-health.js";
import { buildMemoryHealthViewerArtifact } from "../memory-health-viewer.js";
import { buildMemoryDecayReport } from "../memory-decay.js";
import { buildMemoryDecayViewerArtifact } from "../memory-decay-viewer.js";
import { memoryStoreEvidence, rejectMemoryStoreEvidence, type GovernedWriteResult, type MemoryStoreEvidenceInput } from "../governed-write.js";
import { buildMemoryMergePassReport, executeMemoryMergeBatch, unmergeMemoryMergeBatch } from "../memory-merge-pass.js";
import { acceptGovernanceTidyRecommendation, dismissGovernanceTidyRecommendation, refreshGovernanceTidyReviewArtifacts } from "../governance-tidy-review.js";
import { recall } from "../recall.js";
import { residentMemoryRequest, shouldUseResidentMemory } from "../resident-memory.js";
import { buildFederationReport } from "../federation.js";
import { runAutoCure } from "../auto-curation.js";
import { buildReasoningReplay } from "../reasoning/reasoning-replay.js";
import { buildWhatifReport, parseWhatifChange, type WhatifChange } from "../whatif.js";
import { buildMemorySmartSearch } from "../smart-search.js";
import { buildMemorySmartSearchViewerArtifact } from "../smart-search-viewer.js";
import { commitMemoryGraph, type MemoryGraphCommitResult } from "../vcs-commit.js";
import { buildVectorSearchReport } from "../vector-search.js";
import { buildVectorStatusViewerArtifact } from "../vector-status-viewer.js";
import { contentHash } from "../hash.js";
import { buildMemoryWorkbench, buildMemoryWorkbenchArtifact } from "../workbench.js";
import { structuralImpactReader, type StructuralImpact, type StructuralImpactTarget } from "../structural-impact-reader.js";
import { buildStructuralImpactViewerArtifact } from "../structural-impact-viewer.js";
import { listContradictions, resolveConflict, supersessionTimeline, type ContradictionSummary, type TopicTimeline } from "../supersession.js";
import { classifyCandidateMemory } from "../store-classifier.js";
import { recordReasoningAttempt, type ReasoningAttemptPayload } from "../reasoning/attempt-writer.js";
import { applyAttemptLearningProposal, buildAttemptLearningReport, parseAttemptLearningProposal, writeAttemptLearningProposalFile } from "../reasoning/learning-proposals.js";
import { ingestSkillEvents, parseSkillEvent, parseSkillEventInput, readRecentSkillEvents, readSkillRollups, type SkillEventSummary, type SkillRollup } from "../skill-events.js";
import { curateSkills, isCuratable, rollupsToCuratorInput } from "../skill-curator.js";
import { runCurateWorkflow } from "../curate-skill/workflow.js";
import type { CuratorReportEnvelope } from "../curate-skill/types.js";
import type { Confidence, MemoryLayer, MemoryProvenance, MemoryScope } from "../schema.js";
import { slugify, storeNote } from "../store.js";
import { readBuildInfo, renderVersion } from "@reddb-io/build-info";
import { parseLooseArgs, type LooseParsedArgs } from "@reddb-io/shared/args.js";
import { renderToonOutput } from "../toon-output.js";
import { USAGE, execFileAsync, LEGACY_CLI_OPERATION_IDS, LEGACY_SUBCOMMANDS_BY_REGISTRY_COMMAND, PROOF_REGISTRY_CLI_COMMANDS, REGISTRY_CLI_OPERATIONS, rootOf, isRecord, MEMORY_SCOPES, parseMemoryScope, MEMORY_LAYERS, parseLayerFlag, CONFIDENCE_VALUES, parseConfidence, SOURCE_KINDS, parseSourceKind, scopeFlags, requireConfig, runInit, runStore, runStoreEvidence, runCommit, printCommitResult } from "./setup.js";
import type { ParsedArgs } from "./setup.js";
import { runInbox, runEvidence, approveLinkedEvidenceCard, rejectLinkedEvidenceCard, findLinkedEvidenceCard, withLinkedEvidenceReview, markProposalEvidenceRejected, firstYamlScalar, firstNestedYamlScalar, unquoteYamlScalar, escapeRegExp, evidenceCardInputFromFlags, collectEvidenceFlagValues, parseEvidenceCitation, evidenceProposalApplyStateFlag, parseEvidenceStatusFilter, printEvidenceResult, printGovernedWriteResult, printLinkedEvidenceResult, printEvidenceList, printEvidenceCard, parseInboxStatusFilter, isInboxStatus, scopeContext, printInboxResult, printInboxList, printInboxItem, formatInboxProvenance } from "./evidence.js";
import type { LinkedEvidenceReviewResult } from "./evidence.js";
import { formatVectorRecallDiagnostic, runContextPack, printContextPackToon, runCapsule, capsuleSourceFlag, runContextPackViewer, runRecommend, runPreflight, runReadiness, runReadinessViewer, runDashboard, printDashboardToon, runWorkbench, runCapabilities, runReferenceRadar, runMemoryLayers, runMemoryLayersViewer } from "./context.js";
import type { ContextPackToonEntry, DashboardToonSection } from "./context.js";
import { runHandoff, runHandoffViewer, runWorkFrontier, runWorkFrontierViewer, runMemoryDecay, runMemoryDecayViewer, runMemoryMergePass, runMemoryMergePassExecute, runMemoryMergePassUnmerge, runTidyReview, runTidyReviewRefresh, runTidyReviewAccept, runTidyReviewDismiss, runSessionShow, runSessionStart, runSessionEnd, runSession, runWorking } from "./memory-ops.js";
import { runLearningDebt, runLearningDebtViewer, runOnboardingMap, runOnboardingMapViewer, runRoutingGuide, runRoutingGuideViewer, runAgentIntegrationStatus, runAgentIntegrationStatusViewer, routingAgentFlag, printRoutingGuide, runOnboardingMapExport, publicSafeRefusalMessage, publicFindingDiagnostic, currentGitCommit, graphStateMetadata, runAsk, runDocs, runRegistryCliOperation, operationNeedsGraphStore, flagsForRegistryTransport, repeatedFlags, registryCliOperationFor } from "./onboarding-docs.js";
import type { PublicCodebaseMapMetadata, OnboardingMapExportShape } from "./onboarding-docs.js";
import { runAssets, runAssetsViewer, formatAssetBytes, runDocsBundle, runDocsSearchViewer, runDocsBundleViewer, runDocsCoverage, runDocsCoverageViewer, runDocsReferenceGraph, runDocsReferenceGraphViewer, runDocsRelated, runDocsBacklinks, runDocsBacklinksViewer, runDocsRelatedViewer, runDocsRead, runDocsEvidencePack, runDocsEvidencePackViewer, runDocsRestore, runBackup, runServe } from "./docs-assets.js";
import { runHooks, runHooksCoverageViewer, runClaimCheck, printClaimCheck, runIngest, runDriftGuard, driftGuardChangedFiles, driftGuardHeadMessage, driftGuardAuditLog, driftGuardRecordEvent, runBootstrap, runRefresh, refreshPaths, splitPathList, gitDiffPaths, runSkillEvent, readSkillCuratorReport, runCurate, runImprove } from "./hooks-ingest.js";
import { runImproveProposals, runImproveProposalsList, runImproveProposalsShow, runImproveProposalsArchive, listPendingProposalFiles, summarizeProposalFile, firstProposalField, proposalRoot, assertInsideProposalTree, isArchiveReason, runImproveApply, parseSkillPatchBlock, assertInsideRoot, countOccurrences, buildSkillImprovementProposals } from "./improve-proposals.js";
import type { ProposalFileSummary, SkillPatchBlock, SkillImprovementProposalSummary, SkillTelemetryEvidenceCardArtifact, SkillImprovementBuildResult } from "./improve-proposals.js";
import { countSkillTelemetryEvidenceCardsForSignal, findReusableSkillTelemetryEvidenceCard, listSkillTelemetryEvidenceCardsForSignal, firstTopLevelYamlScalarField, lastYamlScalarField, parseYamlScalar, parseSkillTelemetryEvidenceCardStatus, isUnresolvedSkillTelemetryEvidenceCardStatus, skillTelemetryReviewHasHumanDecision, proposalFingerprint, skillTelemetryEvidenceSource, skillTelemetryEvidenceRoute, skillTelemetryDominantErrorPattern, skillTelemetryWindow, skillTelemetrySignalFingerprint, buildSkillTelemetryEvidenceCard, suggestedSectionOrAnchor, renderEvidenceCardYaml, yamlValue, isPlainObject, yamlScalar, renderSkillImprovementProposal, recentFailureEvidence, renderRecentFailureEvidence, semanticTroubleshootingNote, topValues, renderDraftSkillPatchBlock, semanticSectionAnchor, semanticHeadingCandidates, markdownSectionByHeading, uniqueTailAnchor, reportImproveState } from "./improve-telemetry.js";
import type { SkillTelemetryEvidenceCardStatus, ExistingSkillTelemetryEvidenceCardRef, SkillTelemetryEvidenceCard } from "./improve-telemetry.js";
import { runStatus, runHealth, runRecallTelemetry, runHealthViewer, runGovernance, runGovernanceViewer, printGovernance, runLint, runPrivacy, printPrivacyReport, printLintReport, healthReport, healthState, healthRecommendations, runContextStatus, contextStatusReport, contextRecommendations, exists, countMarkdownFiles, storeExists, graphFreshnessStatus, scanProjectFreshness, newestMtimeMs, shouldSkipFreshnessPath, entryLooksLikeCache, toPosix, enabledHookNames, yesNo, reportStatusState, formatOutcomes, skillEventFromFlags, plural } from "./health.js";
import type { CheckName, ContextCheck } from "./health.js";
import { runExtract, runExtraction, runExtractionStatusViewer, runMap, runCodeDrift, runCodeCurate, codeCurationOutput, renderCodeDriftGroups, openGraphStore, applyConfiguredProviderEnv, intFlag, numberFlag, commaIntegerFlag, stringFlag, isIntegerText, strFlag, runSearch, runMapContext, mapContextModeFlag, runNeighbors, runTraverse, runPath, runPathExplain, runPathExplainViewer, runConfidence } from "./graph-navigation.js";
import { runConflicts, runSupersede, runResolveConflict, runTimeline, runCommunities, renderCommunitiesToon, runCommunitiesViewer, runCommunityDigest, runHubReport, runSuggestedQuestions, parseHubRankBy, renderHubReportToon, renderSuggestedQuestionsToon, parseRid, printConflicts, printTimeline, printTimelineToon, runStructuralImpact, runPrePrReview, runPrePrReviewViewer, runStructuralImpactViewer, printStructuralImpact, readChangedFiles, parseChangedFiles, printPrePrReview, printPrePrSection, printReadinessEnvelope } from "./analytics.js";
import type { TimelineToonEntry } from "./analytics.js";
import { runStats, runVector, runDoctor, runExport, runGlobalSearch, resolveOverviewContract, runArchitectureOverview, readStdin, HOOK_EVENTS, runHook, VCS_EVENTS, runVcs, runVcsRefresh, resolveHooksDir, resolveBootstrapPath, runVcsInstallHooks, runVcsUninstallHooks, runAttempt, runAttemptLearn, runAttemptLearnApply, runImport, parseComplementaryMapKind, runPromoteCmd, runAfkFinalize } from "./system.js";



export async function runProvenance(args: ParsedArgs): Promise<void> {
  const target = args.positional.join(" ").trim();
  if (!target) throw new Error("pass a node rid or label: memory provenance <rid|label>");
  const { store } = await openGraphStore(args);
  try {
    const node = await findNodeForProvenance(store, target);
    if (!node) throw new Error(`memory node not found: ${target}`);
    const report = buildProvenanceReport(node);
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    process.stdout.write(formatProvenanceHuman(report));
  } finally {
    await store.close();
  }
}


export async function runClassify(args: ParsedArgs): Promise<void> {
  const candidate = args.positional.join(" ").trim();
  const result = classifyCandidateMemory(candidate);
  if (args.flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`memory classify: ${result.kind}`);
  console.log(`  tier: ${result.recommendedTier}`);
  console.log(`  scope: ${result.recommendedScope}`);
  if (result.safetyWarnings.length > 0) {
    console.log(`  warnings: ${result.safetyWarnings.join("; ")}`);
  }
  console.log(`  ${result.explanation}`);
}


export async function runRecall(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const query = args.positional.join(" ").trim();
  if (!query) throw new Error("nothing to recall — pass a query: memory recall <query>");
  const config = await requireConfig(rootDir);
  const limit = typeof args.flags.limit === "string" ? Number(args.flags.limit) : 10;
  const requestedLayer = parseLayerFlag(args.flags.layer);
  // Today only L3 is populated; explicit non-L3 requests return empty rather
  // than silently falling back to L3 (PRD #174 prepares the L1/L2 surfaces).
  const layerFiltersOut = requestedLayer != null && requestedLayer !== "L3";

  if (config.mode === "graph") {
    const asOf = stringFlag(args.flags, "as-of");
    if (!asOf && shouldUseResidentMemory(rootDir, config)) {
      try {
        const residentResult = await residentMemoryRequest(rootDir, config, "recall", {
          query,
          limit,
          includeSuperseded: args.flags["include-superseded"] === true,
          scope: scopeFlags(args.flags),
          ranking: config.recallRanking,
        });
        const { hits: rawHits, diagnostics } = asGraphRecallResult(residentResult);
        const hits = layerFiltersOut ? [] : rawHits;
        if (args.flags.json === true) {
          printLegacyGraphRecall(query, hits, diagnostics);
          return;
        }
        if (hits.length === 0) {
          printRecallToon({
            items: [],
            query,
            store: "graph",
            ranking: "hybrid-rrf",
            vector: diagnostics.vector,
          });
          return;
        }
        printRecallToon({
          items: hits.map((hit) => ({
            id: hit.id,
            score: hit.score,
            kind: hit.node_type,
            content: `${hit.label} ${hit.excerpt}`.trim(),
          })),
          query,
          store: "graph",
          ranking: "hybrid-rrf",
          vector: diagnostics.vector,
        });
        return;
      } catch {
        // Fail open: if the resident cannot start or answer, keep the legacy
        // embedded path so CLI calls and hooks do not break the agent turn.
      }
    }
    const store = asOf
      ? await HistoricalMemoryStore.open({ uri: resolveStoreUri(rootDir, config), ref: asOf })
      : await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
    try {
      const { hits: rawHits, diagnostics } = await graphRecallResult(store, query, limit, {
        includeSuperseded: args.flags["include-superseded"] === true,
        scope: scopeFlags(args.flags),
        now: asOf ? 0 : undefined,
        ranking: config.recallRanking,
      });
      const hits = layerFiltersOut ? [] : rawHits;
      if (args.flags.json === true) {
        printLegacyGraphRecall(query, hits, diagnostics);
        return;
      }
      if (hits.length === 0) {
        printRecallToon({
          items: [],
          query,
          store: "graph",
          ranking: "hybrid-rrf",
          vector: diagnostics.vector,
        });
        return;
      }
      printRecallToon({
        items: hits.map((hit) => ({
          id: hit.id,
          score: hit.score,
          kind: hit.node_type,
          content: `${hit.label} ${hit.excerpt}`.trim(),
        })),
        query,
        store: "graph",
        ranking: "hybrid-rrf",
        vector: diagnostics.vector,
      });
    } finally {
      await store.close();
    }
    return;
  }

  const hits = layerFiltersOut
    ? []
    : await recall(resolveNotesDir(rootDir, config), query, limit);
  if (args.flags.json === true) {
    printLegacyMarkdownRecall(query, hits);
    return;
  }
  if (hits.length === 0) {
    printRecallToon({
      items: [],
      query,
      store: "markdown",
      ranking: "term-count",
    });
    return;
  }
  printRecallToon({
    items: hits.map((hit) => ({
      id: hit.id,
      score: hit.score,
      kind: "note",
      content: hit.excerpt,
    })),
    query,
    store: "markdown",
    ranking: "term-count",
  });
}


export function asGraphRecallResult(value: unknown): GraphRecallResult {
  if (!value || typeof value !== "object" || !Array.isArray((value as { hits?: unknown }).hits)) {
    throw new Error("resident returned invalid memory recall result");
  }
  return value as GraphRecallResult;
}


export type RecallToonItem = {
  id: string;
  score: number;
  kind: string;
  content: string;
};


export function printRecallToon(opts: {
  items: RecallToonItem[];
  query: string;
  store: "markdown" | "graph";
  ranking: string;
  vector?: {
    status: "unavailable" | "available" | "contributed";
    candidates: number;
    contributed: number;
    reason?: string;
  };
}): void {
  const zero = opts.items.length === 0;
  console.log(
    renderToonOutput({
      rowsKey: "items",
      rows: opts.items,
      fields: ["id", "score", "kind", "content"],
      summary: {
        status: zero ? "0 results" : `${opts.items.length} results`,
        results: opts.items.length,
        query: opts.query,
        store: opts.store,
        ranking: opts.ranking,
        ...(opts.vector ? { vector: opts.vector } : {}),
      },
      extra: zero
        ? {
            next: 'try `memory store "..."` to add governed context, then rerun recall',
          }
        : {},
    }),
  );
}


export function printLegacyMarkdownRecall(query: string, hits: Array<{ id: string; score: number; excerpt: string }>): void {
  if (hits.length === 0) {
    console.log(`memory: no matches for "${query}"`);
    return;
  }
  console.log(`memory: ${hits.length} match(es) for "${query}"`);
  for (const hit of hits) {
    console.log(`  [${hit.score}] ${hit.id}`);
    console.log(`        ${hit.excerpt}`);
  }
}


export function printLegacyGraphRecall(
  query: string,
  hits: GraphRecallHit[],
  diagnostics: { vector: Parameters<typeof formatVectorRecallDiagnostic>[0] },
): void {
  if (hits.length === 0) {
    console.log(`memory: no matches for "${query}"`);
    console.log(`  ${formatVectorRecallDiagnostic(diagnostics.vector)}`);
    return;
  }
  console.log(`memory: ${hits.length} match(es) for "${query}"`);
  console.log(`  ${formatVectorRecallDiagnostic(diagnostics.vector)}`);
  for (const hit of hits) {
    console.log(`  [${hit.score}] ${hit.id} (${hit.node_type}) ${hit.label}`);
    console.log(`        ${hit.excerpt}`);
    for (const line of renderSignalProvenance(hit.signal_provenance)) {
      console.log(`        ${line}`);
    }
    if (hit.hooks && hit.hooks.length > 0) {
      const parts = hit.hooks.map((h) => `${h.lifecycle}=${h.exit_code}`);
      console.log(`        hooks: ${parts.join(", ")}`);
    }
    if (hit.superseded_by != null) {
      const window = [
        hit.valid_from != null ? `valid_from=${hit.valid_from}` : "",
        hit.valid_until != null ? `valid_until=${hit.valid_until}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      console.log(
        `        lineage: superseded_by=memory_nodes:${hit.superseded_by}${window ? ` ${window}` : ""}`,
      );
    }
  }
}


export async function runFederate(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const query = (stringFlag(args.flags, "query") ?? args.positional.join(" ")).trim();
  if (!query) {
    throw new Error(
      'nothing to federate — pass --query "<topic>" or memory federate <topic>',
    );
  }
  const report = await buildFederationReport(rootDir, query, {
    limit: intFlag(args.flags, "limit"),
    perRootLimit: intFlag(args.flags, "per-root-limit"),
  });
  if (args.flags.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    `memory federate: "${report.query}" — ${report.results.length} hit(s) across ${report.roots_queried} root(s)`,
  );
  if (report.roots_queried === 0) {
    console.log("  no federation roots configured (.red/memory/federation.yaml)");
    return;
  }
  for (const root of report.roots) {
    const tag = root.status === "ok" ? `${root.hits} hit(s)` : root.status;
    console.log(`  root ${root.origin_repo}: ${tag}`);
  }
  for (const result of report.results) {
    console.log(`  [${result.score}] @${result.origin_repo} ${result.id}`);
    console.log(`        ${result.excerpt}`);
  }
}


export async function runAutocure(args: ParsedArgs): Promise<void> {
  const apply = args.flags.apply === true;
  const { store } = await openGraphStore(args);
  try {
    const report = await runAutoCure(store, {
      apply,
      staleDays: intFlag(args.flags, "stale-days"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const mode = report.dry_run ? "dry-run" : "apply";
    console.log(
      `memory autocure (${mode}): ${report.actions_proposed.length} proposed, ${report.actions_applied.length} applied, ${report.skipped_claim_guarded.length} skipped (claim-guarded)`,
    );
    console.log(
      `  entropy: ${report.entropy_before} -> ${report.entropy_after} (nodes=${report.totals.nodes}, edges=${report.totals.edges}, claim_guarded=${report.totals.claim_guarded})`,
    );
    for (const [kind, counts] of Object.entries(report.by_kind)) {
      if (counts.proposed === 0 && counts.applied === 0) continue;
      console.log(`  ${kind}: proposed=${counts.proposed} applied=${counts.applied}`);
    }
    for (const action of report.actions_proposed.slice(0, 10)) {
      const target = `${action.target.node_type}:${action.target.label}#${action.target.rid}`;
      const peer = action.with
        ? ` -> ${action.with.node_type}:${action.with.label}#${action.with.rid}`
        : "";
      console.log(`  [${action.kind}] ${target}${peer}`);
      console.log(`        ${action.reason}`);
    }
    if (report.skipped_claim_guarded.length > 0) {
      console.log("  claim-guarded (skipped):");
      for (const action of report.skipped_claim_guarded.slice(0, 10)) {
        console.log(`    ${action.kind} on #${action.target.rid}`);
      }
    }
    if (report.dry_run) {
      console.log("\nRe-run with --apply to mutate (claim-guarded nodes still skipped).");
    }
  } finally {
    await store.close();
  }
}


export async function runReasoningReplay(args: ParsedArgs): Promise<void> {
  const task = (stringFlag(args.flags, "task") ?? args.positional.join(" ")).trim();
  if (!task) {
    throw new Error(
      "nothing to replay — pass --task \"<descriptor>\" or memory reasoning-replay <descriptor>",
    );
  }
  const { store } = await openGraphStore(args);
  try {
    const report = await buildReasoningReplay(store, task, {
      limit: intFlag(args.flags, "limit"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(
      `memory reasoning-replay: "${report.task}" — ${report.results.length}/${report.total_attempts} attempt(s)`,
    );
    if (report.results.length === 0) {
      console.log("  no past attempts in the reasoning tier yet");
      return;
    }
    for (const result of report.results) {
      console.log(
        `  [${result.similarity.toFixed(4)}] ${result.attempt_id}  ${result.when}`,
      );
      console.log(`        ${result.summary}`);
    }
  } finally {
    await store.close();
  }
}


export async function runWhatif(args: ParsedArgs): Promise<void> {
  // Collect every `--change <value>` from process.argv since the shared
  // parser only keeps the last value per flag.
  const rawChanges = collectRepeatedFlag(process.argv.slice(2), "change");
  const positionalChanges = args.positional.filter((p) => p.length > 0);
  const sources = [...rawChanges, ...positionalChanges];
  if (sources.length === 0) {
    throw new Error(
      'nothing to evaluate — pass one or more --change "<descriptor>" or memory whatif "<descriptor>" ["<descriptor>" ...]',
    );
  }
  const changes: WhatifChange[] = sources.map(parseWhatifChange);
  const { store } = await openGraphStore(args);
  try {
    const report = await buildWhatifReport(store, changes, {
      limit: intFlag(args.flags, "limit"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(
      `memory whatif: ${report.changes.length} change(s) — breakage_likelihood ${report.breakage_likelihood.toFixed(3)} (self_confidence ${report.self_confidence.toFixed(2)})`,
    );
    console.log(
      `  affected: ${report.affected.files.length} file(s), ${report.affected.symbols.length} symbol(s), ${report.affected.tests.length} test(s)`,
    );
    for (const file of report.affected.files.slice(0, 8)) {
      console.log(`    file  ${file}`);
    }
    for (const symbol of report.affected.symbols.slice(0, 8)) {
      console.log(`    sym   ${symbol}`);
    }
    if (report.historical_attempts.length === 0) {
      console.log("  no similar past attempts in the reasoning tier");
    } else {
      console.log(`  historical attempts (${report.historical_attempts.length}):`);
      for (const attempt of report.historical_attempts) {
        console.log(
          `    [${attempt.similarity.toFixed(3)}] ${attempt.attempt_id} (${attempt.outcome})  ${attempt.when}`,
        );
      }
    }
  } finally {
    await store.close();
  }
}


export function collectRepeatedFlag(argv: string[], key: string): string[] {
  const flag = `--${key}`;
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== flag) continue;
    const value = argv[i + 1];
    if (value !== undefined && !value.startsWith("--")) {
      out.push(value);
      i++;
    }
  }
  return out;
}


export async function runSmartSearch(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const query = args.positional.join(" ").trim();
  if (!query) throw new Error("nothing to search — pass a query: memory smart-search <query>");
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemorySmartSearch(store, query, {
      limit: intFlag(args.flags, "limit"),
      depth: intFlag(args.flags, "depth"),
      recall: {
        scope: scopeFlags(args.flags),
        includeSuperseded: args.flags["include-superseded"] === true,
      },
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`memory smart-search: "${query}"`);
    console.log(
      `  recall=${report.summary.recall_hits} docs=${report.summary.doc_hits} vector=${report.summary.vector_hits} (${report.summary.vector_status})`,
    );
    for (const result of report.top_results.slice(0, 8)) {
      const ref = result.ref.path ?? result.ref.label ?? result.ref.rid ?? result.id;
      console.log(
        `  #${result.rank} ${result.kind} [${result.score.toFixed(3)}] ${ref} (${result.sources.join("+")})`,
      );
      console.log(`      ${result.excerpt}`);
    }
    for (const action of report.recommended_next_actions) console.log(`  next: ${action}`);
  } finally {
    await store.close();
  }
}


export async function runSmartSearchViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const query = args.positional.join(" ").trim();
  if (!query) {
    throw new Error("nothing to render — pass a query: memory smart-search-viewer <query>");
  }
  const safeName = createHash("sha256").update(query).digest("hex").slice(0, 12);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, `.red/memory/smart-search-${safeName}.html`),
  );
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemorySmartSearch(store, query, {
      limit: intFlag(args.flags, "limit"),
      depth: intFlag(args.flags, "depth"),
      recall: {
        scope: scopeFlags(args.flags),
        includeSuperseded: args.flags["include-superseded"] === true,
      },
    });
    const artifact = buildMemorySmartSearchViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: smart-search viewer written ${outPath}`);
    console.log(`  results: ${report.top_results.length}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}
