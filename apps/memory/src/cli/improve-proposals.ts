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
import { countSkillTelemetryEvidenceCardsForSignal, findReusableSkillTelemetryEvidenceCard, listSkillTelemetryEvidenceCardsForSignal, firstTopLevelYamlScalarField, lastYamlScalarField, parseYamlScalar, parseSkillTelemetryEvidenceCardStatus, isUnresolvedSkillTelemetryEvidenceCardStatus, skillTelemetryReviewHasHumanDecision, proposalFingerprint, skillTelemetryEvidenceSource, skillTelemetryEvidenceRoute, skillTelemetryDominantErrorPattern, skillTelemetryWindow, skillTelemetrySignalFingerprint, buildSkillTelemetryEvidenceCard, suggestedSectionOrAnchor, renderEvidenceCardYaml, yamlValue, isPlainObject, yamlScalar, renderSkillImprovementProposal, recentFailureEvidence, renderRecentFailureEvidence, semanticTroubleshootingNote, topValues, renderDraftSkillPatchBlock, semanticSectionAnchor, semanticHeadingCandidates, markdownSectionByHeading, uniqueTailAnchor, reportImproveState } from "./improve-telemetry.js";
import type { SkillTelemetryEvidenceCardStatus, ExistingSkillTelemetryEvidenceCardRef, SkillTelemetryEvidenceCard } from "./improve-telemetry.js";
import { runStatus, runHealth, runRecallTelemetry, runHealthViewer, runGovernance, runGovernanceViewer, printGovernance, runLint, runPrivacy, printPrivacyReport, printLintReport, healthReport, healthState, healthRecommendations, runContextStatus, contextStatusReport, contextRecommendations, exists, countMarkdownFiles, storeExists, graphFreshnessStatus, scanProjectFreshness, newestMtimeMs, shouldSkipFreshnessPath, entryLooksLikeCache, toPosix, enabledHookNames, yesNo, reportStatusState, formatOutcomes, skillEventFromFlags, plural } from "./health.js";
import type { CheckName, ContextCheck } from "./health.js";
import { runExtract, runExtraction, runExtractionStatusViewer, runMap, runCodeDrift, runCodeCurate, codeCurationOutput, renderCodeDriftGroups, openGraphStore, applyConfiguredProviderEnv, intFlag, numberFlag, commaIntegerFlag, stringFlag, isIntegerText, strFlag, runSearch, runMapContext, mapContextModeFlag, runNeighbors, runTraverse, runPath, runPathExplain, runPathExplainViewer, runConfidence } from "./graph-navigation.js";
import { runConflicts, runSupersede, runResolveConflict, runTimeline, runCommunities, renderCommunitiesToon, runCommunitiesViewer, runCommunityDigest, runHubReport, runSuggestedQuestions, parseHubRankBy, renderHubReportToon, renderSuggestedQuestionsToon, parseRid, printConflicts, printTimeline, printTimelineToon, runStructuralImpact, runPrePrReview, runPrePrReviewViewer, runStructuralImpactViewer, printStructuralImpact, readChangedFiles, parseChangedFiles, printPrePrReview, printPrePrSection, printReadinessEnvelope } from "./analytics.js";
import type { TimelineToonEntry } from "./analytics.js";
import { runStats, runVector, runDoctor, runExport, runGlobalSearch, resolveOverviewContract, runArchitectureOverview, readStdin, HOOK_EVENTS, runHook, VCS_EVENTS, runVcs, runVcsRefresh, resolveHooksDir, resolveBootstrapPath, runVcsInstallHooks, runVcsUninstallHooks, runAttempt, runAttemptLearn, runAttemptLearnApply, runImport, parseComplementaryMapKind, runPromoteCmd, runAfkFinalize } from "./system.js";





export interface ProposalFileSummary {
  file: string;
  path: string;
  status: "pending" | "archived";
  skill: string | null;
  category: string | null;
  reason: string | null;
  skillPath: string | null;
  generated: string | null;
  fingerprint: string | null;
  bytes: number;
  mtimeMs: number;
}


export async function runImproveProposals(args: ParsedArgs): Promise<void> {
  const action = args.positional[1] ?? "list";
  switch (action) {
    case "list":
      return runImproveProposalsList(args);
    case "show":
      return runImproveProposalsShow(args);
    case "archive":
      return runImproveProposalsArchive(args);
    default:
      throw new Error("memory improve proposals supports: list|show|archive");
  }
}


export async function runImproveProposalsList(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const json = args.flags.json === true;
  const proposals = await listPendingProposalFiles(rootDir);
  const result = {
    state: proposals.length > 0 ? "pending" : "empty",
    proposals,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`memory: ${proposals.length} pending proposal ${plural(proposals.length, "file")}`);
  for (const proposal of proposals) {
    console.log(`  ${proposal.file}${proposal.skill ? ` — ${proposal.skill}` : ""}`);
  }
}


