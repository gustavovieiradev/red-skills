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
import { runStatus, runHealth, runRecallTelemetry, runHealthViewer, runGovernance, runGovernanceViewer, printGovernance, runLint, runPrivacy, printPrivacyReport, printLintReport, healthReport, healthState, healthRecommendations, runContextStatus, contextStatusReport, contextRecommendations, exists, countMarkdownFiles, storeExists, graphFreshnessStatus, scanProjectFreshness, newestMtimeMs, shouldSkipFreshnessPath, entryLooksLikeCache, toPosix, enabledHookNames, yesNo, reportStatusState, formatOutcomes, skillEventFromFlags, plural } from "./health.js";
import type { CheckName, ContextCheck } from "./health.js";
import { runExtract, runExtraction, runExtractionStatusViewer, runMap, runCodeDrift, runCodeCurate, codeCurationOutput, renderCodeDriftGroups, openGraphStore, applyConfiguredProviderEnv, intFlag, numberFlag, commaIntegerFlag, stringFlag, isIntegerText, strFlag, runSearch, runMapContext, mapContextModeFlag, runNeighbors, runTraverse, runPath, runPathExplain, runPathExplainViewer, runConfidence } from "./graph-navigation.js";
import { runConflicts, runSupersede, runResolveConflict, runTimeline, runCommunities, renderCommunitiesToon, runCommunitiesViewer, runCommunityDigest, runHubReport, runSuggestedQuestions, parseHubRankBy, renderHubReportToon, renderSuggestedQuestionsToon, parseRid, printConflicts, printTimeline, printTimelineToon, runStructuralImpact, runPrePrReview, runPrePrReviewViewer, runStructuralImpactViewer, printStructuralImpact, readChangedFiles, parseChangedFiles, printPrePrReview, printPrePrSection, printReadinessEnvelope } from "./analytics.js";
import type { TimelineToonEntry } from "./analytics.js";
import { runStats, runVector, runDoctor, runExport, runGlobalSearch, resolveOverviewContract, runArchitectureOverview, readStdin, HOOK_EVENTS, runHook, VCS_EVENTS, runVcs, runVcsRefresh, resolveHooksDir, resolveBootstrapPath, runVcsInstallHooks, runVcsUninstallHooks, runAttempt, runAttemptLearn, runAttemptLearnApply, runImport, parseComplementaryMapKind, runPromoteCmd, runAfkFinalize } from "./system.js";



export type SkillTelemetryEvidenceCardStatus =
  | "captured"
  | "routed"
  | "proposed"
  | "approved"
  | "rejected"
  | "promoted"
  | "archived";


export interface ExistingSkillTelemetryEvidenceCardRef {
  file: string;
  id: string;
  fingerprint: string;
  status: SkillTelemetryEvidenceCardStatus;
  createdAt: string | null;
  proposalPath: string | null;
  revision: number;
  review: SkillTelemetryEvidenceCard["review"];
}


export async function countSkillTelemetryEvidenceCardsForSignal(
  evidenceCardDir: string,
  signalFingerprint: string,
): Promise<number> {
  return (await listSkillTelemetryEvidenceCardsForSignal(evidenceCardDir, signalFingerprint)).length;
}


export async function findReusableSkillTelemetryEvidenceCard(
  rootDir: string,
  evidenceCardDir: string,
  signalFingerprint: string,
): Promise<ExistingSkillTelemetryEvidenceCardRef | null> {
  const cards = await listSkillTelemetryEvidenceCardsForSignal(evidenceCardDir, signalFingerprint);
  for (const card of cards) {
    if (!isUnresolvedSkillTelemetryEvidenceCardStatus(card.status)) continue;
    if (skillTelemetryReviewHasHumanDecision(card.review)) continue;
    if (card.proposalPath && !existsSync(resolve(rootDir, card.proposalPath))) continue;
    return card;
  }
  return null;
}


