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
import { runConflicts, runSupersede, runResolveConflict, runTimeline, runCommunities, renderCommunitiesToon, runCommunitiesViewer, runCommunityDigest, runHubReport, runSuggestedQuestions, parseHubRankBy, renderHubReportToon, renderSuggestedQuestionsToon, parseRid, printConflicts, printTimeline, printTimelineToon, runStructuralImpact, runPrePrReview, runPrePrReviewViewer, runStructuralImpactViewer, printStructuralImpact, readChangedFiles, parseChangedFiles, printPrePrReview, printPrePrSection, printReadinessEnvelope } from "./analytics.js";
import type { TimelineToonEntry } from "./analytics.js";
import { runStats, runVector, runDoctor, runExport, runGlobalSearch, resolveOverviewContract, runArchitectureOverview, readStdin, HOOK_EVENTS, runHook, VCS_EVENTS, runVcs, runVcsRefresh, resolveHooksDir, resolveBootstrapPath, runVcsInstallHooks, runVcsUninstallHooks, runAttempt, runAttemptLearn, runAttemptLearnApply, runImport, parseComplementaryMapKind, runPromoteCmd, runAfkFinalize } from "./system.js";



/**
 * Conversation extraction (the `INFERRED` write path). Reads a transcript from
 * a file or stdin, then either routes it through the configured RedDB AI
 * provider or uses the local structured-transcript fallback when no provider is
 * configured / `--local` is passed. This is an explicit write verb — the Stop
 * hook and `/memory:store` invoke it; recall/search never do.
 */