export async function runImproveProposalsShow(args: ParsedArgs): Promise<void> {
  const proposalArg = args.positional[2];
  if (!proposalArg) throw new Error("memory improve proposals show needs a proposal file");
  const rootDir = rootOf(args.flags);
  const json = args.flags.json === true;
  const proposalPath = resolve(rootDir, proposalArg);
  assertInsideRoot(rootDir, proposalPath, "proposal file");
  assertInsideProposalTree(rootDir, proposalPath);
  const body = await readFile(proposalPath, "utf8");
  const proposal = await summarizeProposalFile(rootDir, proposalPath, body);
  if (json) {
    console.log(JSON.stringify({ state: "shown", proposal, body }, null, 2));
    return;
  }
  console.log(body);
}


export async function runImproveProposalsArchive(args: ParsedArgs): Promise<void> {
  const proposalArg = args.positional[2];
  if (!proposalArg) throw new Error("memory improve proposals archive needs a proposal file");
  if (args.flags.yes !== true) {
    throw new Error("memory improve proposals archive requires explicit --yes approval");
  }
  const reason = typeof args.flags.reason === "string" ? args.flags.reason : "";
  if (!isArchiveReason(reason)) {
    throw new Error("memory improve proposals archive requires --reason applied|rejected|stale");
  }
  const rootDir = rootOf(args.flags);
  const json = args.flags.json === true;
  const proposalPath = resolve(rootDir, proposalArg);
  assertInsideRoot(rootDir, proposalPath, "proposal file");
  assertInsideProposalTree(rootDir, proposalPath);
  const archiveDir = join(proposalRoot(rootDir), "archive", reason);
  await mkdir(archiveDir, { recursive: true });
  const destination = join(archiveDir, proposalPath.split(sep).pop() ?? "proposal.md");
  assertInsideRoot(rootDir, destination, "archive target");
  await rename(proposalPath, destination);
  const result = {
    state: "archived",
    reason,
    proposal: toPosix(relative(rootDir, proposalPath)),
    archivePath: toPosix(relative(rootDir, destination)),
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`memory: archived proposal ${result.proposal}`);
  console.log(`  reason: ${reason}`);
  console.log(`  archive: ${result.archivePath}`);
}


export async function listPendingProposalFiles(rootDir: string): Promise<ProposalFileSummary[]> {
  const dir = proposalRoot(rootDir);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const summaries: ProposalFileSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(dir, entry.name);
    const body = await readFile(filePath, "utf8");
    summaries.push(await summarizeProposalFile(rootDir, filePath, body));
  }
  return summaries.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file));
}