export async function listSkillTelemetryEvidenceCardsForSignal(
  evidenceCardDir: string,
  signalFingerprint: string,
): Promise<ExistingSkillTelemetryEvidenceCardRef[]> {
  let entries;
  try {
    entries = await readdir(evidenceCardDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const signalLine = `signal_fingerprint: ${yamlScalar(signalFingerprint)}`;
  const cards: ExistingSkillTelemetryEvidenceCardRef[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    const body = await readFile(join(evidenceCardDir, entry.name), "utf8");
    if (!body.includes('kind: "skill_telemetry"') || !body.includes(signalLine)) continue;
    const status = parseSkillTelemetryEvidenceCardStatus(firstTopLevelYamlScalarField(body, "status"));
    cards.push({
      file: entry.name,
      id: firstTopLevelYamlScalarField(body, "id") ?? "",
      fingerprint: firstTopLevelYamlScalarField(body, "fingerprint") ?? "",
      status,
      createdAt: firstTopLevelYamlScalarField(body, "created_at"),
      proposalPath: lastYamlScalarField(body, "path"),
      revision: Number(lastYamlScalarField(body, "revision") ?? "0") || 0,
      review: {
        reviewer: lastYamlScalarField(body, "reviewer"),
        reviewed_at: lastYamlScalarField(body, "reviewed_at"),
        decision: lastYamlScalarField(body, "decision"),
        notes: lastYamlScalarField(body, "notes"),
      },
    });
  }
  return cards.sort((a, b) => b.revision - a.revision || a.file.localeCompare(b.file));
}


export function firstTopLevelYamlScalarField(body: string, key: string): string | null {
  const match = body.match(new RegExp(`^${escapeRegExp(key)}:\\s*([^\\n]*)$`, "m"));
  if (!match) return null;
  return parseYamlScalar(match[1]);
}


export function lastYamlScalarField(body: string, key: string): string | null {
  const matches = [...body.matchAll(new RegExp(`^\\s*${escapeRegExp(key)}:\\s*([^\\n]*)$`, "gm"))];
  const match = matches.at(-1);
  if (!match) return null;
  return parseYamlScalar(match[1]);
}


export function parseYamlScalar(value: string): string | null {
  const raw = value.trim();
  if (raw === "" || raw === "null") return null;
  try {
    return String(JSON.parse(raw));
  } catch {
    return raw;
  }
}


export function parseSkillTelemetryEvidenceCardStatus(value: string | null): SkillTelemetryEvidenceCardStatus {
  if (
    value === "captured" ||
    value === "routed" ||
    value === "proposed" ||
    value === "approved" ||
    value === "rejected" ||
    value === "promoted" ||
    value === "archived"
  ) {
    return value;
  }
  return "proposed";
}


export function isUnresolvedSkillTelemetryEvidenceCardStatus(status: SkillTelemetryEvidenceCardStatus): boolean {
  return status === "captured" || status === "routed" || status === "proposed";
}


export function skillTelemetryReviewHasHumanDecision(review: SkillTelemetryEvidenceCard["review"]): boolean {
  return Boolean(review.reviewed_at || review.decision);
}


export function proposalFingerprint(input: {
  skill: string;
  category: string;
  skillPath: string;
  dominantErrorStage: string | null;
  dominantErrorClass: string | null;
}): string {
  const payload = JSON.stringify({
    skill: input.skill,
    category: input.category,
    skillPath: input.skillPath,
    dominantErrorStage: input.dominantErrorStage ?? "",
    dominantErrorClass: input.dominantErrorClass ?? "",
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}


export function skillTelemetryEvidenceSource(skillName: string, evidence: readonly SkillEventSummary[]): string {
  const sourceKinds = topValues(evidence.map((event) => event.source_kind));
  return `skill-telemetry:${skillName}:${sourceKinds.length > 0 ? sourceKinds.join("+") : "unknown-source"}`;
}


export function skillTelemetryEvidenceRoute(category: string, skillPath: string): string {
  return `skill-improvement:${category}:${skillPath}`;
}


export function skillTelemetryDominantErrorPattern(input: {
  dominantErrorStage: string | null;
  dominantErrorClass: string | null;
  dominantErrorCode: string | null;
}): string {
  return [
    `stage=${input.dominantErrorStage ?? ""}`,
    `class=${input.dominantErrorClass ?? ""}`,
    `code=${input.dominantErrorCode ?? ""}`,
  ].join("|");
}


export function skillTelemetryWindow(evidence: readonly SkillEventSummary[]): string {
  const timestamps = evidence.map((event) => event.timestamp).filter(Boolean).sort();
  if (timestamps.length === 0) return "none";
  return `${timestamps[0]}..${timestamps[timestamps.length - 1]} count=${timestamps.length}`;
}


export function skillTelemetrySignalFingerprint(input: {
  evidenceSource: string;
  evidenceRoute: string;
  dominantErrorPattern: string;
  telemetryWindow: string;
}): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        evidenceSource: input.evidenceSource,
        evidenceRoute: input.evidenceRoute,
        dominantErrorPattern: input.dominantErrorPattern,
        telemetryWindow: input.telemetryWindow,
      }),
    )
    .digest("hex")}`;
}


export interface SkillTelemetryEvidenceCard {
  contract: "memory.evidence-card.experimental.v1";
  id: string;
  kind: "skill_telemetry";
  status: SkillTelemetryEvidenceCardStatus;
  created_at: string;
  updated_at: string;
  signal_fingerprint: string;
  fingerprint: string;
  file: string;
  refresh: {
    evidence_source: string;
    evidence_route: string;
    dominant_error_pattern: string;
    telemetry_window: string;
    revision: number;
  };
  source: {
    kind: "skill_telemetry";
    source_kind: string;
    runner: string;
    skill: {
      name: string;
      path: string;
    };
    rollup_ref: string;
    recent_event_refs: string[];
  };
  signal: {
    category: string;
    reason: string;
    recent_failures: number;
    dominant_error_stage: string | null;
    dominant_error_class: string | null;
  };
  route: {
    kind: "skill_proposal";
    target_skill_name: string;
    target_skill_path: string;
    suggested_section_or_anchor: string;
    route_decision: "write_approval_gated_proposal";
    route_reason: string;
  };
  blast_radius: {
    axes: {
      external_audience: boolean;
      customer_commercial_security: boolean;
      shared_workflow_context: boolean;
    };
    derived_level: "medium";
    reason: string;
  };
  judge: {
    checklist: {
      source_refs_not_raw_dump: boolean;
      enough_recent_failures: boolean;
      privacy_posture_recorded: boolean;
      blast_radius_recorded: boolean;
      route_quality_recorded: boolean;
    };
    verdict: "proposal_ready";
    confidence: "high" | "medium";
    reason: string;
  };
  privacy: {
    redaction: "not_required";
    findings: string[];
  };
  review: {
    reviewer: string | null;
    reviewed_at: string | null;
    decision: string | null;
    notes: string | null;
  };
  proposal: {
    path: string;
    fingerprint: string;
  };
}


export function buildSkillTelemetryEvidenceCard(input: {
  rootDir: string;
  rec: { name: string; source_kind: string; category: string; reason: string; path: string };
  rollup?: SkillRollup;
  evidence: readonly SkillEventSummary[];
  dominantErrorStage: string | null;
  dominantErrorClass: string | null;
  proposalFingerprint: string;
  signalFingerprint: string;
  evidenceSource: string;
  evidenceRoute: string;
  dominantErrorPattern: string;
  telemetryWindow: string;
  cardRevision: number;
  reusableCard: ExistingSkillTelemetryEvidenceCardRef | null;
  priority: { score: number; priority: "high" | "medium" | "low"; reasons: string[] };
}): SkillTelemetryEvidenceCard {
  const relSkillPath = isAbsolute(input.rec.path)
    ? toPosix(relative(input.rootDir, input.rec.path))
    : input.rec.path;
  const runner = topValues(input.evidence.map((event) => event.runner))[0] ?? "unknown";
  const recentEventRefs = input.evidence.map((event) => `skill-event:${event.event_id}`);
  const fingerprint =
    input.reusableCard?.fingerprint ||
    `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        contract: "memory.evidence-card.experimental.v1",
        signalFingerprint: input.signalFingerprint,
        cardRevision: input.cardRevision,
      }),
    )
    .digest("hex")}`;
  const short = fingerprint.slice("sha256:".length, "sha256:".length + 12);
  const id = input.reusableCard?.id || `skill-telemetry:${slugify(input.rec.name)}:${short}`;
  const now = new Date().toISOString();
  const rollupRef =
    input.rollup != null
      ? `skill-rollup:${contentHash(input.rollup.source_kind, input.rollup.name, input.rollup.path)}`
      : `skill-rollup:${contentHash(input.rec.source_kind, input.rec.name, input.rec.path)}`;

  const card: SkillTelemetryEvidenceCard = {
    contract: "memory.evidence-card.experimental.v1",
    id,
    kind: "skill_telemetry",
    status: "proposed",
    created_at: input.reusableCard?.createdAt || now,
    updated_at: now,
    signal_fingerprint: input.signalFingerprint,
    fingerprint,
    file: input.reusableCard?.file || `skill-telemetry-${slugify(input.rec.name)}-${short}.yaml`,
    refresh: {
      evidence_source: input.evidenceSource,
      evidence_route: input.evidenceRoute,
      dominant_error_pattern: input.dominantErrorPattern,
      telemetry_window: input.telemetryWindow,
      revision: input.cardRevision,
    },
    source: {
      kind: "skill_telemetry",
      source_kind: input.rec.source_kind,
      runner,
      skill: {
        name: input.rec.name,
        path: relSkillPath,
      },
      rollup_ref: rollupRef,
      recent_event_refs: recentEventRefs,
    },
    signal: {
      category: input.rec.category,
      reason: input.rec.reason,
      recent_failures: input.evidence.length,
      dominant_error_stage: input.dominantErrorStage,
      dominant_error_class: input.dominantErrorClass,
    },
    route: {
      kind: "skill_proposal",
      target_skill_name: input.rec.name,
      target_skill_path: relSkillPath,
      suggested_section_or_anchor: suggestedSectionOrAnchor(input.dominantErrorStage, input.dominantErrorClass),
      route_decision: "write_approval_gated_proposal",
      route_reason: `Repeated failing Skill telemetry should become a reviewed Skill improvement proposal for ${input.rec.name}.`,
    },
    blast_radius: {
      axes: {
        external_audience: false,
        customer_commercial_security: false,
        shared_workflow_context: true,
      },
      derived_level: "medium",
      reason:
        "The card routes to a Skill behavior proposal. It does not affect external users or customer/commercial/security behavior directly, but it can change shared agent workflow guidance after review.",
    },
    judge: {
      checklist: {
        source_refs_not_raw_dump: recentEventRefs.length > 0 && rollupRef.length > 0,
        enough_recent_failures: input.evidence.length >= 2,
        privacy_posture_recorded: true,
        blast_radius_recorded: true,
        route_quality_recorded: true,
      },
      verdict: "proposal_ready",
      confidence: input.priority.priority === "high" ? "high" : "medium",
      reason: `Telemetry supports a ${input.priority.priority}-priority approval-gated proposal: ${input.priority.reasons.join("; ")}.`,
    },
    privacy: {
      redaction: "not_required",
      findings: [],
    },
    review: input.reusableCard?.review || {
      reviewer: null,
      reviewed_at: null,
      decision: null,
      notes: null,
    },
    proposal: {
      path: "",
      fingerprint: input.proposalFingerprint,
    },
  };
  return redactSensitiveValue(card) as SkillTelemetryEvidenceCard;
}


export function suggestedSectionOrAnchor(
  dominantErrorStage: string | null,
  dominantErrorClass: string | null,
): string {
  if (dominantErrorStage) return `stage:${dominantErrorStage}`;
  if (dominantErrorClass) return `error_class:${dominantErrorClass}`;
  return "safe-tail-anchor";
}


export function renderEvidenceCardYaml(card: SkillTelemetryEvidenceCard): string {
  return `${yamlValue(card)}\n`;
}


export function yamlValue(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (isPlainObject(item) || Array.isArray(item)) {
          const rendered = yamlValue(item, indent + 2);
          return `${pad}-\n${rendered}`;
        }
        return `${pad}- ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
      .map(([key, item]) => {
        if (isPlainObject(item) || Array.isArray(item)) {
          const rendered = yamlValue(item, indent + 2);
          return `${pad}${key}:\n${rendered}`;
        }
        return `${pad}${key}: ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  return `${pad}${yamlScalar(value)}`;
}


export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}


export function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}


export async function renderSkillImprovementProposal(
  rootDir: string,
  rec: { name: string; category: string; reason: string; path: string },
  evidence: SkillEventSummary[],
  fingerprint: string,
  evidenceCard: SkillTelemetryEvidenceCard | null,
): Promise<string> {
  const relSkillPath = isAbsolute(rec.path) ? toPosix(relative(rootDir, rec.path)) : rec.path;
  const evidenceBlock = evidenceCard ? "" : renderRecentFailureEvidence(evidence);
  const patchBlock = await renderDraftSkillPatchBlock(rootDir, rec, relSkillPath, evidence);
  const evidenceCardBlock = evidenceCard
    ? `\n## Evidence Card\n\n- Evidence card id: ${evidenceCard.id}\n- Evidence card path: ${toPosix(join(".red", "memory", "inbox", "evidence", evidenceCard.file))}\n`
    : "";
  return `# Skill Improvement Proposal: ${rec.name}

Status: approval-gated
Generated: ${new Date().toISOString()}
Fingerprint: ${fingerprint}

## Evidence

- Skill: ${rec.name}
- Category: ${rec.category}
- Reason: ${rec.reason}
- Skill path: ${relSkillPath}
${evidenceCardBlock}

## Hypothesis

Telemetry indicates this skill is repeatedly failing. The most likely root cause is missing prerequisite checks, ambiguous execution steps, incomplete verification guidance, or outdated tool instructions.
${evidenceBlock}
## Proposed Patch

Do not apply blindly. Review ${relSkillPath} and patch the smallest section that addresses the observed failure pattern.

Suggested patch targets:

1. Add or tighten prerequisite checks before the failure stage.
2. Add a troubleshooting note for the observed failure mode.
3. Add an explicit verification command or expected output.
4. Add a pitfall warning if the failure is caused by a common misuse.
${patchBlock}
## Validation Plan

1. Re-run the task or fixture that produced the failure.
2. Run any repo-specific metadata and skill validators.
3. Record a new Skill result event after validation.
4. Keep this proposal with the review notes, or delete it if rejected.

## Apply Policy

This proposal is intentionally approval-gated. The Memory plugin wrote this proposal file only; it did not patch, archive, delete, or rewrite the Skill.
`;
}



export function recentFailureEvidence(skillName: string, events: readonly SkillEventSummary[]): SkillEventSummary[] {
  return events
    .filter((event) => event.name === skillName && event.event_type === "result" && event.status === "failed")
    .slice(0, 5);
}


export function renderRecentFailureEvidence(evidence: readonly SkillEventSummary[]): string {
  if (evidence.length === 0) return "";
  const lines = evidence.map((event) => {
    const details = [
      event.error_stage ? `error_stage=${event.error_stage}` : null,
      event.error_class ? `error_class=${event.error_class}` : null,
      event.error_code ? `error_code=${event.error_code}` : null,
    ].filter(Boolean);
    return `- ${event.timestamp} runner=${event.runner}${details.length > 0 ? ` ${details.join(" ")}` : ""}`;
  });
  return `\n## Recent Failure Evidence\n\n${lines.join("\n")}\n`;
}


export function semanticTroubleshootingNote(reason: string, evidence: readonly SkillEventSummary[]): string {
  const stages = topValues(evidence.map((event) => event.error_stage));
  const classes = topValues(evidence.map((event) => event.error_class));
  const stage = stages[0];
  const klass = classes[0];
  const guidance = stage
    ? `Add verification guidance for the \`${stage}\` stage, including the expected signal and the recovery step when it fails.`
    : "Add the smallest concrete prerequisite, pitfall, or verification guidance that prevents the repeated failure.";
  const klassLine = klass ? `\n- Dominant error class: ${klass}.` : "";
  return `\n\n## Telemetry troubleshooting note\n\n- Failure signal: ${reason}.${klassLine}\n- ${guidance}\n`;
}


export function topValues(values: readonly (string | undefined)[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value]) => value);
}


