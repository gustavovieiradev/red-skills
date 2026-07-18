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



export async function runLearningDebt(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `learning-debt needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }
  const telemetryEnabled = skillTelemetryEnabled(config);
  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const report = await buildLearningDebtReport(store, {
      staleDays: intFlag(args.flags, "stale-days"),
      rollups: telemetryEnabled ? await readSkillRollups(store) : [],
      skillTelemetryEnabled: telemetryEnabled,
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    process.stdout.write(report.markdown);
  } finally {
    await store.close();
  }
}


export async function runLearningDebtViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `learning-debt-viewer needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }
  const telemetryEnabled = skillTelemetryEnabled(config);
  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const report = await buildLearningDebtReport(store, {
      staleDays: intFlag(args.flags, "stale-days"),
      rollups: telemetryEnabled ? await readSkillRollups(store) : [],
      skillTelemetryEnabled: telemetryEnabled,
    });
    const artifact = buildLearningDebtViewerArtifact(report);
    const outPath = resolve(
      stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/learning-debt-viewer.html"),
    );
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: learning debt viewer written ${outPath}`);
    console.log(`  status: ${report.status}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runOnboardingMap(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  if (args.positional[0] === "export") {
    return runOnboardingMapExport(args, rootDir);
  }
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `onboarding-map needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }
  const telemetryEnabled = skillTelemetryEnabled(config);
  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const map = await buildOnboardingMap(store, {
      staleDays: intFlag(args.flags, "stale-days"),
      rollups: telemetryEnabled ? await readSkillRollups(store) : [],
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(map, null, 2));
      return;
    }
    process.stdout.write(map.markdown);
  } finally {
    await store.close();
  }
}


export async function runOnboardingMapViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `onboarding-map-viewer needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }
  const outPath =
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/onboarding-map-viewer.html");
  const telemetryEnabled = skillTelemetryEnabled(config);
  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const map = await buildOnboardingMap(store, {
      staleDays: intFlag(args.flags, "stale-days"),
      rollups: telemetryEnabled ? await readSkillRollups(store) : [],
    });
    const artifact = buildOnboardingMapViewerArtifact(map);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: onboarding map viewer written ${outPath}`);
    console.log(`  status: ${artifact.map.status}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runRoutingGuide(args: ParsedArgs): Promise<void> {
  const guide = buildMemoryRoutingGuide({ agent: routingAgentFlag(args.flags) });
  if (args.flags.json === true) {
    console.log(JSON.stringify(guide, null, 2));
    return;
  }
  printRoutingGuide(guide);
}


export async function runRoutingGuideViewer(args: ParsedArgs): Promise<void> {
  const rootDir = resolve(rootOf(args.flags));
  const guide = buildMemoryRoutingGuide({ agent: routingAgentFlag(args.flags) });
  const artifact = buildMemoryRoutingGuideViewerArtifact(guide);
  const outPath =
    stringFlag(args.flags, "out") ??
    join(rootDir, ".red/memory", `routing-guide-${guide.agent}.html`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, artifact.html, "utf8");
  console.log(`memory: routing guide viewer written ${outPath}`);
  console.log(`  agent: ${guide.agent}`);
  console.log(`  contract: ${artifact.contract.consumes}`);
}


export async function runAgentIntegrationStatus(args: ParsedArgs): Promise<void> {
  const rootDir = resolve(rootOf(args.flags));
  const report = await buildMemoryAgentIntegrationStatus(rootDir, {
    agent: routingAgentFlag(args.flags),
  });
  if (args.flags.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`memory: agent integration status (${report.schema_version})`);
  console.log(
    `  ready=${report.summary.ready} partial=${report.summary.partial} missing=${report.summary.missing}`,
  );
  for (const agent of report.agents) {
    console.log(`  ${agent.agent}: ${agent.state} (${agent.target_files.map((file) => file.path).join(", ")})`);
  }
}


export async function runAgentIntegrationStatusViewer(args: ParsedArgs): Promise<void> {
  const rootDir = resolve(rootOf(args.flags));
  const report = await buildMemoryAgentIntegrationStatus(rootDir, {
    agent: routingAgentFlag(args.flags),
  });
  const artifact = buildMemoryAgentIntegrationStatusViewerArtifact(report);
  const outPath =
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/agent-integration-status.html");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, artifact.html, "utf8");
  console.log(`memory: agent integration status viewer written ${outPath}`);
  console.log(`  ready: ${report.summary.ready}/${report.summary.agents}`);
  console.log(`  contract: ${artifact.contract.consumes}`);
}