export async function summarizeProposalFile(rootDir: string, proposalPath: string, body: string): Promise<ProposalFileSummary> {
  const info = await stat(proposalPath);
  return {
    file: proposalPath.split(sep).pop() ?? toPosix(relative(rootDir, proposalPath)),
    path: toPosix(relative(rootDir, proposalPath)),
    status: toPosix(relative(proposalRoot(rootDir), proposalPath)).startsWith("archive/") ? "archived" : "pending",
    skill: firstProposalField(body, /^# Skill Improvement Proposal:\s*(.+)$/m) ?? firstProposalField(body, /^- Skill:\s*(.+)$/m),
    category: firstProposalField(body, /^- Category:\s*(.+)$/m),
    reason: firstProposalField(body, /^- Reason:\s*(.+)$/m),
    skillPath: firstProposalField(body, /^- Skill path:\s*(.+)$/m),
    generated: firstProposalField(body, /^Generated:\s*(.+)$/m),
    fingerprint: firstProposalField(body, /^Fingerprint:\s*(.+)$/m),
    bytes: info.size,
    mtimeMs: info.mtimeMs,
  };
}


export function firstProposalField(body: string, pattern: RegExp): string | null {
  const match = body.match(pattern);
  return match ? match[1].trim() : null;
}


export function proposalRoot(rootDir: string): string {
  return join(rootDir, ".red", "memory", "proposals");
}


export function assertInsideProposalTree(rootDir: string, filePath: string): void {
  const rel = relative(proposalRoot(rootDir), filePath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("proposal file must stay inside .red/memory/proposals");
  }
}


export function isArchiveReason(reason: string): reason is "applied" | "rejected" | "stale" {
  return reason === "applied" || reason === "rejected" || reason === "stale";
}


export interface SkillPatchBlock {
  path: string;
  oldString: string;
  newString: string;
}


export async function runImproveApply(args: ParsedArgs): Promise<void> {
  const proposalArg = args.positional[1];
  if (!proposalArg) throw new Error("memory improve apply needs a proposal file");
  if (args.flags.yes !== true) {
    throw new Error("memory improve apply requires explicit --yes approval");
  }

  const rootDir = rootOf(args.flags);
  const json = args.flags.json === true;
  const proposalPath = resolve(rootDir, proposalArg);
  assertInsideRoot(rootDir, proposalPath, "proposal file");
  const proposal = await readFile(proposalPath, "utf8");
  const patchBlock = parseSkillPatchBlock(proposal);
  const targetPath = resolve(rootDir, patchBlock.path);
  assertInsideRoot(rootDir, targetPath, "patch target");

  const current = await readFile(targetPath, "utf8");
  const occurrences = countOccurrences(current, patchBlock.oldString);
  if (occurrences !== 1) {
    throw new Error(`patch target must contain oldString exactly once, found ${occurrences}`);
  }
  await writeFile(targetPath, current.replace(patchBlock.oldString, patchBlock.newString), "utf8");

  const result = {
    state: "applied",
    proposal: toPosix(relative(rootDir, proposalPath)),
    target: toPosix(relative(rootDir, targetPath)),
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`memory: applied proposal ${result.proposal}`);
  console.log(`  target: ${result.target}`);
}


export function parseSkillPatchBlock(proposal: string): SkillPatchBlock {
  const match = proposal.match(/```json memory-skill-patch\s*([\s\S]*?)```/);
  if (!match) throw new Error("proposal needs a structured memory-skill-patch block");
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch (err) {
    throw new Error(`invalid memory-skill-patch JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("memory-skill-patch must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const path = obj.path;
  const oldString = obj.oldString;
  const newString = obj.newString;
  if (typeof path !== "string" || path.trim() === "") throw new Error("memory-skill-patch.path is required");
  if (typeof oldString !== "string" || oldString === "") throw new Error("memory-skill-patch.oldString is required");
  if (typeof newString !== "string") throw new Error("memory-skill-patch.newString is required");
  return { path, oldString, newString };
}


export function assertInsideRoot(rootDir: string, filePath: string, label: string): void {
  const rel = relative(rootDir, filePath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside --root`);
  }
}


export function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}


export interface SkillImprovementProposalSummary {
  skill: string;
  category: string;
  reason: string;
  skillPath: string;
  recentFailures: number;
  dominantErrorStage: string | null;
  dominantErrorClass: string | null;
  patchDrafted: boolean;
  score: number;
  priority: "high" | "medium" | "low";
  scoreReasons: string[];
  fingerprint: string;
  evidenceSource: string;
  evidenceRoute: string;
  dominantErrorPattern: string;
  telemetryWindow: string;
  cardStatus: SkillTelemetryEvidenceCardStatus;
  reusedExisting: boolean;
  path: string | null;
  written: boolean;
}


export interface SkillTelemetryEvidenceCardArtifact {
  id: string;
  contract: "memory.evidence-card.experimental.v1";
  kind: "skill_telemetry";
  skill: string;
  skillPath: string;
  status: SkillTelemetryEvidenceCardStatus;
  signalFingerprint: string;
  fingerprint: string;
  path: string;
  proposalPath: string;
  reusedExisting: boolean;
  written: boolean;
}


export interface SkillImprovementBuildResult {
  proposals: SkillImprovementProposalSummary[];
  evidenceCards: SkillTelemetryEvidenceCardArtifact[];
}