export async function renderDraftSkillPatchBlock(
  rootDir: string,
  rec: { name: string; category: string; reason: string; path: string },
  relSkillPath: string,
  evidence: readonly SkillEventSummary[],
): Promise<string> {
  const targetPath = isAbsolute(rec.path) ? rec.path : resolve(rootDir, rec.path);
  try {
    assertInsideRoot(rootDir, targetPath, "patch target");
    const current = await readFile(targetPath, "utf8");
    const oldString = semanticSectionAnchor(current, evidence) ?? uniqueTailAnchor(current);
    if (!oldString) {
      return "\nNo structured patch block was generated because the skill file did not have a safe unique insertion anchor. Add a `json memory-skill-patch` block manually after review.\n";
    }
    const note = semanticTroubleshootingNote(rec.reason, evidence);
    const patch = {
      path: relSkillPath,
      oldString,
      newString: `${oldString}${note}`,
    };
    return `\nDraft structured patch block. Edit before applying if the generic note is not precise enough:\n\n\`\`\`json memory-skill-patch\n${JSON.stringify(patch, null, 2)}\n\`\`\`\n`;
  } catch (err) {
    return `\nNo structured patch block was generated because the skill file could not be read safely: ${err instanceof Error ? err.message : String(err)}. Add a \`json memory-skill-patch\` block manually after review.\n`;
  }
}



