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
import { runProvenance, runClassify, runRecall, asGraphRecallResult, printRecallToon, printLegacyMarkdownRecall, printLegacyGraphRecall, runFederate, runAutocure, runReasoningReplay, runWhatif, collectRepeatedFlag, runSmartSearch, runSmartSearchViewer } from "./recall.js";
import type { RecallToonItem } from "./recall.js";
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
import { runStats, runVector, runDoctor, runExport, runGlobalSearch, resolveOverviewContract, runArchitectureOverview, readStdin, HOOK_EVENTS, runHook, VCS_EVENTS, runVcs, runVcsRefresh, resolveHooksDir, resolveBootstrapPath, runVcsInstallHooks, runVcsUninstallHooks, runAttempt, runAttemptLearn, runAttemptLearnApply, runImport, parseComplementaryMapKind, runPromoteCmd, runAfkFinalize } from "./system.js";



export async function runConflicts(args: ParsedArgs): Promise<void> {
  const { store } = await openGraphStore(args);
  try {
    const conflicts = await listContradictions(store, {
      includeResolved: args.flags["include-resolved"] === true,
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify({ conflicts }, null, 2));
      return;
    }
    printConflicts(conflicts);
  } finally {
    await store.close();
  }
}


export async function runSupersede(args: ParsedArgs): Promise<void> {
  const [oldArg, newArg] = args.positional;
  if (!oldArg || !newArg) {
    throw new Error("pass two node rids: memory supersede <old-rid> <new-rid>");
  }
  const oldRid = parseRid(oldArg, "old-rid");
  const newRid = parseRid(newArg, "new-rid");
  const reason = typeof args.flags.reason === "string" ? args.flags.reason : undefined;
  const { store } = await openGraphStore(args);
  try {
    await resolveConflict(store, { activeRid: newRid, supersededRid: oldRid, reason });
    console.log(`memory: superseded ${oldRid} -> ${newRid}`);
    if (reason) console.log(`  reason: ${reason}`);
  } finally {
    await store.close();
  }
}


export async function runResolveConflict(args: ParsedArgs): Promise<void> {
  const activeArg = typeof args.flags.active === "string" ? args.flags.active : args.positional[0];
  const supersededArg =
    typeof args.flags.superseded === "string" ? args.flags.superseded : args.positional[1];
  if (!activeArg || !supersededArg) {
    throw new Error(
      "pass active and superseded rids: memory resolve-conflict <active-rid> <superseded-rid>",
    );
  }
  const activeRid = parseRid(activeArg, "active-rid");
  const supersededRid = parseRid(supersededArg, "superseded-rid");
  const reason = typeof args.flags.reason === "string" ? args.flags.reason : undefined;
  const { store } = await openGraphStore(args);
  try {
    await resolveConflict(store, { activeRid, supersededRid, reason });
    console.log(`memory: resolved conflict with active ${activeRid}; superseded ${supersededRid}`);
    if (reason) console.log(`  reason: ${reason}`);
  } finally {
    await store.close();
  }
}


export async function runTimeline(args: ParsedArgs): Promise<void> {
  const topic = args.positional.join(" ").trim();
  if (!topic) throw new Error("pass a topic or rid: memory timeline <topic|rid>");
  const { store } = await openGraphStore(args);
  try {
    const timeline = await supersessionTimeline(store, topic);
    if (args.flags.json === true) {
      console.log(JSON.stringify(timeline, null, 2));
      return;
    }
    printTimelineToon(timeline, { includeAudit: args.flags["include-audit"] === true });
  } finally {
    await store.close();
  }
}


export async function runCommunities(args: ParsedArgs): Promise<void> {
  const { store } = await openGraphStore(args);
  try {
    const report = (await executeReadOnlyMemoryOperation("memory.communities", { store }, {
      cache: args.flags["no-cache"] === true ? "off" : "read-write",
    })) as CommunityAnalyticsReport;
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(renderCommunitiesToon(report));
  } finally {
    await store.close();
  }
}


