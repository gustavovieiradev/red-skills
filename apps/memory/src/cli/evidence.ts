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
import { runConflicts, runSupersede, runResolveConflict, runTimeline, runCommunities, renderCommunitiesToon, runCommunitiesViewer, runCommunityDigest, runHubReport, runSuggestedQuestions, parseHubRankBy, renderHubReportToon, renderSuggestedQuestionsToon, parseRid, printConflicts, printTimeline, printTimelineToon, runStructuralImpact, runPrePrReview, runPrePrReviewViewer, runStructuralImpactViewer, printStructuralImpact, readChangedFiles, parseChangedFiles, printPrePrReview, printPrePrSection, printReadinessEnvelope } from "./analytics.js";
import type { TimelineToonEntry } from "./analytics.js";
import { runStats, runVector, runDoctor, runExport, runGlobalSearch, resolveOverviewContract, runArchitectureOverview, readStdin, HOOK_EVENTS, runHook, VCS_EVENTS, runVcs, runVcsRefresh, resolveHooksDir, resolveBootstrapPath, runVcsInstallHooks, runVcsUninstallHooks, runAttempt, runAttemptLearn, runAttemptLearnApply, runImport, parseComplementaryMapKind, runPromoteCmd, runAfkFinalize } from "./system.js";



export async function runInbox(args: ParsedArgs): Promise<void> {
  const action = args.positional[0] ?? "list";
  const rootDir = rootOf(args.flags);
  await requireConfig(rootDir);

  switch (action) {
    case "quarantine": {
      const item = await quarantineInboxItem(rootDir, {
        fact: args.positional.slice(1).join(" "),
        reason: stringFlag(args.flags, "reason") ?? "",
        evidenceSummary: stringFlag(args.flags, "evidence") ?? "",
        provenance: {
          sourceKind: parseSourceKind(args.flags["source-kind"]),
          writer: stringFlag(args.flags, "writer"),
          command: stringFlag(args.flags, "command"),
          hook: stringFlag(args.flags, "hook"),
          confidence: parseConfidence(args.flags.confidence),
          scope: scopeContext(args.flags),
        },
      });
      return printInboxResult("quarantined", item, args.flags.json === true);
    }
    case "list": {
      const status = parseInboxStatusFilter(args.flags.status);
      let items = await listInboxItems(rootDir);
      if (status) items = items.filter((item) => item.status === status);
      if (args.flags.json === true) {
        console.log(JSON.stringify({ items }, null, 2));
        return;
      }
      printInboxList(items);
      return;
    }
    case "inspect": {
      const id = args.positional[1];
      if (!id) throw new Error("memory inbox inspect needs an item id");
      const item = await readInboxItem(rootDir, id);
      if (args.flags.json === true) {
        console.log(JSON.stringify({ item }, null, 2));
        return;
      }
      printInboxItem(item);
      return;
    }
    case "approve": {
      const id = args.positional[1];
      if (!id) throw new Error("memory inbox approve needs an item id");
      if (args.flags.yes !== true) {
        throw new Error("memory inbox approve requires explicit --yes approval");
      }
      const item = await approveInboxItem(rootDir, id);
      return printInboxResult("approved", item, args.flags.json === true);
    }
    case "reject": {
      const id = args.positional[1];
      if (!id) throw new Error("memory inbox reject needs an item id");
      if (args.flags.yes !== true) {
        throw new Error("memory inbox reject requires explicit --yes approval");
      }
      const item = await rejectInboxItem(rootDir, id, stringFlag(args.flags, "reason") ?? "");
      return printInboxResult("rejected", item, args.flags.json === true);
    }
    case "promote": {
      const id = args.positional[1];
      if (!id) throw new Error("memory inbox promote needs an item id");
      if (args.flags.yes !== true) {
        throw new Error("memory inbox promote requires explicit --yes approval");
      }
      const config = await requireConfig(rootDir);
      if (config.mode !== "graph") {
        throw new Error(
          `memory inbox promote needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
        );
      }
      const pending = await readInboxItem(rootDir, id);
      if (pending.status !== "approved") {
        throw new Error(`memory inbox item ${id} must be approved before promotion`);
      }
      const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
      let rid = 0;
      try {
        rid = await store.upsertNode(
          factToNode(pending.fact, slugify, {
            scope: pending.provenance.scope?.level,
            scopeId: pending.provenance.scope?.id,
            provenance: inboxItemToProvenance(pending),
          }),
        );
      } finally {
        await store.close();
      }
      const item = await markInboxItemPromoted(rootDir, id, rid);
      return printInboxResult("promoted", item, args.flags.json === true);
    }
    default:
      throw new Error(
        "usage: memory inbox quarantine|list|inspect|approve|reject|promote [args]",
      );
  }
}


export async function runEvidence(args: ParsedArgs): Promise<void> {
  const action = args.positional[0] ?? "list";
  const rootDir = rootOf(args.flags);
  await requireConfig(rootDir);

  switch (action) {
    case "create": {
      const card = await createEvidenceCard(rootDir, evidenceCardInputFromFlags(args));
      return printEvidenceResult("created", card, args.flags.json === true);
    }
    case "list": {
      const status = parseEvidenceStatusFilter(args.flags.status);
      let cards = await listEvidenceCards(rootDir);
      if (status) cards = cards.filter((card) => card.status === status);
      if (args.flags.json === true) {
        console.log(JSON.stringify({ cards }, null, 2));
        return;
      }
      printEvidenceList(cards);
      return;
    }
    case "show": {
      const id = args.positional[1];
      if (!id) throw new Error("memory evidence show needs a card id");
      const card = await readEvidenceCard(rootDir, id);
      if (args.flags.json === true) {
        console.log(JSON.stringify({ card }, null, 2));
        return;
      }
      printEvidenceCard(card);
      return;
    }
    case "approve": {
      const id = args.positional[1];
      if (!id) throw new Error("memory evidence approve needs a card id");
      if (args.flags.yes !== true) {
        throw new Error("memory evidence approve requires explicit --yes approval");
      }
      const reviewer = stringFlag(args.flags, "reviewer");
      const linked = await approveLinkedEvidenceCard(rootDir, id, reviewer);
      if (linked) return printLinkedEvidenceResult("approved", linked, args.flags.json === true);
      const card = await approveEvidenceCard(rootDir, id, reviewer);
      return printEvidenceResult("approved", card, args.flags.json === true);
    }
    case "reject": {
      const id = args.positional[1];
      if (!id) throw new Error("memory evidence reject needs a card id");
      if (args.flags.yes !== true) {
        throw new Error("memory evidence reject requires explicit --yes approval");
      }
      const reason = stringFlag(args.flags, "reason")?.trim();
      if (!reason) throw new Error("memory evidence reject requires a non-empty --reason");
      const reviewer = stringFlag(args.flags, "reviewer");
      const linked = await rejectLinkedEvidenceCard(rootDir, id, reason, reviewer);
      if (linked) return printLinkedEvidenceResult("rejected", linked, args.flags.json === true);
      const card = await rejectEvidenceCard(
        rootDir,
        id,
        reason,
        reviewer,
      );
      if (card.proposal_link.path) {
        await markProposalEvidenceRejected(rootDir, card.proposal_link.path, card.id, reason);
      }
      return printEvidenceResult("rejected", card, args.flags.json === true);
    }
    default:
      throw new Error("usage: memory evidence create|list|show|approve|reject [args]");
  }
}


export interface LinkedEvidenceReviewResult {
  id: string;
  status: "approved" | "rejected";
  path: string;
  proposalPath?: string;
}


export async function approveLinkedEvidenceCard(
  rootDir: string,
  id: string,
  reviewer: string | undefined,
): Promise<LinkedEvidenceReviewResult | null> {
  const found = await findLinkedEvidenceCard(rootDir, id);
  if (!found) return null;
  const rawStatus = firstYamlScalar(found.body, "status");
  if (rawStatus === "approved") {
    const proposalPath = firstNestedYamlScalar(found.body, "proposal", "path");
    return { id, status: "approved", path: found.path, ...(proposalPath ? { proposalPath } : {}) };
  }
  if (rawStatus !== "proposed") {
    throw new Error(`memory evidence card ${id} cannot be approved from status ${rawStatus ?? "unknown"}`);
  }
  const updated = withLinkedEvidenceReview(found.body, "approved", reviewer);
  await writeFile(found.path, updated, "utf8");
  const proposalPath = firstNestedYamlScalar(updated, "proposal", "path");
  return { id, status: "approved", path: found.path, ...(proposalPath ? { proposalPath } : {}) };
}


export async function rejectLinkedEvidenceCard(
  rootDir: string,
  id: string,
  reason: string,
  reviewer: string | undefined,
): Promise<LinkedEvidenceReviewResult | null> {
  const found = await findLinkedEvidenceCard(rootDir, id);
  if (!found) return null;
  const rawStatus = firstYamlScalar(found.body, "status");
  const proposalPath = firstNestedYamlScalar(found.body, "proposal", "path");
  if (rawStatus === "rejected") {
    const reviewNotes = firstNestedYamlScalar(found.body, "review", "notes");
    if (proposalPath) await markProposalEvidenceRejected(rootDir, proposalPath, id, reviewNotes ?? reason);
    return { id, status: "rejected", path: found.path, ...(proposalPath ? { proposalPath } : {}) };
  }
  if (rawStatus !== "proposed") {
    throw new Error(`memory evidence card ${id} cannot be rejected from status ${rawStatus ?? "unknown"}`);
  }
  const updated = withLinkedEvidenceReview(found.body, "rejected", reviewer, reason);
  await writeFile(found.path, updated, "utf8");
  if (proposalPath) await markProposalEvidenceRejected(rootDir, proposalPath, id, reason);
  return { id, status: "rejected", path: found.path, ...(proposalPath ? { proposalPath } : {}) };
}


export async function findLinkedEvidenceCard(rootDir: string, id: string): Promise<{ path: string; body: string } | null> {
  const dir = join(rootDir, ".red", "memory", "inbox", "evidence");
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const idLine = `id: ${yamlScalar(id)}`;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    const path = join(dir, entry.name);
    const body = await readFile(path, "utf8");
    if (body.includes('contract: "memory.evidence-card.experimental.v1"') && body.includes(idLine)) {
      return { path, body };
    }
  }
  return null;
}


export function withLinkedEvidenceReview(
  body: string,
  status: "approved" | "rejected",
  reviewer: string | undefined,
  reason?: string,
): string {
  const now = new Date().toISOString();
  let next = body.replace(/^status: .+$/m, `status: ${yamlScalar(status)}`);
  next = next.replace(/^updated_at: .+$/m, `updated_at: ${yamlScalar(now)}`);
  next = next.replace(/\nreview:\n(?:  .+\n)*/m, "\n");
  const review = [
    "review:",
    `  decision: ${yamlScalar(status)}`,
    ...(reviewer ? [`  reviewer: ${yamlScalar(reviewer)}`] : []),
    `  reviewed_at: ${yamlScalar(now)}`,
    ...(reason ? [`  notes: ${yamlScalar(status === "rejected" ? (redactSensitiveValue(reason) as string) : reason)}`] : []),
  ].join("\n");
  return next.replace(/\nproposal:\n/, `\n${review}\nproposal:\n`);
}


export async function markProposalEvidenceRejected(
  rootDir: string,
  proposalPathValue: string,
  evidenceCardId: string,
  reason: string,
): Promise<void> {
  const proposalPath = resolve(rootDir, proposalPathValue);
  assertInsideRoot(rootDir, proposalPath, "proposal file");
  assertInsideProposalTree(rootDir, proposalPath);
  const body = await readFile(proposalPath, "utf8");
  const marker = `Evidence card id: ${evidenceCardId}`;
  if (body.includes(marker) && body.includes("Evidence Card Review Warning")) return;
  const redactedReason = redactSensitiveValue(reason) as string;
  const warning = [
    "",
    "## Evidence Card Review Warning",
    "",
    `- Evidence card id: ${evidenceCardId}`,
    "- Status: rejected",
    `- Reason: ${redactedReason}`,
    "",
    "The evidence interpretation for the linked card was rejected. This warning does not archive, move, delete, apply, or otherwise approve this proposal.",
    "",
  ].join("\n");
  await writeFile(proposalPath, `${body.trimEnd()}\n${warning}`, "utf8");
}


export function firstYamlScalar(body: string, key: string): string | null {
  const match = body.match(new RegExp(`^${escapeRegExp(key)}: (.+)$`, "m"));
  return match ? unquoteYamlScalar(match[1]) : null;
}


export function firstNestedYamlScalar(body: string, parent: string, key: string): string | null {
  const match = body.match(new RegExp(`^${escapeRegExp(parent)}:\\n(?:  .+\\n)*?  ${escapeRegExp(key)}: (.+)$`, "m"));
  return match ? unquoteYamlScalar(match[1]) : null;
}


export function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed) as string;
  return trimmed;
}


export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


export function evidenceCardInputFromFlags(args: ParsedArgs): CreateEvidenceCardInput {
  const summary = (stringFlag(args.flags, "summary") ?? args.positional.slice(1).join(" ")).trim();
  if (!summary) throw new Error("memory evidence create requires --summary <text>");
  const sourceRef = stringFlag(args.flags, "source-ref") ?? stringFlag(args.flags, "source");
  if (!sourceRef) throw new Error("memory evidence create requires --source-ref <ref>");
  const lesson = stringFlag(args.flags, "lesson") ?? stringFlag(args.flags, "proposed-lesson");
  if (!lesson) throw new Error("memory evidence create requires --lesson <text>");
  const citations = collectEvidenceFlagValues(args, "citation").map(parseEvidenceCitation);
  if (citations.length === 0) throw new Error("memory evidence create requires at least one --citation <label|uri|quote>");
  const judgeScore = numberFlag(args.flags, "judge-score") ?? 0.5;
  const judgeReason = stringFlag(args.flags, "judge-reason") ?? "manual review candidate";
  const proposalApplyState = evidenceProposalApplyStateFlag(args.flags["proposal-apply-state"]);

  return {
    source: {
      kind: stringFlag(args.flags, "source-kind") ?? "manual",
      ref: sourceRef,
      ...(stringFlag(args.flags, "source-collected-at")
        ? { collected_at: stringFlag(args.flags, "source-collected-at") }
        : {}),
    },
    summary,
    citations,
    proposedLesson: {
      text: lesson,
      ...(stringFlag(args.flags, "lesson-scope") ? { scope: stringFlag(args.flags, "lesson-scope") } : {}),
    },
    route: {
      target: stringFlag(args.flags, "route") ?? "memory",
      ...(stringFlag(args.flags, "route-rationale") ? { rationale: stringFlag(args.flags, "route-rationale") } : {}),
    },
    confidence: parseConfidence(args.flags.confidence) ?? "INFERRED",
    blastRadius: {
      scope: stringFlag(args.flags, "blast-radius") ?? "project",
      ...(stringFlag(args.flags, "blast-radius-rationale")
        ? { rationale: stringFlag(args.flags, "blast-radius-rationale") }
        : {}),
    },
    privacyNotes: collectEvidenceFlagValues(args, "privacy-note"),
    judge: {
      score: judgeScore,
      rationale: judgeReason,
    },
    proposalLink: {
      kind: stringFlag(args.flags, "proposal-kind") ?? "none",
      ...(stringFlag(args.flags, "proposal-id") ? { id: stringFlag(args.flags, "proposal-id") } : {}),
      ...(stringFlag(args.flags, "proposal-path") ? { path: stringFlag(args.flags, "proposal-path") } : {}),
      apply_state: proposalApplyState,
    },
  };
}


export function collectEvidenceFlagValues(args: ParsedArgs, key: string): string[] {
  const values = collectRepeatedFlag(process.argv.slice(2), key);
  const single = stringFlag(args.flags, key);
  if (values.length === 0 && single) values.push(single);
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}


export function parseEvidenceCitation(raw: string): EvidenceCitation {
  const [label, uri, ...quoteParts] = raw.split("|").map((part) => part.trim());
  if (!label) throw new Error("--citation needs a non-empty label");
  return {
    label,
    ...(uri ? { uri } : {}),
    ...(quoteParts.length > 0 && quoteParts.join("|") ? { quote: quoteParts.join("|") } : {}),
  };
}


export function evidenceProposalApplyStateFlag(value: string | boolean | undefined): EvidenceProposalApplyState {
  if (value == null || value === false) return "unlinked";
  if (value === true) throw new Error("--proposal-apply-state requires a value");
  if (["unlinked", "pending", "applied", "rejected", "unknown"].includes(value)) {
    return value as EvidenceProposalApplyState;
  }
  throw new Error(`invalid proposal apply state "${value}"`);
}


export function parseEvidenceStatusFilter(value: string | boolean | undefined): EvidenceCardStatus | undefined {
  if (value == null || value === false || value === "all") return undefined;
  if (value === true) throw new Error("--status requires a value");
  if (["pending", "approved", "rejected"].includes(value)) return value as EvidenceCardStatus;
  throw new Error(`invalid evidence status "${value}"`);
}


export function printEvidenceResult(action: string, card: EvidenceCard, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ state: action, card }, null, 2));
    return;
  }
  console.log(`memory evidence: ${action} ${card.id}`);
  console.log(`  status: ${card.status}`);
}


export function printGovernedWriteResult(
  result: GovernedWriteResult,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`memory store-evidence: ${result.outcome}`);
  console.log(`  reason: ${result.reason}`);
  if (result.memory.urn) console.log(`  memory: ${result.memory.urn}`);
  if (result.review_artifact) {
    console.log(`  review: ${result.review_artifact.kind}:${result.review_artifact.id}`);
    console.log(`  path: ${result.review_artifact.path}`);
  }
  if (result.provenance.source_ref) console.log(`  source: ${result.provenance.source_ref}`);
  if (result.provenance.citation_excerpt) {
    console.log(`  citation: ${result.provenance.citation_excerpt}`);
  }
}


export function printLinkedEvidenceResult(action: string, card: LinkedEvidenceReviewResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ state: action, card }, null, 2));
    return;
  }
  console.log(`memory evidence: ${action} ${card.id}`);
  console.log(`  status: ${card.status}`);
  console.log(`  card: ${card.path}`);
  if (card.proposalPath) console.log(`  proposal: ${card.proposalPath}`);
}


export function printEvidenceList(cards: EvidenceCard[]): void {
  console.log(`memory evidence: ${cards.length} ${plural(cards.length, "card")}`);
  for (const card of cards) {
    const privacy = card.privacy.findings.length > 0 ? ` privacy=${card.privacy.findings.length}` : "";
    console.log(
      `  ${card.id} [${card.status}] ${card.summary.slice(0, 100)}${privacy} confidence=${card.confidence}`,
    );
  }
}


export function printEvidenceCard(card: EvidenceCard): void {
  console.log(`memory evidence: ${card.id}`);
  console.log(`contract: ${card.contract}`);
  console.log(`status: ${card.status}`);
  console.log(`summary: ${card.summary}`);
  console.log(`source: ${card.source.kind} ${card.source.ref}`);
  console.log(`citations: ${card.citations.map((citation) => citation.label).join(", ")}`);
  console.log(`proposed lesson: ${card.proposed_lesson.text}`);
  console.log(`route: ${card.route.target}${card.route.rationale ? ` - ${card.route.rationale}` : ""}`);
  console.log(`confidence: ${card.confidence}`);
  console.log(`blast radius: ${card.blast_radius.scope}`);
  const privacyKinds = [...new Set(card.privacy.findings.map((finding) => finding.kind))];
  console.log(`privacy: ${privacyKinds.length > 0 ? privacyKinds.join(", ") : "none"}`);
  console.log(`judge: ${card.judge.score} - ${card.judge.rationale}`);
  console.log(`review: ${card.review.state}${card.review.reason ? ` - ${card.review.reason}` : ""}`);
  console.log(`proposal: ${card.proposal_link.kind} apply_state=${card.proposal_link.apply_state}`);
}


export function parseInboxStatusFilter(value: string | boolean | undefined): InboxStatus | undefined {
  if (value == null || value === false || value === "all") return undefined;
  if (value === true) throw new Error("--status requires a value");
  if (isInboxStatus(value)) return value;
  throw new Error(`invalid inbox status "${value}"`);
}


export function isInboxStatus(value: string): value is InboxStatus {
  return ["quarantined", "approved", "rejected", "promoted"].includes(value);
}


export function scopeContext(flags: Record<string, string | boolean>) {
  const level = parseMemoryScope(flags.scope);
  const id = stringFlag(flags, "scope-id");
  if (!level && !id) return undefined;
  return {
    ...(level ? { level } : {}),
    ...(id ? { id } : {}),
  };
}


export function printInboxResult(action: string, item: MemoryInboxItem, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ state: action, item }, null, 2));
    return;
  }
  console.log(`memory inbox: ${action} ${item.id}`);
  if (item.promotedRid != null) console.log(`  promoted node: ${item.promotedRid}`);
}


export function printInboxList(items: MemoryInboxItem[]): void {
  console.log(`memory inbox: ${items.length} ${plural(items.length, "item")}`);
  for (const item of items) {
    const privacy = item.privacyFindings.length > 0 ? ` privacy=${item.privacyFindings.length}` : "";
    console.log(
      `  ${item.id} [${item.status}] ${item.fact.slice(0, 100)}${privacy} confidence=${item.provenance.confidence}`,
    );
  }
}


export function printInboxItem(item: MemoryInboxItem): void {
  console.log(`memory inbox: ${item.id}`);
  console.log(`status: ${item.status}`);
  console.log(`fact: ${item.fact}`);
  console.log(`reason: ${item.reason}`);
  console.log(`evidence: ${item.evidenceSummary}`);
  console.log(
    `classification: ${item.classification.kind} tier=${item.classification.recommendedTier} scope=${item.classification.recommendedScope}`,
  );
  if (item.classification.safetyWarnings.length > 0) {
    console.log(`warnings: ${item.classification.safetyWarnings.join(", ")}`);
  }
  const privacyKinds = [...new Set(item.privacyFindings.map((finding) => finding.kind))];
  console.log(`privacy: ${privacyKinds.length > 0 ? privacyKinds.join(", ") : "none"}`);
  console.log(`provenance: ${formatInboxProvenance(item)}`);
  if (item.rejectionReason) console.log(`rejection: ${item.rejectionReason}`);
  if (item.promotedRid != null) console.log(`promoted node: ${item.promotedRid}`);
}


export function formatInboxProvenance(item: MemoryInboxItem): string {
  const p = item.provenance;
  const parts: string[] = [p.sourceKind];
  if (p.writer) parts.push(`writer=${p.writer}`);
  if (p.command) parts.push(`command=${p.command}`);
  if (p.hook) parts.push(`hook=${p.hook}`);
  parts.push(`confidence=${p.confidence}`);
  if (p.scope?.level) {
    parts.push(`scope=${p.scope.level}${p.scope.id ? `:${p.scope.id}` : ""}`);
  }
  return parts.join(" ");
}
