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



export async function runAssets(args: ParsedArgs): Promise<void> {
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemoryAssetInventory(store, {
      kind: stringFlag(args.flags, "kind"),
      query: args.positional.join(" ").trim() || undefined,
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(
      `memory assets: ${report.total_assets} asset(s), ${formatAssetBytes(report.total_bytes)}`,
    );
    for (const kind of report.kinds) {
      console.log(`  ${kind.kind}: ${kind.count} asset(s), ${formatAssetBytes(kind.bytes)}`);
    }
    for (const warning of report.warnings) console.log(`  warning: ${warning}`);
    for (const asset of report.assets) {
      console.log(
        `  ${asset.path}: ${asset.asset_kind}, ${asset.media_type}, ${formatAssetBytes(asset.bytes)}`,
      );
    }
  } finally {
    await store.close();
  }
}


export async function runAssetsViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/asset-inventory-viewer.html"),
  );
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemoryAssetInventory(store, {
      kind: stringFlag(args.flags, "kind"),
      query: args.positional.join(" ").trim() || undefined,
    });
    const artifact = buildMemoryAssetInventoryViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: asset inventory viewer written ${outPath}`);
    console.log(`  assets: ${report.total_assets}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export function formatAssetBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


export async function runDocsBundle(args: ParsedArgs): Promise<void> {
  const query = args.positional.slice(1).join(" ").trim();
  if (!query) throw new Error("nothing to bundle — pass a query: memory docs bundle <query>");
  const { store } = await openGraphStore(args);
  try {
    const bundle = await buildDocBundle(store, {
      query,
      limit: intFlag(args.flags, "limit"),
      max_bytes: intFlag(args.flags, "max-bytes"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(bundle, null, 2));
      return;
    }
    process.stdout.write(bundle.markdown);
  } finally {
    await store.close();
  }
}


export async function runDocsSearchViewer(args: ParsedArgs): Promise<void> {
  const query = args.positional.slice(1).join(" ").trim();
  if (!query) {
    throw new Error("nothing to render — pass a query: memory docs search-viewer <query>");
  }
  const rootDir = rootOf(args.flags);
  const safeName = createHash("sha256").update(query).digest("hex").slice(0, 12);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, `.red/memory/doc-search-${safeName}.html`),
  );
  const { store } = await openGraphStore(args);
  try {
    const report = await searchDocs(store, query, { limit: intFlag(args.flags, "limit") });
    const artifact = buildDocSearchViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: doc search viewer written ${outPath}`);
    console.log(`  hits: ${report.hits.length}/${report.total_docs}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runDocsBundleViewer(args: ParsedArgs): Promise<void> {
  const query = args.positional.slice(1).join(" ").trim();
  if (!query) {
    throw new Error("nothing to render — pass a query: memory docs bundle-viewer <query>");
  }
  const rootDir = rootOf(args.flags);
  const safeName = createHash("sha256").update(query).digest("hex").slice(0, 12);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, `.red/memory/doc-bundle-${safeName}.html`),
  );
  const { store } = await openGraphStore(args);
  try {
    const bundle = await buildDocBundle(store, {
      query,
      limit: intFlag(args.flags, "limit"),
      max_bytes: intFlag(args.flags, "max-bytes"),
    });
    const artifact = buildDocBundleViewerArtifact(bundle);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: doc bundle viewer written ${outPath}`);
    console.log(`  hits: ${bundle.hits.length}/${bundle.total_docs}`);
    console.log(`  packs: ${bundle.packs.length}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runDocsCoverage(args: ParsedArgs): Promise<void> {
  const { store } = await openGraphStore(args);
  try {
    const report = await buildDocCoverageReport(store);
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(
      `memory docs coverage: ${report.grounded_docs}/${report.total_docs} grounded, ${report.docs_with_references} with references`,
    );
    console.log(
      `  vectors: ${report.vector.overall} (${report.vector.ready}/${report.vector.total} ready)`,
    );
    for (const warning of report.warnings) console.log(`  warning: ${warning}`);
    for (const doc of report.docs) {
      const title = doc.title ? ` — ${doc.title}` : "";
      console.log(
        `  ${doc.path}${title}: ${doc.graph_status}, refs=${doc.references.count}, vector=${doc.vector_status}`,
      );
    }
  } finally {
    await store.close();
  }
}


export async function runDocsCoverageViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/doc-coverage-viewer.html"),
  );
  const { store } = await openGraphStore(args);
  try {
    const report = await buildDocCoverageReport(store);
    const artifact = buildDocCoverageViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: doc coverage viewer written ${outPath}`);
    console.log(`  docs: ${report.total_docs}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runDocsReferenceGraph(args: ParsedArgs): Promise<void> {
  const { store } = await openGraphStore(args);
  try {
    const report = await buildDocReferenceGraphReport(store);
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(
      `memory docs reference-graph: ${report.reference_edges} edge(s), ${report.reference_nodes} referenced node(s), ${report.grounded_docs}/${report.total_docs} grounded docs`,
    );
    for (const warning of report.warnings) console.log(`  warning: ${warning}`);
    for (const ref of report.top_references.slice(0, 10)) {
      console.log(
        `  ${ref.node.title} (${ref.node.label}) referenced by ${ref.incoming_docs} doc(s)`,
      );
    }
  } finally {
    await store.close();
  }
}


export async function runDocsReferenceGraphViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/doc-reference-graph-viewer.html"),
  );
  const { store } = await openGraphStore(args);
  try {
    const report = await buildDocReferenceGraphReport(store);
    const artifact = buildDocReferenceGraphViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: doc reference graph viewer written ${outPath}`);
    console.log(`  edges: ${report.reference_edges}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runDocsRelated(args: ParsedArgs): Promise<void> {
  const target = args.positional.slice(1).join(" ").trim();
  if (!target) throw new Error("nothing to relate — pass a path or rid: memory docs related <path|rid>");
  const { store } = await openGraphStore(args);
  try {
    const report = await buildDocRelatedReport(store, {
      ...(isIntegerText(target) ? { rid: Number(target) } : { path: target }),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (!report.found || !report.target) {
      console.log(`memory docs related: no document found for ${target}`);
      return;
    }
    console.log(
      `memory docs related: ${report.target.path ?? report.target.title} (${report.references.length} reference(s), ${report.related_docs.length} related doc(s))`,
    );
    for (const warning of report.warnings) console.log(`  warning: ${warning}`);
    for (const ref of report.references.slice(0, 10)) {
      console.log(`  ref: ${ref.title} (${ref.label})`);
    }
    for (const doc of report.related_docs.slice(0, 10)) {
      console.log(`  related: ${doc.path} (${doc.shared_references} shared reference(s))`);
    }
  } finally {
    await store.close();
  }
}


export async function runDocsBacklinks(args: ParsedArgs): Promise<void> {
  const target = args.positional.slice(1).join(" ").trim();
  if (!target) {
    throw new Error("nothing to trace — pass a label, title, or rid: memory docs backlinks <label|rid>");
  }
  const { store } = await openGraphStore(args);
  try {
    const report = await buildDocBacklinksReport(store, {
      ...(isIntegerText(target) ? { rid: Number(target) } : { query: target }),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (!report.found) {
      console.log(`memory docs backlinks: no referenced node found for ${target}`);
      for (const warning of report.warnings) console.log(`  warning: ${warning}`);
      return;
    }
    console.log(
      `memory docs backlinks: ${report.references.length} reference node(s), ${report.docs.length} doc(s) for ${target}`,
    );
    for (const warning of report.warnings) console.log(`  warning: ${warning}`);
    for (const ref of report.references.slice(0, 5)) {
      console.log(`  ref: ${ref.title} (${ref.label})`);
    }
    for (const doc of report.docs.slice(0, 10)) {
      console.log(`  doc: ${doc.path} (${doc.matched_references} matched reference(s))`);
    }
  } finally {
    await store.close();
  }
}


export async function runDocsBacklinksViewer(args: ParsedArgs): Promise<void> {
  const target = args.positional.slice(1).join(" ").trim();
  if (!target) {
    throw new Error(
      "nothing to render — pass a label, title, or rid: memory docs backlinks-viewer <label|rid>",
    );
  }
  const rootDir = rootOf(args.flags);
  const safeName = isIntegerText(target)
    ? `rid-${target}`
    : createHash("sha256").update(target).digest("hex").slice(0, 12);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, `.red/memory/doc-backlinks-${safeName}.html`),
  );
  const { store } = await openGraphStore(args);
  try {
    const report = await buildDocBacklinksReport(store, {
      ...(isIntegerText(target) ? { rid: Number(target) } : { query: target }),
    });
    const artifact = buildDocBacklinksViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: doc backlinks viewer written ${outPath}`);
    console.log(`  found: ${report.found}`);
    console.log(`  docs: ${report.docs.length}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runDocsRelatedViewer(args: ParsedArgs): Promise<void> {
  const target = args.positional.slice(1).join(" ").trim();
  if (!target) {
    throw new Error("nothing to render — pass a path or rid: memory docs related-viewer <path|rid>");
  }
  const rootDir = rootOf(args.flags);
  const safeName = isIntegerText(target)
    ? `rid-${target}`
    : createHash("sha256").update(target).digest("hex").slice(0, 12);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, `.red/memory/doc-related-${safeName}.html`),
  );
  const { store } = await openGraphStore(args);
  try {
    const report = await buildDocRelatedReport(store, {
      ...(isIntegerText(target) ? { rid: Number(target) } : { path: target }),
    });
    const artifact = buildDocRelatedViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: doc related viewer written ${outPath}`);
    console.log(`  found: ${report.found}`);
    console.log(`  related: ${report.related_docs.length}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runDocsRead(args: ParsedArgs): Promise<void> {
  const target = args.positional.slice(1).join(" ").trim();
  if (!target) throw new Error("nothing to read — pass a path or rid: memory docs read <path|rid>");
  const { store } = await openGraphStore(args);
  try {
    const report = await readDoc(store, {
      ...(isIntegerText(target) ? { rid: Number(target) } : { path: target }),
      max_bytes: intFlag(args.flags, "max-bytes"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (!report.found) {
      console.log(`memory docs: no document found for ${target}`);
      return;
    }
    const title = report.title ? ` — ${report.title}` : "";
    const suffix = report.truncated
      ? ` (truncated ${report.returned_bytes}/${report.body_bytes} bytes)`
      : "";
    console.log(`memory docs: ${report.path}${title}${suffix}`);
    if (report.body) process.stdout.write(`${report.body}\n`);
  } finally {
    await store.close();
  }
}


export async function runDocsEvidencePack(args: ParsedArgs): Promise<void> {
  const target = args.positional.slice(1).join(" ").trim();
  if (!target) {
    throw new Error(
      "nothing to pack — pass a path or rid: memory docs evidence-pack <path|rid>",
    );
  }
  const { store } = await openGraphStore(args);
  try {
    const pack = await buildDocEvidencePack(store, {
      ...(isIntegerText(target) ? { rid: Number(target) } : { path: target }),
      max_bytes: intFlag(args.flags, "max-bytes"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(pack, null, 2));
      return;
    }
    process.stdout.write(pack.markdown);
  } finally {
    await store.close();
  }
}


export async function runDocsEvidencePackViewer(args: ParsedArgs): Promise<void> {
  const target = args.positional.slice(1).join(" ").trim();
  if (!target) {
    throw new Error(
      "nothing to render — pass a path or rid: memory docs evidence-pack-viewer <path|rid>",
    );
  }
  const rootDir = rootOf(args.flags);
  const safeName = isIntegerText(target)
    ? `rid-${target}`
    : createHash("sha256").update(target).digest("hex").slice(0, 12);
  const outPath = resolve(
    stringFlag(args.flags, "out") ??
      join(rootDir, `.red/memory/doc-evidence-pack-${safeName}.html`),
  );
  const { store } = await openGraphStore(args);
  try {
    const pack = await buildDocEvidencePack(store, {
      ...(isIntegerText(target) ? { rid: Number(target) } : { path: target }),
      max_bytes: intFlag(args.flags, "max-bytes"),
    });
    const artifact = buildDocEvidencePackViewerArtifact(pack);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: doc evidence pack viewer written ${outPath}`);
    console.log(`  found: ${pack.found}`);
    console.log(`  references: ${pack.related.references.length}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runDocsRestore(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const target = args.positional.slice(1).join(" ").trim();
  const dryRun = args.flags["dry-run"] === true || args.flags.yes !== true;
  const { store } = await openGraphStore(args);
  try {
    const report = await restoreDocsFromMemory(store, {
      rootDir,
      ...(target
        ? isIntegerText(target)
          ? { targetRid: Number(target) }
          : { targetPath: target }
        : {}),
      outDir: stringFlag(args.flags, "out"),
      inPlace: args.flags["in-place"] === true,
      overwrite: args.flags.overwrite === true,
      dryRun,
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const mode = report.dry_run ? "dry-run" : "restore";
    console.log(
      `memory docs ${mode}: ${report.summary.restored} restored, ${report.summary.planned} planned, ${report.summary.skipped} skipped, ${report.summary.missing} missing`,
    );
    if (report.dry_run) console.log("  pass --yes to write restored document files");
    for (const item of report.items) {
      const reason = item.reason ? ` (${item.reason})` : "";
      console.log(`  ${item.status}: ${item.source_path} -> ${item.destination_path}${reason}`);
    }
    for (const action of report.recommended_next_actions) console.log(`  next: ${action}`);
  } finally {
    await store.close();
  }
}


export async function runBackup(args: ParsedArgs): Promise<void> {
  const action = args.positional[0] ?? "create";
  const rootDir = rootOf(args.flags);
  const json = args.flags.json === true;

  if (action === "create") {
    await requireConfig(rootDir);
    const result = await createMemoryBackup(rootDir, { name: stringFlag(args.flags, "name") });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`memory: backup created ${result.manifest.name}`);
    console.log(`  dir: ${result.backup_dir}`);
    console.log(`  files: ${result.files} bytes=${result.bytes}`);
    for (const warning of result.manifest.warnings) console.log(`  warning: ${warning}`);
    return;
  }

  if (action === "list") {
    const backups = await listMemoryBackups(rootDir);
    if (json) {
      console.log(JSON.stringify({ schema_version: "memory.backup.list.v1", backups }, null, 2));
      return;
    }
    console.log(`memory backups: ${backups.length}`);
    for (const backup of backups) {
      console.log(
        `  ${backup.name} ${backup.mode} files=${backup.files} bytes=${backup.bytes} created=${backup.created_at}`,
      );
    }
    return;
  }

  if (action === "inspect") {
    const name = args.positional[1];
    if (!name) throw new Error("memory backup inspect needs a backup name");
    const manifest = await readMemoryBackupManifest(rootDir, name);
    if (json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    console.log(`memory backup: ${manifest.name}`);
    console.log(`  created: ${manifest.created_at}`);
    console.log(`  mode: ${manifest.mode}`);
    console.log(`  files: ${manifest.files.length}`);
    for (const file of manifest.files.slice(0, 20)) {
      console.log(`  ${file.path} ${file.bytes} ${file.sha256.slice(0, 12)}`);
    }
    if (manifest.files.length > 20) console.log(`  ... ${manifest.files.length - 20} more`);
    return;
  }

  if (action === "restore") {
    const name = args.positional[1];
    if (!name) throw new Error("memory backup restore needs a backup name");
    if (args.flags.yes !== true) {
      throw new Error("memory backup restore requires explicit --yes approval");
    }
    const result = await restoreMemoryBackup(rootDir, name);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`memory: restored backup ${result.restored_from}`);
    console.log(`  restored: ${result.restored_files} files bytes=${result.restored_bytes}`);
    console.log(`  safety backup: ${result.safety_backup.manifest.name}`);
    for (const warning of result.warnings) console.log(`  warning: ${warning}`);
    return;
  }

  throw new Error("backup needs an action — supported: create, list, inspect, restore");
}


export async function runServe(args: ParsedArgs): Promise<void> {
  const rootDir = resolve(rootOf(args.flags));
  const host = stringFlag(args.flags, "host") ?? "127.0.0.1";
  const port = intFlag(args.flags, "port") ?? 49375;
  const tokenEnv = stringFlag(args.flags, "token-env");
  const token = tokenEnv ? process.env[tokenEnv] : undefined;
  if (tokenEnv && !token) throw new Error(`--token-env ${tokenEnv} is not set`);

  const { store, config } = await openGraphStore(args);
  const server = createMemoryHttpServer({
    rootDir,
    store,
    token,
    memoryConfig: config,
    providerConfig: config.provider,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`memory: serving read-only HTTP on http://${host}:${actualPort}/`);
      console.log(`  workbench: http://${host}:${actualPort}/workbench`);
      console.log(`  dashboard: http://${host}:${actualPort}/dashboard`);
      console.log(`  docs graph: http://${host}:${actualPort}/docs/reference-graph`);
      console.log(`  recall API: http://${host}:${actualPort}/api/recall?query=...`);
      console.log(`  auth: ${token ? `bearer token from ${tokenEnv}` : "none"}`);
    });

    const shutdown = () => {
      server.close(() => {
        store.close().finally(resolve);
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