export function semanticSectionAnchor(text: string, evidence: readonly SkillEventSummary[]): string | null {
  const stage = topValues(evidence.map((event) => event.error_stage))[0];
  const klass = topValues(evidence.map((event) => event.error_class))[0];
  const headings = semanticHeadingCandidates(stage, klass);
  for (const heading of headings) {
    const section = markdownSectionByHeading(text, heading);
    if (section && countOccurrences(text, section) === 1) return section;
  }
  return null;
}


export function semanticHeadingCandidates(stage: string | undefined, klass: string | undefined): RegExp[] {
  const candidates: RegExp[] = [];
  const s = (stage ?? "").toLowerCase();
  const k = (klass ?? "").toLowerCase();
  if (s.includes("setup") || s.includes("prereq") || s.includes("init") || s.includes("install")) {
    candidates.push(/^(prerequisites?|setup|installation|initialization)$/i);
  }
  if (s.includes("verify") || s.includes("validat") || s.includes("test") || s.includes("check")) {
    candidates.push(/^(verification|validation|testing|tests?|quality gates?)$/i);
  }
  if (s.includes("execute") || s.includes("run") || s.includes("tool") || s.includes("command")) {
    candidates.push(/^(what-to-do|execution|usage|commands?|workflow|steps?)$/i);
  }
  if (s.includes("cleanup") || s.includes("rollback") || s.includes("recover")) {
    candidates.push(/^(cleanup|rollback|recovery|recovering)$/i);
  }
  if (k.includes("timeout") || k.includes("rate") || k.includes("lock") || k.includes("permission")) {
    candidates.push(/^(common pitfalls|pitfalls|troubleshooting|known issues|failure modes?)$/i);
  }
  candidates.push(/^(common pitfalls|pitfalls|troubleshooting)$/i);
  return candidates;
}


