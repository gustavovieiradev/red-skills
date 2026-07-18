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



export async function runHandoff(args: ParsedArgs): Promise<void> {
  const focus = args.positional.join(" ").trim();
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemoryHandoff(store, {
      focus: focus || undefined,
      limit: intFlag(args.flags, "limit"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(report.markdown);
  } finally {
    await store.close();
  }
}


export async function runHandoffViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const focus = args.positional.join(" ").trim();
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemoryHandoff(store, {
      focus: focus || undefined,
      limit: intFlag(args.flags, "limit"),
    });
    const artifact = buildMemoryHandoffViewerArtifact(report);
    const outPath = resolve(
      stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/handoff-viewer.html"),
    );
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: handoff viewer written ${outPath}`);
    console.log(`  status: ${report.status}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runWorkFrontier(args: ParsedArgs): Promise<void> {
  const focus = args.positional.join(" ").trim();
  const { store } = await openGraphStore(args);
  try {
    const report = await buildWorkFrontier(store, {
      focus: focus || undefined,
      limit: intFlag(args.flags, "limit"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(report.markdown);
  } finally {
    await store.close();
  }
}


export async function runWorkFrontierViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const focus = args.positional.join(" ").trim();
  const { store } = await openGraphStore(args);
  try {
    const report = await buildWorkFrontier(store, {
      focus: focus || undefined,
      limit: intFlag(args.flags, "limit"),
    });
    const artifact = buildWorkFrontierViewerArtifact(report);
    const outPath = resolve(
      stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/work-frontier.html"),
    );
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: work frontier viewer written ${outPath}`);
    console.log(`  status: ${report.status}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runMemoryDecay(args: ParsedArgs): Promise<void> {
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemoryDecayReport(store, {
      stale_days: intFlag(args.flags, "stale-days"),
      deprecate_days: intFlag(args.flags, "deprecate-days"),
      limit: intFlag(args.flags, "limit"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(report.markdown);
  } finally {
    await store.close();
  }
}


export async function runMemoryDecayViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemoryDecayReport(store, {
      stale_days: intFlag(args.flags, "stale-days"),
      deprecate_days: intFlag(args.flags, "deprecate-days"),
      limit: intFlag(args.flags, "limit"),
    });
    const artifact = buildMemoryDecayViewerArtifact(report);
    const outPath = resolve(
      stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/decay.html"),
    );
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: decay viewer written ${outPath}`);
    console.log(`  status: ${report.status}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runMemoryMergePass(args: ParsedArgs): Promise<void> {
  const action = args.positional[0];
  if (action === "execute") return runMemoryMergePassExecute(args);
  if (action === "unmerge") return runMemoryMergePassUnmerge(args);
  if (action && action !== "report") {
    throw new Error(
      "memory merge-pass action must be one of: report, execute, unmerge",
    );
  }

  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemoryMergePassReport(store, {
      min_score: numberFlag(args.flags, "min-score"),
      limit: intFlag(args.flags, "limit"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(report.markdown);
  } finally {
    await store.close();
  }
}


export async function runMemoryMergePassExecute(args: ParsedArgs): Promise<void> {
  if (args.flags.yes !== true) {
    throw new Error("memory merge-pass execute requires explicit --yes approval");
  }
  const { store } = await openGraphStore(args);
  try {
    const result = await executeMemoryMergeBatch(store, {
      candidate_ranks: commaIntegerFlag(args.flags, "candidate-ranks"),
      approver: stringFlag(args.flags, "approver") ?? "",
      batch_id: stringFlag(args.flags, "batch-id"),
      reason: stringFlag(args.flags, "reason"),
      min_score: numberFlag(args.flags, "min-score"),
      limit: intFlag(args.flags, "limit"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      `memory merge-pass execute: batch ${result.batch_id} merged ${result.summary.merged}/${result.summary.requested} candidate(s)`,
    );
    for (const edge of result.merged_edges) {
      console.log(
        `  ${edge.label} memory_nodes:${edge.duplicate_rid} -> memory_nodes:${edge.canonical_rid} rank=${edge.candidate_rank} score=${edge.score.toFixed(4)}`,
      );
    }
  } finally {
    await store.close();
  }
}


export async function runMemoryMergePassUnmerge(args: ParsedArgs): Promise<void> {
  if (args.flags.yes !== true) {
    throw new Error("memory merge-pass unmerge requires explicit --yes approval");
  }
  const { store } = await openGraphStore(args);
  try {
    const result = await unmergeMemoryMergeBatch(
      store,
      stringFlag(args.flags, "batch-id") ?? "",
    );
    if (args.flags.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      `memory merge-pass unmerge: batch ${result.batch_id} removed ${result.summary.removed}/${result.summary.found} edge(s)`,
    );
    for (const edge of result.removed_edges) {
      console.log(
        `  ${edge.removed ? "removed" : "missing"} ${edge.label} memory_nodes:${edge.duplicate_rid} -> memory_nodes:${edge.canonical_rid}`,
      );
    }
  } finally {
    await store.close();
  }
}


export async function runTidyReview(args: ParsedArgs): Promise<void> {
  const action = args.positional[0];
  if (action === "refresh") return runTidyReviewRefresh(args);
  if (action === "accept") return runTidyReviewAccept(args);
  if (action === "dismiss") return runTidyReviewDismiss(args);
  throw new Error("memory tidy-review action must be one of: refresh, accept, dismiss");
}


export async function runTidyReviewRefresh(args: ParsedArgs): Promise<void> {
  const { store, config } = await openGraphStore(args);
  try {
    const result = await refreshGovernanceTidyReviewArtifacts(store, {
      providerConfig: config.provider,
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      `memory tidy-review refresh: ${result.summary.recommendations} open/current recommendation(s), ${result.summary.stale} stale`,
    );
    for (const artifact of result.artifacts) {
      console.log(`  ${artifact.status} ${artifact.artifact_id}`);
    }
    for (const artifact of result.stale_artifacts) {
      console.log(`  stale ${artifact.artifact_id}`);
    }
  } finally {
    await store.close();
  }
}


export async function runTidyReviewAccept(args: ParsedArgs): Promise<void> {
  if (args.flags.yes !== true) {
    throw new Error("memory tidy-review accept requires explicit --yes approval");
  }
  const id = args.positional[1] ?? "";
  const { store } = await openGraphStore(args);
  try {
    const result = await acceptGovernanceTidyRecommendation(store, {
      id,
      approver: stringFlag(args.flags, "approver") ?? "",
      reason: stringFlag(args.flags, "reason"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      `memory tidy-review accept: ${result.edge.label} memory_nodes:${result.edge.from_rid} -> memory_nodes:${result.edge.to_rid}`,
    );
    console.log(`  artifact: ${result.artifact_id}`);
  } finally {
    await store.close();
  }
}


export async function runTidyReviewDismiss(args: ParsedArgs): Promise<void> {
  if (args.flags.yes !== true) {
    throw new Error("memory tidy-review dismiss requires explicit --yes approval");
  }
  const id = args.positional[1] ?? "";
  const { store } = await openGraphStore(args);
  try {
    const result = await dismissGovernanceTidyRecommendation(store, {
      id,
      approver: stringFlag(args.flags, "approver") ?? "",
      reason: stringFlag(args.flags, "reason"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`memory tidy-review dismiss: ${result.artifact_id}`);
  } finally {
    await store.close();
  }
}


export async function runSessionShow(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const id = await sessionCurrent(rootDir);
  if (args.flags.json === true) {
    console.log(JSON.stringify({ session_id: id }, null, 2));
    return;
  }
  console.log(id ?? "none");
}


export async function runSessionStart(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const explicit = stringFlag(args.flags, "id");
  const id = await sessionStart(rootDir, explicit ? { id: explicit } : {});
  if (args.flags.json === true) {
    console.log(JSON.stringify({ session_id: id }, null, 2));
    return;
  }
  console.log(`memory: session started — ${id}`);
}


export async function runSessionEnd(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  await sessionEnd(rootDir);
  if (args.flags.json === true) {
    console.log(JSON.stringify({ ok: true }, null, 2));
    return;
  }
  console.log("memory: session ended");
}


export async function runSession(args: ParsedArgs): Promise<void> {
  const action = args.positional[0];
  if (action === "show") return runSessionShow(args);
  if (action === "start") return runSessionStart(args);
  if (action === "end") return runSessionEnd(args);
  if (action !== "timeline" && action !== "timeline-viewer") {
    throw new Error(
      "session needs an action — supported: memory session show|start|end|timeline|timeline-viewer",
    );
  }
  const { store } = await openGraphStore(args);
  try {
    const timeline = await buildSessionTimeline(store, {
      sessionId: stringFlag(args.flags, "session"),
      limit: intFlag(args.flags, "limit"),
    });
    if (action === "timeline-viewer") {
      const rootDir = rootOf(args.flags);
      const outPath = resolve(
        stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/session-timeline.html"),
      );
      const artifact = buildSessionTimelineViewerArtifact(timeline);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, artifact.html, "utf8");
      console.log(`memory: session timeline viewer written ${outPath}`);
      console.log(`  events: ${timeline.summary.events}`);
      console.log(`  contract: ${artifact.contract.consumes}`);
      return;
    }
    if (args.flags.json === true) {
      console.log(JSON.stringify(timeline, null, 2));
      return;
    }
    const scope = timeline.filter.session_id ? ` for ${timeline.filter.session_id}` : "";
    console.log(`memory: session timeline${scope} — ${timeline.summary.events} event(s)`);
    for (const entry of timeline.entries) {
      console.log(
        `  ${entry.occurred_at} ${entry.session_id} ${entry.actor} ${entry.title} [${entry.outcome}]`,
      );
      if (entry.detail) console.log(`      ${entry.detail}`);
    }
    for (const action of timeline.recommended_next_actions) console.log(`  next: ${action}`);
  } finally {
    await store.close();
  }
}


export async function runWorking(args: ParsedArgs): Promise<void> {
  const action = args.positional[0];
  if (
    action !== "append" &&
    action !== "get" &&
    action !== "raw" &&
    action !== "evict"
  ) {
    throw new Error(
      "working needs an action — supported: memory working append|get|raw|evict",
    );
  }
  const rootDir = rootOf(args.flags);
  const { store } = await openGraphStore(args);
  try {
    if (action === "append") {
      const type = stringFlag(args.flags, "type");
      const value = stringFlag(args.flags, "value");
      if (!type) throw new Error("working append requires --type <event-type>");
      if (value == null) throw new Error("working append requires --value <text>");
      const event = await workingAppendEvent(store, rootDir, { type, value });
      if (args.flags.json === true) {
        console.log(JSON.stringify(event, null, 2));
        return;
      }
      console.log(
        `memory: working append ok — session=${event.session_id} type=${event.type} seq=${event.sequence}`,
      );
      return;
    }
    if (action === "get") {
      const type = stringFlag(args.flags, "type");
      const events = await workingListEvents(store, rootDir, type ? { type } : {});
      if (args.flags.json === true) {
        console.log(JSON.stringify({ events }, null, 2));
        return;
      }
      const scope = type ? ` type=${type}` : "";
      console.log(`memory: working get${scope} — ${events.length} event(s)`);
      for (const e of events) {
        console.log(`  #${e.sequence} ${new Date(e.created_at).toISOString()} ${e.type}  ${e.value}`);
      }
      return;
    }
    if (action === "evict") {
      const config = await readConfig(rootDir);
      const defaults = resolveL2Policy(config);
      const ttlMs = intFlag(args.flags, "ttl-ms") ?? defaults.ttlMs;
      const byteBudget = intFlag(args.flags, "byte-budget") ?? defaults.byteBudget;
      const report = await evictL2(store, { ttlMs, byteBudget });
      if (args.flags.json === true) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(
        `memory: working evict — scanned=${report.scanned_nodes} evicted=${report.evicted.length} (ttl_ms=${ttlMs} byte_budget=${byteBudget})`,
      );
      for (const rec of report.evicted) {
        console.log(`  ${rec.reason}  rid=${rec.rid}  session=${rec.session_id}  ${rec.label}  bytes=${rec.bytes}`);
      }
      for (const s of report.by_session) {
        if (s.byte_budget_triggered) {
          console.log(
            `  session=${s.session_id}: ${s.bytes_before}B → ${s.bytes_after}B (${s.evicted} event(s) evicted by budget)`,
          );
        }
      }
      return;
    }
    // action === "raw"
    const setVal = stringFlag(args.flags, "set");
    if (setVal != null) {
      const result = await workingSetRaw(store, rootDir, setVal);
      if (args.flags.json === true) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(
        `memory: working raw set — session=${result.session_id} bytes=${Buffer.byteLength(result.value, "utf8")}`,
      );
      return;
    }
    const got = await workingGetRaw(store, rootDir);
    if (args.flags.json === true) {
      console.log(JSON.stringify(got, null, 2));
      return;
    }
    if (!got) {
      console.log("memory: working raw — (none)");
      return;
    }
    console.log(got.value);
  } finally {
    await store.close();
  }
}