export async function buildSkillImprovementProposals(
  rootDir: string,
  recommendations: readonly {
    name: string;
    source_kind: string;
    category: string;
    reason: string;
    path: string;
    curatable: boolean;
  }[],
  rollups: readonly SkillRollup[],
  recentEvents: readonly SkillEventSummary[],
  writeProposal: boolean,
): Promise<SkillImprovementBuildResult> {
  const candidates = recommendations.filter((rec) => rec.curatable && rec.category === "frequently-failing");
  const proposals: SkillImprovementProposalSummary[] = [];
  const evidenceCards: SkillTelemetryEvidenceCardArtifact[] = [];
  const proposalDir = join(rootDir, ".red", "memory", "proposals");
  const evidenceCardDir = join(rootDir, ".red", "memory", "inbox", "evidence");
  if (writeProposal && candidates.length > 0) {
    await mkdir(proposalDir, { recursive: true });
    await mkdir(evidenceCardDir, { recursive: true });
  }

  const pendingProposals = writeProposal ? await listPendingProposalFiles(rootDir) : [];

  for (const rec of candidates) {
    const evidence = recentFailureEvidence(rec.name, recentEvents);
    const dominantErrorStage = topValues(evidence.map((event) => event.error_stage))[0] ?? null;
    const dominantErrorClass = topValues(evidence.map((event) => event.error_class))[0] ?? null;
    const dominantErrorCode = topValues(evidence.map((event) => event.error_code))[0] ?? null;
    const relSkillPath = isAbsolute(rec.path) ? toPosix(relative(rootDir, rec.path)) : rec.path;
    const evidenceSource = skillTelemetryEvidenceSource(rec.name, evidence);
    const evidenceRoute = skillTelemetryEvidenceRoute(rec.category, relSkillPath);
    const dominantErrorPattern = skillTelemetryDominantErrorPattern({
      dominantErrorStage,
      dominantErrorClass,
      dominantErrorCode,
    });
    const telemetryWindow = skillTelemetryWindow(evidence);
    const signalFingerprint = skillTelemetrySignalFingerprint({
      evidenceSource,
      evidenceRoute,
      dominantErrorPattern,
      telemetryWindow,
    });
    const fingerprint = proposalFingerprint({
      skill: rec.name,
      category: rec.category,
      skillPath: relSkillPath,
      dominantErrorStage,
      dominantErrorClass,
    });
    let proposalPath: string | null = null;
    let reusedExisting = false;
    if (writeProposal) {
      const existing = pendingProposals.find((proposal) => proposal.fingerprint === fingerprint);
      if (existing) {
        proposalPath = resolve(rootDir, existing.path);
        reusedExisting = true;
      } else {
        const file = `skill-improvement-${slugify(rec.name)}-${fingerprint.slice("sha256:".length, "sha256:".length + 12)}.md`;
        proposalPath = join(proposalDir, file);
      }
    }

    const reusableCard =
      writeProposal && proposalPath
        ? await findReusableSkillTelemetryEvidenceCard(rootDir, evidenceCardDir, signalFingerprint)
        : null;
    const cardlessBody = await renderSkillImprovementProposal(rootDir, rec, evidence, fingerprint, null);
    const patchDrafted = cardlessBody.includes("```json memory-skill-patch");
    const priority = computeProposalPriority({
      reason: rec.reason,
      recentFailures: evidence.length,
      dominantErrorStage,
      dominantErrorClass,
      patchDrafted,
    });
    const existingCardCount = writeProposal
      ? await countSkillTelemetryEvidenceCardsForSignal(evidenceCardDir, signalFingerprint)
      : 0;
    const cardRevision = reusableCard ? reusableCard.revision : existingCardCount;
    const card = buildSkillTelemetryEvidenceCard({
      rootDir,
      rec,
      rollup: rollups.find((r) => r.source_kind === rec.source_kind && r.name === rec.name && r.path === rec.path),
      evidence,
      dominantErrorStage,
      dominantErrorClass,
      proposalFingerprint: fingerprint,
      signalFingerprint,
      evidenceSource,
      evidenceRoute,
      dominantErrorPattern,
      telemetryWindow,
      cardRevision,
      reusableCard,
      priority,
    });
    if (writeProposal && proposalPath) {
      card.proposal.path = toPosix(relative(rootDir, proposalPath));
    }
    const body =
      writeProposal && proposalPath
        ? await renderSkillImprovementProposal(rootDir, rec, evidence, fingerprint, card)
        : cardlessBody;
    if (writeProposal && proposalPath) {
      const cardPath = join(evidenceCardDir, card.file);
      const cardReusedExisting = existsSync(cardPath);
      await writeFile(proposalPath, body, "utf8");
      await writeFile(cardPath, renderEvidenceCardYaml(card), "utf8");
      evidenceCards.push({
        id: card.id,
        contract: "memory.evidence-card.experimental.v1",
        kind: "skill_telemetry",
        skill: rec.name,
        skillPath: rec.path,
        status: card.status,
        signalFingerprint: card.signal_fingerprint,
        fingerprint: card.fingerprint,
        path: cardPath,
        proposalPath,
        reusedExisting: cardReusedExisting,
        written: true,
      });
    }
    proposals.push({
      skill: rec.name,
      category: rec.category,
      reason: rec.reason,
      skillPath: rec.path,
      recentFailures: evidence.length,
      dominantErrorStage,
      dominantErrorClass,
      patchDrafted,
      score: priority.score,
      priority: priority.priority,
      scoreReasons: priority.reasons,
      fingerprint,
      evidenceSource,
      evidenceRoute,
      dominantErrorPattern,
      telemetryWindow,
      cardStatus: card.status,
      reusedExisting,
      path: proposalPath,
      written: writeProposal,
    });
  }
  return {
    proposals: sortProposalSummaries(proposals),
    evidenceCards: evidenceCards.sort((a, b) => a.skill.localeCompare(b.skill) || a.path.localeCompare(b.path)),
  };
}