export function markdownSectionByHeading(text: string, headingPattern: RegExp): string | null {
  const lineMatches = [...text.matchAll(/^#{2,6}\s+(.+?)\s*$/gm)];
  for (let i = 0; i < lineMatches.length; i++) {
    const match = lineMatches[i];
    const title = match[1]?.trim();
    if (!title || !headingPattern.test(title)) continue;
    const start = match.index ?? 0;
    const next = lineMatches[i + 1];
    const end = next?.index ?? text.replace(/\s+$/u, "").length;
    const section = text.slice(start, end).replace(/\s+$/u, "");
    return section.length > 0 ? section : null;
  }
  return null;
}


export function uniqueTailAnchor(text: string): string | null {
  const trimmed = text.replace(/\s+$/u, "");
  if (trimmed.length === 0) return null;
  const maxAnchorChars = 1200;
  const lines = trimmed.split("\n");
  for (let lineCount = 1; lineCount <= Math.min(lines.length, 40); lineCount++) {
    const candidate = lines.slice(-lineCount).join("\n");
    if (candidate.length > maxAnchorChars) break;
    if (countOccurrences(text, candidate) === 1) return candidate;
  }
  const tail = trimmed.slice(-maxAnchorChars);
  return countOccurrences(text, tail) === 1 ? tail : null;
}


export function reportImproveState(
  json: boolean,
  state: "uninitialized" | "no-op" | "unavailable",
  reason: string,
  proposals: SkillImprovementProposalSummary[],
): void {
  if (json) {
    console.log(JSON.stringify({ state, reason, proposals, evidenceCards: [] }, null, 2));
    return;
  }
  console.log(`memory: skill improvement — ${state}`);
  console.log(`  ${reason}`);
}