export function renderCommunitiesToon(report: CommunityAnalyticsReport): string {
  return renderToonOutput({
    rowsKey: "communities",
    rows: report.communities.map((community) => ({
      id: community.id,
      label: community.short_label ?? community.id,
      count: community.count,
      cohesion_score: community.cohesion_score,
      internal_edge_weight: community.internal_edge_weight,
      external_edge_weight: community.external_edge_weight,
      labels: community.labels.join(","),
    })),
    fields: [
      "id",
      "label",
      "count",
      "cohesion_score",
      "internal_edge_weight",
      "external_edge_weight",
      "labels",
    ],
    extra: {
      bridge_nodes: report.bridge_nodes.slice(0, 20).map((node) => ({
        rid: node.rid,
        label: node.label,
        community_id: node.community_id,
        connected_community_count: node.connected_community_count,
        connected_community_ids: node.connected_community_ids.join(","),
        cross_community_edge_count: node.cross_community_edge_count,
        cross_community_weight: node.cross_community_weight,
      })),
      bridge_edges: report.bridge_edges.slice(0, 20).map((edge) => ({
        from_label: edge.from_label,
        to_label: edge.to_label,
        from_community_id: edge.from_community_id,
        to_community_id: edge.to_community_id,
        weight: edge.weight,
      })),
      graph: {
        hash: report.graph_hash,
        cache: report.cached ? "hit" : "miss",
        assignments: report.assignments.length,
        ranked_nodes: report.node_analytics.length,
        inter_community_edges: report.inter_community_edges.length,
      },
    },
    summary: {
      status: report.summary.status,
      next: report.summary.next,
    },
  });
}


export async function runCommunitiesViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const outPath = stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/communities-viewer.html");
  const { store } = await openGraphStore(args);
  try {
    const report = (await executeReadOnlyMemoryOperation("memory.communities", { store }, {
      cache: args.flags["no-cache"] === true ? "off" : "read-write",
    })) as CommunityAnalyticsReport;
    const artifact = buildCommunitiesViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: communities viewer written ${outPath}`);
    console.log(`  communities: ${artifact.report.communities.length}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runCommunityDigest(args: ParsedArgs): Promise<void> {
  const { store, config } = await openGraphStore(args);
  try {
    const report = (await executeReadOnlyMemoryOperation(
      "memory.community-digest",
      { store, providerConfig: config.provider },
      {
        cache: args.flags["no-cache"] === true ? "off" : "read-write",
      },
    )) as CommunityDigestReport;
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`memory: ${report.community_count} community digest(s)`);
    console.log(`  graph hash: ${report.graph_hash}`);
    console.log(`  cache: ${report.cached ? "hit" : "miss"}`);
    console.log(
      `  provider: ${report.provider.status}${
        report.provider.error ? ` (${report.provider.error})` : ""
      }`,
    );
    for (const digest of report.digests) {
      console.log(`  ${digest.short_label ?? digest.community_id}: ${digest.size} node(s)`);
      console.log(`        community: ${digest.community_id}`);
      console.log(`        top label: ${digest.top_label}`);
      console.log(`        top type: ${digest.top_node_type}`);
      if (digest.top_engineering_code) {
        console.log(`        top code: ${digest.top_engineering_code}`);
      }
      if (digest.narrative_summary) {
        console.log(`        summary: ${digest.narrative_summary}`);
      }
    }
    console.log(
      `  labeling: generated ${report.summary.labeling.generated}, reused ${report.summary.labeling.reused}, estimated tokens ${report.summary.labeling.token_cost.total_tokens}`,
    );
  } finally {
    await store.close();
  }
}


export async function runHubReport(args: ParsedArgs): Promise<void> {
  const { store } = await openGraphStore(args);
  try {
    const rankBy = parseHubRankBy(stringFlag(args.flags, "rank-by") ?? stringFlag(args.flags, "rank_by"));
    const report = (await executeReadOnlyMemoryOperation("memory.hub-report", { store }, {
      limit: intFlag(args.flags, "limit"),
      rank_by: rankBy,
    })) as HubReport;
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(renderHubReportToon(report, { wide: args.flags.wide === true }));
  } finally {
    await store.close();
  }
}