export function routingAgentFlag(flags: Record<string, string | boolean>): MemoryRoutingAgent | undefined {
  const value = stringFlag(flags, "agent");
  if (value == null) return undefined;
  if (
    value === "codex" ||
    value === "claude" ||
    value === "cursor" ||
    value === "gemini" ||
    value === "aider" ||
    value === "opencode" ||
    value === "generic"
  ) {
    return value;
  }
  throw new Error("routing-guide --agent must be codex, claude, cursor, gemini, aider, opencode, or generic");
}


export function printRoutingGuide(guide: MemoryRoutingGuide): void {
  console.log(`memory: routing guide (${guide.schemaVersion}, agent=${guide.agent})`);
  console.log(`target files: ${guide.targetFiles.join(", ")}`);
  console.log("");
  process.stdout.write(guide.installSnippet);
}


export interface PublicCodebaseMapMetadata {
  schemaVersion: 1;
  kind: "memory.codebase-map.public-export";
  publicSafe: true;
  generatedAt: string;
  source: {
    gitCommit: string | null;
    graphState: {
      nodes: number;
      edges: number;
      maxRid: number;
      fingerprint: string;
    };
  };
  privacy: {
    scanned: true;
    status: PrivacyReport["status"];
    findings: number;
    findingKinds: string[];
    redacted: boolean;
    strict: boolean;
    warnings: string[];
  };
  artifacts: {
    json: string;
    markdown: string;
  };
}