export async function runExtract(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);

  if (config.mode !== "graph") {
    throw new Error(
      `extract needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }

  const file = args.positional[0];
  const transcript = file
    ? await readFile(isAbsolute(file) ? file : resolve(rootDir, file), "utf8")
    : await readStdin();
  if (!transcript.trim()) {
    console.log("memory: empty transcript — nothing to extract");
    return;
  }

  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const providerConfig = config.provider;
    const useLocal = args.flags.local === true || !providerConfig;
    const resolved = useLocal ? null : resolveProvider(providerConfig);
    if (resolved && providerConfig) {
      applyProviderEnv(resolved, providerConfig.apiKeyEnv);
    }
    const facts = useLocal
      ? extractStructuredTranscript(transcript)
      : await extractConversation(transcript, redDbProviderClient(store, providerConfig));
    if (facts.length === 0) {
      console.log("memory: no facts extracted");
      return;
    }
    const source = useLocal ? "conversation-local-structured" : "conversation";
    const { nodes, edges } = factsToGraph(facts, source);
    const labelToRid = new Map<string, number>();
    for (const node of nodes) labelToRid.set(node.label, await store.upsertNode(node));
    let edgeCount = 0;
    for (const e of edges) {
      const from = labelToRid.get(e.fromLabel);
      const to = labelToRid.get(e.toLabel);
      if (from != null && to != null) {
        await store.upsertEdge({ from_rid: from, to_rid: to, label: e.label });
        edgeCount += 1;
      }
    }
    const via = resolved ? `${resolved.mode} (${resolved.egress})` : "local structured transcript";
    console.log(`memory: extracted ${nodes.length} INFERRED fact(s), ${edgeCount} edge(s) via ${via}`);
  } finally {
    await store.close();
  }
}


export async function runExtraction(args: ParsedArgs): Promise<void> {
  const action = args.positional[0];
  if (action === "status-viewer") return runExtractionStatusViewer(args);
  if (action !== "status") {
    throw new Error("extraction needs an action — supported: memory extraction status, memory extraction status-viewer");
  }
  const rootDir = resolve(rootOf(args.flags));
  const { store } = await openGraphStore(args);
  try {
    const status = await buildMemoryExtractionStatus(store, rootDir);
    if (args.flags.json === true) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log(
      `memory extraction: inferred=${status.inferred.available ? "available" : "unavailable"} facts=${status.inferred.facts}`,
    );
    if (status.inferred.mode) {
      console.log(
        `  provider: ${status.inferred.mode}/${status.inferred.model} (${status.inferred.egress})`,
      );
    }
    if (status.inferred.error) console.log(`  warning: ${status.inferred.error}`);
    for (const action of status.recommended_next_actions) console.log(`  next: ${action}`);
  } finally {
    await store.close();
  }
}


export async function runExtractionStatusViewer(args: ParsedArgs): Promise<void> {
  const rootDir = resolve(rootOf(args.flags));
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/extraction-status-viewer.html"),
  );
  const { store } = await openGraphStore(args);
  try {
    const status = await buildMemoryExtractionStatus(store, rootDir);
    const artifact = buildMemoryExtractionStatusViewerArtifact(status);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: extraction status viewer written ${outPath}`);
    console.log(`  inferred: ${status.inferred.available ? "available" : "unavailable"}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runMap(args: ParsedArgs): Promise<void> {
  const action = args.positional[0];
  if (action !== "freshness") {
    throw new Error("memory map supports: freshness");
  }
  const rootDir = resolve(rootOf(args.flags));
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemoryMapFreshnessReport(store, rootDir);
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    process.stdout.write(report.markdown);
  } finally {
    await store.close();
  }
}


/**
 * Read-only Code drift report (ADR 0035). It surfaces unknown engineering codes
 * by recurrence count for curation and never mutates the graph or recall path.
 */
export async function runCodeDrift(args: ParsedArgs): Promise<void> {
  const { store } = await openGraphStore(args);
  try {
    const curation = await loadEngineeringCodeCuration(store);
    const nodes = await store.listNodes();
    const report = buildCodeDriftReport(
      nodes.map((node) => node.properties.engineering_code),
      {
        recurringThreshold: intFlag(args.flags, "recurring-threshold"),
        curation,
        canonicalize: (code) => resolveEngineeringCodeAlias(code, curation),
        isSuggested: (code) => isCuratedSuggestedEngineeringCode(code, curation),
      },
    );

    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(
      `memory code-drift: ${report.distinctUnknown} unknown code(s) across ${report.unknownCount} node(s) (${report.knownCount} in suggested vocabulary)`,
    );
    if (report.distinctUnknown === 0) {
      console.log("  no unknown engineering codes; nothing to curate");
      return;
    }

    console.log(`  recurring (count >= ${report.recurringThreshold}) - promotion/alias candidates:`);
    renderCodeDriftGroups(report.groups.filter((group) => group.recurrence === "recurring"));
    console.log("  one-off - noise:");
    renderCodeDriftGroups(report.groups.filter((group) => group.recurrence === "one-off"));
  } finally {
    await store.close();
  }
}


export async function runCodeCurate(args: ParsedArgs): Promise<void> {
  const action = args.positional[0] ?? "list";
  const { store } = await openGraphStore(args);
  try {
    const before = await loadEngineeringCodeCuration(store);
    let state = before;
    let changed = false;

    switch (action) {
      case "list":
        break;
      case "promote": {
        const code = args.positional[1];
        if (!code) throw new Error("usage: memory code-curate promote <code>");
        const result = promoteEngineeringCode(before, code);
        state = result.state;
        changed = result.changed;
        if (changed) await saveEngineeringCodeCuration(store, state);
        break;
      }
      case "alias": {
        const from = args.positional[1];
        const to = args.positional[2];
        if (!from || !to) throw new Error("usage: memory code-curate alias <from> <to>");
        const result = aliasEngineeringCode(before, from, to);
        state = result.state;
        changed = result.changed;
        if (changed) await saveEngineeringCodeCuration(store, state);
        break;
      }
      default:
        throw new Error("usage: memory code-curate list|promote <code>|alias <from> <to>");
    }

    if (args.flags.json === true) {
      console.log(JSON.stringify(codeCurationOutput(state, changed), null, 2));
      return;
    }

    console.log(
      `memory code-curate: suggested vocabulary ${state.suggestedVersion} (${suggestedEngineeringCodes(state).length} code(s))${changed ? " updated" : ""}`,
    );
    if (state.promoted.length > 0) console.log(`  promoted: ${state.promoted.join(", ")}`);
    else console.log("  promoted: (none)");
    if (state.aliases.length > 0) {
      console.log("  aliases:");
      for (const alias of state.aliases) console.log(`    ${alias.from} -> ${alias.to}`);
    } else {
      console.log("  aliases: (none)");
    }
  } finally {
    await store.close();
  }
}


export function codeCurationOutput(state: EngineeringCodeCurationState, changed: boolean) {
  return {
    changed,
    schemaVersion: state.schemaVersion,
    suggestedVersion: state.suggestedVersion,
    suggested: suggestedEngineeringCodes(state),
    promoted: state.promoted,
    aliases: state.aliases,
  };
}


export function renderCodeDriftGroups(groups: CodeDriftCountGroup[]): void {
  if (groups.length === 0) {
    console.log("    (none)");
    return;
  }
  for (const group of groups) {
    console.log(`    count ${group.count}: ${group.codes.join(", ")}`);
  }
}


/** Open the graph store for a read verb, erroring clearly outside graph mode. */
export async function openGraphStore(args: ParsedArgs): Promise<{
  store: MemoryStore;
  config: MemoryConfig;
}> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `this verb needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }
  applyConfiguredProviderEnv(config.provider);
  return { store: await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) }), config };
}