export async function runSuggestedQuestions(args: ParsedArgs): Promise<void> {
  const { store, config } = await openGraphStore(args);
  try {
    const report = (await executeReadOnlyMemoryOperation(
      "memory.suggested-questions",
      { store, providerConfig: config.provider },
      {
        limit: intFlag(args.flags, "limit"),
      },
    )) as SuggestedQuestionsReport;
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(renderSuggestedQuestionsToon(report));
  } finally {
    await store.close();
  }
}


export function parseHubRankBy(value: string | undefined): HubRankBy {
  if (value == null) return "total";
  if (value === "total" || value === "in" || value === "out") return value;
  throw new Error('--rank-by must be "total", "in", or "out"');
}


export function renderHubReportToon(report: HubReport, opts: { wide: boolean }): string {
  const fields: readonly (keyof HubReportRow & string)[] = opts.wide
    ? [
        "rid",
        "label",
        "title",
        "node_type",
        "community_id",
        "total_degree",
        "in_degree",
        "out_degree",
        "seal_mix",
        "seal_count",
        "seals",
      ]
    : ["label", "title", "community_id", "total_degree", "in_degree", "out_degree", "seal_mix"];
  const rows = report.hubs.map((hub) => ({ ...hub }));
  return renderToonOutput({
    rowsKey: "hubs",
    rows,
    fields,
    summary: report.summary.empty
      ? {
          state: "empty_graph",
          message: "No graph nodes found.",
          nodes: report.summary.nodes,
          edges: report.summary.edges,
          next: report.next,
        }
      : {
          rank_by: report.rank_by,
          reported: report.summary.reported,
          nodes: report.summary.nodes,
          edges: report.summary.edges,
          max_total_degree: report.summary.max_total_degree,
          communities: report.summary.communities,
          next: report.next,
        },
    extra: {
      schema_version: report.schema_version,
      graph_hash: report.graph_hash,
    },
  });
}


export function renderSuggestedQuestionsToon(report: SuggestedQuestionsReport): string {
  const rows: Array<Record<string, any>> = report.questions.map((question) => ({
    id: question.id,
    signal_type: question.signal_type,
    question: question.question,
    rationale: question.rationale,
    references: question.references.map((ref) => ({ ...ref })),
  }));
  return renderToonOutput({
    rowsKey: "questions",
    rows,
    fields: [
      "id",
      "signal_type",
      "question",
      "rationale",
      "references",
    ],
    summary: {
      status: report.summary.status,
      nodes: report.summary.nodes,
      edges: report.summary.edges,
      signals: report.summary.signals,
      questions: report.summary.questions,
      provider_status: report.provider.status,
      provider_error: report.provider.error ?? null,
      next: report.summary.next,
    },
    extra: {
      schema_version: report.schema_version,
      graph_hash: report.graph_hash,
      signals: report.signals.map((signal) => ({
        signal_id: signal.signal_id,
        signal_type: signal.signal_type,
        title: signal.title,
        score: signal.score,
        references: signal.references.map((ref) => ({ ...ref })),
      })),
    } as Record<string, any>,
  });
}


export function parseRid(value: string, name: string): number {
  const rid = Number(value);
  if (!Number.isInteger(rid) || rid <= 0) throw new Error(`${name} must be a positive integer`);
  return rid;
}


export function printConflicts(conflicts: ContradictionSummary[]): void {
  if (conflicts.length === 0) {
    console.log("memory: no unresolved contradictions");
    return;
  }
  console.log(`memory: ${conflicts.length} likely contradiction(s)`);
  for (const conflict of conflicts) {
    const status = conflict.resolved ? `resolved -> ${conflict.activeRid}` : "unresolved";
    console.log(
      `  [${status}] ${conflict.from.rid} ${conflict.from.label} <-> ${conflict.to.rid} ${conflict.to.label}`,
    );
    if (conflict.reason) console.log(`        ${conflict.reason}`);
  }
}