export async function runOnboardingMapExport(args: ParsedArgs, rootDir: string): Promise<void> {
  if (args.flags["public-safe"] !== true) {
    throw new Error(
      "onboarding-map export writes demo/comparison artifacts and requires --public-safe",
    );
  }

  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `onboarding-map export needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }

  const target = args.positional[1] ?? ".red/memory/public-codebase-map";
  const outDir = isAbsolute(target) ? target : resolve(rootDir, target);
  const strict = args.flags.strict === true;
  const privacy = await scanPrivacy(resolve(rootDir));
  if (privacy.status !== "ok") {
    throw new Error(
      `public-safe export refused: privacy scan could not guarantee safe output (${privacy.warnings.join("; ") || privacy.status})`,
    );
  }
  if (strict && privacy.findings.length > 0) {
    throw new Error(publicSafeRefusalMessage(privacy.findings));
  }

  const telemetryEnabled = skillTelemetryEnabled(config);
  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const map = await buildOnboardingMap(store, {
      staleDays: intFlag(args.flags, "stale-days"),
      rollups: telemetryEnabled ? await readSkillRollups(store) : [],
    });
    const safeMap = redactSensitiveValue(map) as OnboardingMapExportShape;
    const [nodes, edges] = await Promise.all([store.listNodes(), store.listEdges()]);
    const redacted = privacy.findings.length > 0;
    const artifacts = {
      jsonPath: join(outDir, "codebase-map.json"),
      markdownPath: join(outDir, "codebase-map.md"),
      metadataPath: join(outDir, "public-export-metadata.json"),
    };
    const metadata: PublicCodebaseMapMetadata = {
      schemaVersion: 1,
      kind: "memory.codebase-map.public-export",
      publicSafe: true,
      generatedAt: new Date().toISOString(),
      source: {
        gitCommit: await currentGitCommit(rootDir),
        graphState: graphStateMetadata(nodes, edges),
      },
      privacy: {
        scanned: true,
        status: privacy.status,
        findings: privacy.findings.length,
        findingKinds: [...new Set(privacy.findings.map((finding) => finding.kind))].sort(),
        redacted,
        strict,
        warnings: privacy.warnings,
      },
      artifacts: {
        json: "codebase-map.json",
        markdown: "codebase-map.md",
      },
    };

    await mkdir(outDir, { recursive: true });
    await Promise.all([
      writeFile(artifacts.jsonPath, `${JSON.stringify(safeMap, null, 2)}\n`, "utf8"),
      writeFile(artifacts.markdownPath, safeMap.markdown, "utf8"),
      writeFile(artifacts.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
    ]);

    const payload = {
      publicSafe: true,
      redacted,
      privacy: {
        scanned: true,
        status: privacy.status,
        findings: privacy.findings.length,
        diagnostics: privacy.findings.map(publicFindingDiagnostic),
        warnings: privacy.warnings,
      },
      artifacts,
      metadata,
    };
    if (args.flags.json === true) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    const evidenceItems =
      safeMap.summary.concepts +
      safeMap.summary.workflows +
      safeMap.summary.decisions +
      safeMap.summary.risks +
      safeMap.summary.validations;
    console.log(`memory: public-safe codebase map export — ${evidenceItems} evidence item(s)`);
    if (privacy.findings.length > 0) {
      console.log(`  warning: redacted ${privacy.findings.length} privacy finding(s)`);
      for (const finding of privacy.findings.slice(0, 10)) {
        const diagnostic = publicFindingDiagnostic(finding);
        console.log(`  - ${diagnostic.kind} ${diagnostic.location}: ${diagnostic.excerpt}`);
      }
    }
    console.log(`  json:     ${artifacts.jsonPath}`);
    console.log(`  markdown: ${artifacts.markdownPath}`);
    console.log(`  metadata: ${artifacts.metadataPath}`);
  } finally {
    await store.close();
  }
}


export type OnboardingMapExportShape = Awaited<ReturnType<typeof buildOnboardingMap>>;


export function publicSafeRefusalMessage(findings: PrivacyFinding[]): string {
  const lines = [
    `public-safe export refused: privacy scan found ${findings.length} sensitive-looking value(s); rerun without --strict to write redacted artifacts.`,
  ];
  for (const finding of findings.slice(0, 10)) {
    const diagnostic = publicFindingDiagnostic(finding);
    lines.push(`- ${diagnostic.kind} ${diagnostic.location}: ${diagnostic.excerpt}`);
  }
  if (findings.length > 10) lines.push(`- ... and ${findings.length - 10} more`);
  return lines.join("\n");
}


export function publicFindingDiagnostic(finding: PrivacyFinding): {
  kind: PrivacyFinding["kind"];
  location: string;
  excerpt: string;
} {
  return {
    kind: finding.kind,
    location: finding.location,
    excerpt: finding.excerpt,
  };
}


export async function currentGitCommit(rootDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}


export function graphStateMetadata(
  nodes: Array<{ rid: number; node_type: string }>,
  edges: Record<string, unknown>[],
): PublicCodebaseMapMetadata["source"]["graphState"] {
  const structural = {
    nodes: nodes
      .map((node) => ({ rid: node.rid, node_type: node.node_type }))
      .sort((a, b) => a.rid - b.rid),
    edges: edges
      .map((edge) => ({
        rid: Number(edge.rid ?? edge.red_entity_id ?? 0),
        label: String(edge.label ?? edge.LABEL ?? ""),
        from: Number(edge.from ?? edge.from_id ?? edge.from_rid ?? edge.source ?? edge.FROM ?? 0),
        to: Number(edge.to ?? edge.to_id ?? edge.to_rid ?? edge.target ?? edge.TO ?? 0),
      }))
      .sort(
        (a, b) =>
          a.rid - b.rid || a.label.localeCompare(b.label) || a.from - b.from || a.to - b.to,
      ),
  };
  return {
    nodes: structural.nodes.length,
    edges: structural.edges.length,
    maxRid: Math.max(0, ...structural.nodes.map((node) => node.rid)),
    fingerprint: createHash("sha256").update(JSON.stringify(structural)).digest("hex"),
  };
}


export async function runAsk(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const question = args.positional.join(" ").trim();
  if (!question) throw new Error("nothing to ask — pass a question: memory ask <question>");
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `ask needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }

  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const result = await ask(store, question, { rootDir });
    if (args.flags.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`memory ask: ${result.status}`);
    if (result.answer) console.log(result.answer);
    if (result.error) console.log(`provider: unavailable (${result.error})`);
    console.log(`citations: ${result.citations.length}`);
    for (const item of [...result.evidence.active, ...result.evidence.superseded]) {
      const source = item.source ? ` source=${item.source}` : "";
      console.log(
        `  ${item.citation} memory_nodes:${item.rid} ${item.title} (${item.confidence}, ${item.status}${source})`,
      );
    }
    if (result.evidence.contradictory.length > 0) {
      console.log(`contradictions: ${result.evidence.contradictory.length}`);
      for (const item of result.evidence.contradictory) {
        const state = item.resolved ? `resolved active=${item.activeRid}` : "unresolved";
        const reason = item.reason ? ` reason=${item.reason}` : "";
        console.log(`  ${item.from.citation} contradicts ${item.to.citation} (${state}${reason})`);
      }
    }
    console.log(`gap analysis: ${result.gap_analysis.status}`);
    console.log(`  ${result.gap_analysis.summary}`);
    for (const gap of result.gap_analysis.gaps) console.log(`  gap: ${gap}`);
    for (const action of result.gap_analysis.next_actions) console.log(`  next: ${action}`);
    if (result.what_i_dont_know.length > 0) {
      console.log(`what I don't know: ${result.what_i_dont_know.length}`);
      for (const item of result.what_i_dont_know) console.log(`  - ${item}`);
    }
    if (result.federation_hits.length > 0) {
      console.log(`federation hits: ${result.federation_hits.length}`);
      for (const hit of result.federation_hits) {
        console.log(
          `  ${hit.origin_repo}${hit.id ? `:${hit.id}` : ""} score=${hit.score} local=${hit.confidence_local} remote=${hit.confidence_remote}`,
        );
      }
    }
    if (result.cost) {
      console.log(
        `cost: ${result.cost.provider}/${result.cost.model} prompt=${result.cost.prompt_tokens} completion=${result.cost.completion_tokens} usd=${result.cost.cost_usd}`,
      );
    }
  } finally {
    await store.close();
  }
}