export function applyConfiguredProviderEnv(provider: MemoryConfig["provider"]): void {
  if (!provider) return;
  try {
    applyProviderEnv(resolveProvider(provider), provider.apiKeyEnv);
  } catch {
    // Provider-aware commands report invalid config. Deterministic graph reads
    // should still be able to open the store and degrade locally.
  }
}


export function intFlag(flags: Record<string, string | boolean>, key: string): number | undefined {
  return typeof flags[key] === "string" ? Number(flags[key]) : undefined;
}


export function numberFlag(flags: Record<string, string | boolean>, key: string): number | undefined {
  if (typeof flags[key] !== "string") return undefined;
  const value = Number(flags[key]);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a finite number`);
  return value;
}


export function commaIntegerFlag(flags: Record<string, string | boolean>, key: string): number[] {
  const raw = stringFlag(flags, key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const value = Number(part);
      if (!Number.isInteger(value)) throw new Error(`--${key} must contain integer values`);
      return value;
    });
}


export function stringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  return typeof flags[key] === "string" ? flags[key] : undefined;
}


export function isIntegerText(value: string): boolean {
  return /^[0-9]+$/.test(value);
}


export function strFlag<T extends string>(
  flags: Record<string, string | boolean>,
  key: string,
  fallback: T,
): T {
  return typeof flags[key] === "string" ? (flags[key] as T) : fallback;
}


export async function runSearch(args: ParsedArgs): Promise<void> {
  const query = args.positional.join(" ").trim();
  if (!query) throw new Error("nothing to search — pass a query: memory search <query>");
  const { store } = await openGraphStore(args);
  try {
    const hits = await search(store, query, intFlag(args.flags, "limit") ?? 20);
    if (hits.length === 0) return void console.log(`memory: no matches for "${query}"`);
    console.log(`memory: ${hits.length} match(es) for "${query}"`);
    for (const h of hits) {
      console.log(`  [${h.score}] ${h.rid} (${h.node_type}) ${h.label}`);
      console.log(`        ${h.excerpt}`);
    }
  } finally {
    await store.close();
  }
}


export async function runMapContext(args: ParsedArgs): Promise<void> {
  const query = args.positional.join(" ").trim();
  if (!query) throw new Error("nothing to map — pass a query: memory map-context <query>");
  const { store } = await openGraphStore(args);
  try {
    const contextRaw = stringFlag(args.flags, "context");
    const slice = await buildMemoryMapContextSlice(store, query, {
      depth: intFlag(args.flags, "depth") ?? 2,
      mode: mapContextModeFlag(args.flags),
      tokenBudget: intFlag(args.flags, "budget") ?? 1800,
      contextFilters: contextRaw
        ? contextRaw.split(",").map((part) => part.trim()).filter(Boolean)
        : undefined,
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(slice, null, 2));
      return;
    }
    console.log(slice.context_md);
  } finally {
    await store.close();
  }
}


export function mapContextModeFlag(flags: Record<string, string | boolean>): "bfs" | "dfs" {
  const mode = strFlag(flags, "mode", "bfs");
  if (mode === "bfs" || mode === "dfs") return mode;
  throw new Error("map-context --mode must be bfs or dfs");
}


export async function runNeighbors(args: ParsedArgs): Promise<void> {
  const label = args.positional[0];
  if (!label) throw new Error("pass a node label: memory neighbors <label>");
  const { store } = await openGraphStore(args);
  try {
    const rows = await neighbors(
      store,
      label,
      intFlag(args.flags, "depth") ?? 1,
      strFlag(args.flags, "direction", "both"),
    );
    console.log(`memory: ${rows.length} neighbor(s) of "${label}"`);
    for (const n of rows) console.log(`  d${n.depth} ${n.rid} (${n.node_type}) ${n.label}`);
  } finally {
    await store.close();
  }
}


export async function runTraverse(args: ParsedArgs): Promise<void> {
  const label = args.positional[0];
  if (!label) throw new Error("pass a start label: memory traverse <label>");
  const { store } = await openGraphStore(args);
  try {
    const rows = await traverse(store, label, {
      depth: intFlag(args.flags, "depth") ?? 3,
      strategy: strFlag(args.flags, "strategy", "bfs"),
      direction: strFlag(args.flags, "direction", "outgoing"),
    });
    console.log(`memory: traversed ${rows.length} node(s) from "${label}"`);
    for (const n of rows) console.log(`  d${n.depth} ${n.rid} (${n.node_type}) ${n.label}`);
  } finally {
    await store.close();
  }
}


export async function runPath(args: ParsedArgs): Promise<void> {
  const [from, to] = args.positional;
  if (!from || !to) throw new Error("pass two labels: memory path <from> <to>");
  const { store } = await openGraphStore(args);
  try {
    const result = await shortestPath(store, from, to, strFlag(args.flags, "algorithm", "bfs"));
    if (!result || !result.reachable) {
      console.log(`memory: no path from "${from}" to "${to}"`);
      return;
    }
    console.log(
      `memory: path "${from}" → "${to}": ${result.hopCount} hop(s), weight ${result.totalWeight}`,
    );
  } finally {
    await store.close();
  }
}


export async function runPathExplain(args: ParsedArgs): Promise<void> {
  const [from, to] = args.positional;
  if (!from || !to) throw new Error("pass two labels: memory path-explain <from> <to>");
  const { store } = await openGraphStore(args);
  try {
    const report = await buildPathExplainReport(store, {
      from,
      to,
      maxDepth: intFlag(args.flags, "max-depth"),
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


export async function runPathExplainViewer(args: ParsedArgs): Promise<void> {
  const [from, to] = args.positional;
  if (!from || !to) throw new Error("pass two labels: memory path-explain-viewer <from> <to>");
  const rootDir = rootOf(args.flags);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/path-explain-viewer.html"),
  );
  const { store } = await openGraphStore(args);
  try {
    const report = await buildPathExplainReport(store, {
      from,
      to,
      maxDepth: intFlag(args.flags, "max-depth"),
    });
    const artifact = buildPathExplainViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: path explanation viewer written ${outPath}`);
    console.log(`  from: ${from}`);
    console.log(`  to: ${to}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runConfidence(args: ParsedArgs): Promise<void> {
  const nodeArg = stringFlag(args.flags, "node") ?? args.positional[0];
  if (!nodeArg) {
    throw new Error("pass a node rid: memory confidence --node <rid>");
  }
  const { store } = await openGraphStore(args);
  try {
    const report = await buildConfidenceReport(store, nodeArg);
    if (!report) {
      throw new Error(`memory: no node with rid=${nodeArg}`);
    }
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(renderConfidenceMarkdown(report));
  } finally {
    await store.close();
  }
}