export function printTimeline(timeline: TopicTimeline, opts: { includeAudit: boolean }): void {
  if (timeline.entries.length === 0) {
    console.log(`memory: no timeline entries for "${timeline.topic}"`);
    return;
  }
  console.log(`memory: timeline for "${timeline.topic}"`);
  for (const entry of timeline.entries) {
    const marker = entry.status === "active" ? "active" : `superseded -> ${entry.activeRid}`;
    console.log(`  [${marker}] ${entry.rid} (${entry.nodeType}) ${entry.label}`);
    if (entry.content) console.log(`        ${entry.content.slice(0, 200)}`);
  }
  if (opts.includeAudit) {
    if (timeline.auditLinks.length === 0) {
      console.log("  audit: no contradiction or supersession links");
      return;
    }
    console.log("  audit:");
    for (const edge of timeline.auditLinks) {
      const reason = edge.reason ? ` - ${edge.reason}` : "";
      console.log(`    ${edge.label} ${edge.fromRid} -> ${edge.toRid}${reason}`);
    }
  }
}


export type TimelineToonEntry = {
  rid: number;
  status: string;
  activeRid: number;
  nodeType: string;
  label: string;
  title: string;
  content: string;
};


export function printTimelineToon(timeline: TopicTimeline, opts: { includeAudit: boolean }): void {
  const rows: TimelineToonEntry[] = timeline.entries.map((entry) => ({
    rid: entry.rid,
    status: entry.status,
    activeRid: entry.activeRid,
    nodeType: entry.nodeType,
    label: entry.label,
    title: entry.title,
    content: entry.content,
  }));
  const zero = rows.length === 0;
  console.log(
    renderToonOutput({
      rowsKey: "entries",
      rows,
      fields: ["rid", "status", "activeRid", "nodeType", "label", "title", "content"],
      summary: {
        status: zero ? "0 entries" : `${rows.length} entries`,
        topic: timeline.topic,
        entries: rows.length,
        active: rows.filter((entry) => entry.status === "active").length,
        superseded: rows.filter((entry) => entry.status === "superseded").length,
        auditLinks: timeline.auditLinks.length,
      },
      extra: {
        ...(opts.includeAudit
          ? {
              auditLinks: timeline.auditLinks.map((edge) => ({
                label: edge.label,
                fromRid: edge.fromRid,
                toRid: edge.toRid,
                reason: edge.reason,
              })),
            }
          : {}),
        ...(zero
          ? {
              next: "store or ingest topic evidence, then rerun `memory timeline <topic>`",
            }
          : {}),
      },
    }),
  );
}


export async function runStructuralImpact(args: ParsedArgs): Promise<void> {
  const target: StructuralImpactTarget = {
    file: typeof args.flags.file === "string" ? args.flags.file : undefined,
    symbol: typeof args.flags.symbol === "string" ? args.flags.symbol : undefined,
  };
  if (!target.file && !target.symbol) {
    throw new Error("pass --file <path>, --symbol <name>, or both");
  }
  const { store } = await openGraphStore(args);
  try {
    const impact = await structuralImpactReader(store)(target);
    printStructuralImpact(target, impact);
  } finally {
    await store.close();
  }
}