export async function runDocs(args: ParsedArgs): Promise<void> {
  const action = args.positional[0];
  const registryOperation = registryCliOperationFor("docs", args.positional);
  if (
    registryOperation &&
    PROOF_REGISTRY_CLI_COMMANDS.has(registryOperation.renderer.cli.command)
  ) {
    return runRegistryCliOperation(registryOperation, args);
  }
  if (action === "bundle") return runDocsBundle(args);
  if (action === "bundle-viewer") return runDocsBundleViewer(args);
  if (action === "read") return runDocsRead(args);
  if (action === "evidence-pack") return runDocsEvidencePack(args);
  if (action === "evidence-pack-viewer") return runDocsEvidencePackViewer(args);
  if (action === "backlinks") return runDocsBacklinks(args);
  if (action === "backlinks-viewer") return runDocsBacklinksViewer(args);
  if (action === "related") return runDocsRelated(args);
  if (action === "related-viewer") return runDocsRelatedViewer(args);
  if (action === "restore") return runDocsRestore(args);
  if (action === "coverage") return runDocsCoverage(args);
  if (action === "coverage-viewer") return runDocsCoverageViewer(args);
  if (action === "reference-graph") return runDocsReferenceGraph(args);
  if (action === "reference-graph-viewer") return runDocsReferenceGraphViewer(args);
  if (action === "search-viewer") return runDocsSearchViewer(args);
  if (action !== "search") {
    throw new Error(
      "docs needs an action — supported: memory docs search <query>, memory docs search-viewer <query>, memory docs brief <query>, memory docs brief-viewer <query>, memory docs bundle <query>, memory docs bundle-viewer <query>, memory docs read <path|rid>, memory docs evidence-pack <path|rid>, memory docs evidence-pack-viewer <path|rid>, memory docs backlinks <label|rid>, memory docs backlinks-viewer <label|rid>, memory docs related <path|rid>, memory docs related-viewer <path|rid>, memory docs restore [path|rid], memory docs coverage, memory docs coverage-viewer, memory docs reference-graph, memory docs reference-graph-viewer",
    );
  }
  const query = args.positional.slice(1).join(" ").trim();
  if (!query) throw new Error("nothing to search — pass a query: memory docs search <query>");
  const { store } = await openGraphStore(args);
  try {
    const report = await searchDocs(store, query, { limit: intFlag(args.flags, "limit") });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`memory docs: ${report.hits.length}/${report.total_docs} hit(s) for "${query}"`);
    for (const hit of report.hits) {
      const title = hit.title ? ` — ${hit.title}` : "";
      console.log(`  [${hit.score}] ${hit.path}${title}`);
      console.log(`      fields: ${hit.matched_fields.join(", ")}`);
      if (hit.excerpt) console.log(`      ${hit.excerpt}`);
    }
  } finally {
    await store.close();
  }
}