export async function runPrePrReview(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `pre-pr-review needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }
  const comparison = stringFlag(args.flags, "range") ?? stringFlag(args.flags, "comparison");
  const changedFiles = await readChangedFiles(rootDir, comparison);
  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const review = await buildPrePrMemoryReview(store, { changedFiles, comparison });
    if (args.flags.json === true) {
      console.log(JSON.stringify(review, null, 2));
      return;
    }
    printPrePrReview(review);
  } finally {
    await store.close();
  }
}


export async function runPrePrReviewViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `pre-pr-review-viewer needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }
  const comparison = stringFlag(args.flags, "range") ?? stringFlag(args.flags, "comparison");
  const changedFiles = await readChangedFiles(rootDir, comparison);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/pre-pr-review-viewer.html"),
  );
  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const review = await buildPrePrMemoryReview(store, { changedFiles, comparison });
    const artifact = buildPrePrReviewViewerArtifact(review);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: pre-PR review viewer written ${outPath}`);
    console.log(`  changed files: ${review.changedFiles.length}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runStructuralImpactViewer(args: ParsedArgs): Promise<void> {
  const target: StructuralImpactTarget = {
    file: typeof args.flags.file === "string" ? args.flags.file : undefined,
    symbol: typeof args.flags.symbol === "string" ? args.flags.symbol : undefined,
  };
  if (!target.file && !target.symbol) {
    throw new Error("pass --file <path>, --symbol <name>, or both");
  }
  const rootDir = rootOf(args.flags);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/structural-impact-viewer.html"),
  );
  const { store } = await openGraphStore(args);
  try {
    const impact = await structuralImpactReader(store)(target);
    const artifact = buildStructuralImpactViewerArtifact(target, impact);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: structural impact viewer written ${outPath}`);
    console.log(`  target: ${target.file ?? ""}${target.symbol ? ` ${target.symbol}` : ""}`.trim());
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export function printStructuralImpact(target: StructuralImpactTarget, impact: StructuralImpact): void {
  const label = [target.file ? `file ${target.file}` : "", target.symbol ? `symbol ${target.symbol}` : ""]
    .filter(Boolean)
    .join(", ");
  const lines: string[] = [];

  for (const edge of impact.imports) {
    lines.push(`${edge.from.properties.title} imports ${edge.to.properties.title ?? edge.to.label}`);
  }
  for (const edge of impact.importedBy) {
    lines.push(`${edge.from.properties.title} imports this target through ${edge.to.properties.title ?? edge.to.label}`);
  }
  for (const edge of impact.calls) {
    lines.push(`${edge.from.properties.title} calls ${edge.to.properties.title ?? edge.to.label}`);
  }
  for (const edge of impact.calledBy) {
    lines.push(`${edge.from.properties.title} calls this target`);
  }
  for (const edge of impact.usesTypes) {
    lines.push(`${edge.from.properties.title} uses type ${edge.to.properties.title ?? edge.to.label}`);
  }
  for (const edge of impact.usedByTypes) {
    lines.push(`${edge.from.properties.title} uses this target as a type`);
  }
  for (const edge of impact.references) {
    lines.push(`${edge.from.properties.title} references ${edge.to.properties.title ?? edge.to.label}`);
  }
  for (const edge of impact.referencedBy) {
    lines.push(`${edge.from.properties.title} references this target`);
  }
  for (const node of impact.defines) {
    lines.push(`${impact.definedIn?.properties.title ?? target.file ?? "target file"} defines ${node.properties.title}`);
  }
  if (impact.definedIn && target.symbol) {
    lines.push(`${target.symbol} is defined in ${impact.definedIn.properties.title}`);
  }

  if (lines.length === 0) {
    console.log(`memory: no structural impact for ${label}`);
    return;
  }
  console.log(`memory: structural impact for ${label}`);
  for (const line of lines) console.log(`  ${line}`);
}


export async function readChangedFiles(rootDir: string, comparison?: string): Promise<string[]> {
  const args = comparison
    ? ["diff", "--name-only", "--diff-filter=ACMRTUXB", comparison, "--"]
    : ["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD", "--"];
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: rootDir });
    return parseChangedFiles(stdout);
  } catch (err) {
    if (comparison) throw err;
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMRTUXB", "--"],
      { cwd: rootDir },
    );
    return parseChangedFiles(stdout);
  }
}


export function parseChangedFiles(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}


export function printPrePrReview(review: PrePrMemoryReview): void {
  const scope = review.comparison ? ` for ${review.comparison}` : "";
  console.log(`memory: pre-PR review${scope}`);
  if (review.changedFiles.length === 0) {
    console.log("changed files: no diff evidence");
  } else {
    console.log(`changed files: ${review.changedFiles.length}`);
    for (const file of review.changedFiles) console.log(`  ${file}`);
  }

  printPrePrSection("impacted concepts", review.impactedConcepts);
  printPrePrSection("related decisions", review.relatedDecisions);
  printPrePrSection("known failures", review.knownFailures);
  printPrePrSection("suggested validations", review.suggestedValidations);
  printPrePrSection("risks", review.risks);

  if (review.missingEvidence.length > 0) {
    console.log(`missing evidence: ${review.missingEvidence.join(", ")}`);
  }
  if (review.evidence.length > 0) {
    console.log("evidence:");
    for (const item of review.evidence) {
      const source = item.source ? ` source=${item.source}` : "";
      console.log(
        `  ${item.marker} ${item.urn} ${item.title} (${item.nodeType}, ${item.confidence}${source})`,
      );
    }
  }
}


export function printPrePrSection(title: string, section: PrePrReviewSection): void {
  console.log(`${title}:`);
  if (section.items.length === 0) {
    console.log("  missing evidence");
    return;
  }
  for (const item of section.items) {
    const citations = item.evidence.map((e) => e.marker).join(" ");
    console.log(`  - ${item.title} ${citations}`);
    console.log(`    ${item.summary}`);
  }
}


export function printReadinessEnvelope(envelope: MemoryReadinessEnvelope): void {
  console.log(`memory: readiness — ${envelope.status}`);
  console.log(`  goal: ${envelope.request.goal}`);
  console.log(
    `  evidence: ${envelope.retrieval.recall.active_evidence_count}/${envelope.retrieval.recall.evidence_count} active`,
  );
  console.log(
    `  vector: ${envelope.retrieval.vector.overall} (${envelope.retrieval.vector.ready}/${envelope.retrieval.vector.total} ready)`,
  );
  console.log(
    `  trust: provenance=${envelope.trust.provenance.nodes_with_provenance}/${envelope.trust.provenance.total_nodes} ` +
      `superseded=${envelope.trust.supersession.superseded_nodes} ` +
      `contradictions=${envelope.trust.contradictions.unresolved} ` +
      `privacy-findings=${envelope.trust.privacy.findings}`,
  );
  console.log(
    `  vcs: ${envelope.vcs.time_travel} (${envelope.vcs.collections
      .map((collection) => `${collection.name}:${collection.status}`)
      .join(", ")})`,
  );
  console.log(
    `  telemetry: ${envelope.operations.event_log.total_events} event(s) ` +
      `community-signals=${envelope.communities.communities}/${envelope.communities.assignments}`,
  );
  if (envelope.evidence.missing.missing) {
    console.log(
      `  missing evidence: ${envelope.evidence.missing.active_count}/${envelope.evidence.missing.expected_minimum} active`,
    );
    for (const message of envelope.evidence.missing.messages) console.log(`    ${message}`);
  }
  if (envelope.evidence.contradictions.length > 0) {
    console.log(`  contradictions: ${envelope.evidence.contradictions.length}`);
    for (const warning of envelope.evidence.contradictions) console.log(`    ${warning.message}`);
  }
  if (envelope.evidence.superseded.length > 0) {
    console.log(`  superseded evidence: ${envelope.evidence.superseded.length}`);
  }
  if (envelope.evidence.stale.length > 0) {
    console.log(`  stale evidence: ${envelope.evidence.stale.length}`);
  }
  if (envelope.skills.signal_status === "available" && envelope.skills.recommendations.length > 0) {
    console.log(
      `  skills: ${envelope.skills.recommendations.map((item) => item.name).join(", ")}`,
    );
  } else {
    console.log(`  skills: ${envelope.skills.status}`);
  }
  console.log(
    `  learning debt: ${envelope.learning_debt.status}` +
      (envelope.learning_debt.status === "available"
        ? ` (${envelope.learning_debt.debt_status})`
        : ""),
  );
  if (envelope.next_actions.length > 0) {
    console.log("  next actions:");
    for (const action of envelope.next_actions) console.log(`    - ${action}`);
  }
}