export async function runRegistryCliOperation(
  operation: ReadOnlyMemoryOperation,
  args: ParsedArgs,
): Promise<void> {
  const rootDir = rootOf(args.flags);
  const commandParts = operation.renderer.cli.command.split(" ");
  const positional = args.positional.slice(commandParts.length - 1);
  const transportInput = {
    positional,
    flags: flagsForRegistryTransport(args),
    query: {},
    rootDir,
  };
  const previousProvider = process.env.RED_MEMORY_VECTOR_PROVIDER;
  if (args.flags.local === true && operation.id.startsWith("memory.vector-")) {
    process.env.RED_MEMORY_VECTOR_PROVIDER = "local";
  }
  const graphContext = operationNeedsGraphStore(operation)
    ? await openGraphStore(args)
    : { store: undefined as unknown as MemoryStore, config: undefined };
  try {
    const output = await executeMemoryOperationFromTransport(
      operation,
      {
        store: graphContext.store,
        rootDir,
        memoryConfig: graphContext.config,
        providerConfig: graphContext.config?.provider,
        transportSurface: "cli",
      },
      transportInput,
    );
    if (operation.outputKind.kind === "viewer") {
      const outPath = await writeViewerArtifact(operation, output, transportInput);
      process.stdout.write(viewerCliSummary(operation, output, outPath));
      return;
    }
    if (args.flags.json === true) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    if (isRecord(output) && typeof output.markdown === "string") {
      process.stdout.write(output.markdown);
      return;
    }
    console.log(JSON.stringify(output, null, 2));
  } finally {
    if (operationNeedsGraphStore(operation)) await graphContext.store.close();
    if (args.flags.local === true && operation.id.startsWith("memory.vector-")) {
      if (previousProvider == null) delete process.env.RED_MEMORY_VECTOR_PROVIDER;
      else process.env.RED_MEMORY_VECTOR_PROVIDER = previousProvider;
    }
  }
}


export function operationNeedsGraphStore(operation: ReadOnlyMemoryOperation): boolean {
  return !new Set([
    "memory.agent-integration-status",
    "memory.agent-integration-status-viewer",
    "memory.hook-coverage",
    "memory.hook-coverage-viewer",
    "memory.routing-guide",
    "memory.routing-guide-viewer",
  ]).has(operation.id);
}


export function flagsForRegistryTransport(args: ParsedArgs): Record<string, unknown> {
  const flags: Record<string, unknown> = { ...args.flags };
  for (const [key, values] of Object.entries(repeatedFlags(process.argv.slice(2)))) {
    if (values.length > 1) flags[key] = values;
  }
  const operation = registryCliOperationFor(args.command, args.positional);
  if (
    operation &&
    ["memory.communities", "memory.communities-viewer", "memory.community-digest"].includes(
      operation.id,
    ) &&
    flags["no-cache"] !== true &&
    flags.cache === undefined
  ) {
    flags.cache = "read-write";
  }
  return flags;
}


export function repeatedFlags(argv: readonly string[]): Record<string, string[]> {
  const repeated: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--") || token === "--") continue;
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    const key = eq >= 0 ? raw.slice(0, eq) : raw;
    const inlineValue = eq >= 0 ? raw.slice(eq + 1) : undefined;
    if (key.startsWith("no-")) continue;
    const value =
      inlineValue ??
      (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--") ? argv[++i] : undefined);
    if (value === undefined) continue;
    (repeated[key] ??= []).push(value);
  }
  return repeated;
}


export function registryCliOperationFor(
  command: string | undefined,
  positional: readonly string[],
): ReadOnlyMemoryOperation | undefined {
  if (!command) return undefined;
  for (const [registeredCommand, operation] of REGISTRY_CLI_OPERATIONS) {
    const parts = registeredCommand.split(" ");
    if (parts[0] !== command) continue;
    const rest = parts.slice(1);
    if (rest.length === 0) {
      const legacySubcommands = LEGACY_SUBCOMMANDS_BY_REGISTRY_COMMAND[registeredCommand] ?? [];
      if (legacySubcommands.includes(positional[0] ?? "")) continue;
      return operation;
    }
    if (rest.every((part, index) => positional[index] === part)) return operation;
  }
  return undefined;
}
