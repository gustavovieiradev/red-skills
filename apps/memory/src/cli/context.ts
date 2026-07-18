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



export function formatVectorRecallDiagnostic(d: {
  status: "unavailable" | "available" | "contributed";
  candidates: number;
  contributed: number;
  reason?: string;
}): string {
  if (d.status === "contributed") {
    return `vector retrieval contributed ${d.contributed} candidate(s)`;
  }
  if (d.status === "available") {
    return "vector retrieval available; 0 candidate(s) contributed";
  }
  const reason = d.reason ? `: ${d.reason}` : "";
  return `vector retrieval unavailable${reason}`;
}


export async function runContextPack(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const goal = args.positional.join(" ").trim();
  if (!goal) throw new Error("nothing to pack — pass a goal: memory context-pack <goal>");
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `context-pack needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }

  const budgetChars =
    typeof args.flags.budget === "string" ? Number(args.flags.budget) : undefined;
  const limit = typeof args.flags.limit === "string" ? Number(args.flags.limit) : undefined;
  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const skillRollups = await readSkillRollups(store);
    const pack = await buildContextPack(store, goal, {
      budgetChars,
      limit,
      scope: scopeFlags(args.flags),
      skillRollups,
    });
    await appendContextPackGenerationEvent(store, {
      pack,
      surface: "cli",
      metadata: { command: "context-pack", json: args.flags.json === true },
    });
    // Recall telemetry from a real run (#828): additive, never blocks the pack.
    await appendRecallObservationEvent(
      store,
      recallObservationFromContextPack(pack, { surface: "context-pack" }),
    );
    if (args.flags.json === true) {
      console.log(JSON.stringify(pack, null, 2));
      return;
    }
    printContextPackToon(pack);
  } finally {
    await store.close();
  }
}


export type ContextPackToonEntry = {
  section: string;
  title: string;
  nodeType: string;
  importance: number;
  confidence: string;
  trust: number;
  citation: string;
  reason: string;
  excerpt: string;
  expandHandle: string;
};


export function printContextPackToon(pack: ContextPack): void {
  const rows: ContextPackToonEntry[] = pack.entries.map((entry) => ({
    section: entry.section,
    title: entry.title,
    nodeType: entry.nodeType,
    importance: entry.importance,
    confidence: entry.confidence,
    trust: entry.trust,
    citation: entry.citation.urn,
    reason: entry.reason,
    excerpt: entry.excerpt,
    expandHandle: entry.expandHandle,
  }));
  console.log(
    renderToonOutput({
      rowsKey: "entries",
      rows,
      fields: [
        "section",
        "title",
        "nodeType",
        "importance",
        "confidence",
        "trust",
        "citation",
        "reason",
        "excerpt",
        "expandHandle",
      ],
      summary: {
        status: pack.status,
        goal: pack.goal,
        entries: pack.entries.length,
        coreContext: pack.coreContext.length,
        warnings: pack.warnings.length,
        omittedEntries: pack.omittedEntries,
        budgetChars: pack.budgetChars,
        usedChars: pack.usedChars,
      },
      extra: {
        warnings: pack.warnings.map((warning) => ({
          kind: warning.kind,
          message: warning.message,
        })),
        ...(pack.entries.length === 0
          ? {
              next: 'run `memory store "..." --root <root>` or `memory ingest . --root <root>`, then rerun context-pack',
            }
          : {}),
      },
    }),
  );
}


export async function runCapsule(args: ParsedArgs): Promise<void> {
  const goal = args.positional.join(" ").trim();
  if (!goal) throw new Error("nothing to package — pass a goal: memory capsule <goal>");
  const { store } = await openGraphStore(args);
  try {
    const source = capsuleSourceFlag(args.flags);
    const skillRollups = source === "context-pack" ? await readSkillRollups(store) : [];
    const capsule = await buildMemoryCapsule(store, goal, {
      source,
      budgetChars: intFlag(args.flags, "budget"),
      limit: intFlag(args.flags, "limit"),
      depth: intFlag(args.flags, "depth"),
      scope: scopeFlags(args.flags),
      skillRollups,
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(capsule, null, 2));
      return;
    }
    process.stdout.write(capsule.markdown);
  } finally {
    await store.close();
  }
}


export function capsuleSourceFlag(flags: ParsedArgs["flags"]): MemoryCapsuleSourceKind {
  const source = stringFlag(flags, "source") ?? "context-pack";
  if (source === "context-pack" || source === "handoff") return source;
  throw new Error(`invalid capsule source "${source}" — expected context-pack or handoff`);
}


export async function runContextPackViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const goal = args.positional.join(" ").trim();
  if (!goal) {
    throw new Error("nothing to inspect — pass a goal: memory context-pack-viewer <goal>");
  }
  const { store } = await openGraphStore(args);
  try {
    const skillRollups = await readSkillRollups(store);
    const pack = await buildContextPack(store, goal, {
      budgetChars: intFlag(args.flags, "budget"),
      limit: intFlag(args.flags, "limit"),
      depth: intFlag(args.flags, "depth"),
      scope: scopeFlags(args.flags),
      skillRollups,
    });
    const artifact = buildContextPackViewerArtifact(pack);
    const safeName = slugify(goal).slice(0, 60) || "context-pack";
    const outPath = resolve(
      stringFlag(args.flags, "out") ??
        join(rootDir, `.red/memory/context-pack-${safeName}.html`),
    );
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    await appendContextPackGenerationEvent(store, {
      pack,
      surface: "cli-viewer",
      metadata: { command: "context-pack-viewer", out_path: outPath },
    });
    console.log(`memory: context pack viewer written ${outPath}`);
    console.log(`  status: ${pack.status}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runRecommend(args: ParsedArgs): Promise<void> {
  const kind = args.positional[0];
  if (kind !== "skills") {
    throw new Error("recommend needs a kind — supported: memory recommend skills <task>");
  }
  const task = args.positional.slice(1).join(" ").trim();
  if (!task) throw new Error("nothing to recommend — pass a task: memory recommend skills <task>");

  const { store } = await openGraphStore(args);
  try {
    const skillRollups = await readSkillRollups(store);
    const report = await buildSkillRecommendations(store, task, {
      limit: intFlag(args.flags, "limit"),
      scope: scopeFlags(args.flags),
      skillRollups,
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`memory: skill recommendations for "${task}"`);
    process.stdout.write(renderSkillRecommendationsSection(report));
  } finally {
    await store.close();
  }
}


export async function runPreflight(args: ParsedArgs): Promise<void> {
  const task = args.positional.join(" ").trim();
  if (!task) throw new Error("nothing to brief — pass a task: memory preflight <task>");
  const { store } = await openGraphStore(args);
  try {
    const brief = await buildPreflightBrief(store, task, {
      limit: intFlag(args.flags, "limit"),
      minEvidence: intFlag(args.flags, "min-evidence"),
      staleDays: intFlag(args.flags, "stale-days"),
      scope: scopeFlags(args.flags),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(brief, null, 2));
      return;
    }
    process.stdout.write(brief.markdown);
  } finally {
    await store.close();
  }
}


export async function runReadiness(args: ParsedArgs): Promise<void> {
  const goal = args.positional.join(" ").trim();
  if (!goal) throw new Error("nothing to assess — pass a goal: memory readiness <goal>");
  const { store } = await openGraphStore(args);
  try {
    const envelope = await buildReadinessEnvelope(store, goal, {
      limit: intFlag(args.flags, "limit"),
      minEvidence: intFlag(args.flags, "min-evidence"),
      staleDays: intFlag(args.flags, "stale-days"),
      scope: scopeFlags(args.flags),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(envelope, null, 2));
      return;
    }
    printReadinessEnvelope(envelope);
  } finally {
    await store.close();
  }
}


export async function runReadinessViewer(args: ParsedArgs): Promise<void> {
  const goal = args.positional.join(" ").trim();
  if (!goal) {
    throw new Error("nothing to inspect — pass a goal: memory readiness-viewer <goal>");
  }
  const rootDir = rootOf(args.flags);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/readiness-viewer.html"),
  );
  const { store } = await openGraphStore(args);
  try {
    const envelope = await buildReadinessEnvelope(store, goal, {
      limit: intFlag(args.flags, "limit"),
      minEvidence: intFlag(args.flags, "min-evidence"),
      staleDays: intFlag(args.flags, "stale-days"),
      scope: scopeFlags(args.flags),
    });
    const artifact = buildReadinessViewerArtifact(envelope);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: readiness viewer written ${outPath}`);
    console.log(`  goal: ${envelope.request.goal}`);
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}


export async function runDashboard(args: ParsedArgs): Promise<void> {
  const rootDir = resolve(rootOf(args.flags));
  const { store } = await openGraphStore(args);
  try {
    const dashboard = await buildMemoryOperationalDashboard(store, rootDir, {
      staleDays: intFlag(args.flags, "stale-days"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(dashboard, null, 2));
      return;
    }
    const outFlag = stringFlag(args.flags, "out");
    if (outFlag !== undefined) {
      const outPath = resolve(outFlag);
      const artifact = buildMemoryOperationalDashboardArtifact(dashboard);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, artifact.html, "utf8");
      console.log(`memory: operational dashboard written ${outPath}`);
      console.log(`  state: ${dashboard.state}`);
      console.log(`  contract: ${artifact.contract.consumes}`);
      return;
    }
    printDashboardToon(dashboard);
  } finally {
    await store.close();
  }
}


export type DashboardToonSection = {
  area: string;
  status: string;
  metric: string;
  value: number;
  detail: string;
};


export function printDashboardToon(dashboard: MemoryOperationalDashboard): void {
  const sections: DashboardToonSection[] = [
    {
      area: "stats",
      status: dashboard.state,
      metric: "nodes",
      value: dashboard.stats.nodes,
      detail: `${dashboard.stats.docs} docs; ${dashboard.stats.edges} edges`,
    },
    {
      area: "vector",
      status: dashboard.vector.overall,
      metric: "ready",
      value: dashboard.vector.ready,
      detail: `${dashboard.vector.total} total; ${dashboard.vector.unavailable} unavailable; ${dashboard.vector.failed} failed`,
    },
    {
      area: "docs",
      status: dashboard.docs.ungrounded > 0 ? "attention" : "ready",
      metric: "grounded",
      value: dashboard.docs.grounded,
      detail: `${dashboard.docs.total} total; ${dashboard.docs.warnings} warning(s)`,
    },
    {
      area: "hooks",
      status: dashboard.hooks.actionable_gaps > 0 ? "attention" : "ready",
      metric: "wired_events",
      value: dashboard.hooks.wired_events,
      detail: `${dashboard.hooks.enabled_events} enabled; ${dashboard.hooks.actionable_gaps} actionable gap(s)`,
    },
    {
      area: "extraction",
      status: dashboard.extraction.inferred_available ? "ready" : "unavailable",
      metric: "inferred_facts",
      value: dashboard.extraction.inferred_facts,
      detail: dashboard.extraction.egress ?? "no inferred extraction egress",
    },
    {
      area: "stale",
      status: dashboard.stale.stale_nodes > 0 ? "attention" : "ready",
      metric: "stale_nodes",
      value: dashboard.stale.stale_nodes,
      detail: `${dashboard.stale.total_nodes} total; ${dashboard.stale.stale_days} day policy`,
    },
    {
      area: "decay",
      status: dashboard.decay.status,
      metric: "review",
      value: dashboard.decay.review,
      detail: `${dashboard.decay.keep} keep; ${dashboard.decay.deprecate} deprecate; ${dashboard.decay.expire} expire`,
    },
  ];
  const empty = dashboard.stats.nodes === 0 && dashboard.stats.docs === 0;
  console.log(
    renderToonOutput({
      rowsKey: "sections",
      rows: sections,
      fields: ["area", "status", "metric", "value", "detail"],
      summary: {
        status: empty ? "empty" : dashboard.state,
        state: dashboard.state,
        nodes: dashboard.stats.nodes,
        edges: dashboard.stats.edges,
        docs: dashboard.stats.docs,
        warnings: dashboard.warnings.length,
        actions: dashboard.recommended_next_actions.length + (empty ? 1 : 0),
        schema: dashboard.schema_version,
      },
      extra: {
        warnings: dashboard.warnings.map((message) => ({ message })),
        next: [
          ...dashboard.recommended_next_actions.map((action) => ({ action })),
          ...(empty
            ? [{ action: "run `memory ingest . --root <root>` to populate dashboard evidence" }]
            : []),
        ],
      },
    }),
  );
}


export async function runWorkbench(args: ParsedArgs): Promise<void> {
  const rootDir = resolve(rootOf(args.flags));
  const { store } = await openGraphStore(args);
  try {
    const workbench = await buildMemoryWorkbench(store, rootDir, {
      staleDays: intFlag(args.flags, "stale-days"),
      sessionId: stringFlag(args.flags, "session"),
      limit: intFlag(args.flags, "limit"),
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(workbench, null, 2));
      return;
    }
    const outPath = resolve(
      stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/workbench.html"),
    );
    const artifact = buildMemoryWorkbenchArtifact(workbench);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: workbench written ${outPath}`);
    console.log(`  state: ${workbench.dashboard.state}`);
    console.log(`  contract: ${artifact.contract.consumes.join(", ")}`);
  } finally {
    await store.close();
  }
}


export async function runCapabilities(args: ParsedArgs): Promise<void> {
  const rootDir = resolve(rootOf(args.flags));
  const { store } = await openGraphStore(args);
  try {
    const catalog = await buildMemoryCapabilityCatalog(store, rootDir);
    if (args.flags.json === true) {
      console.log(JSON.stringify(catalog, null, 2));
      return;
    }
    console.log(
      `memory capabilities: ${catalog.summary.ready}/${catalog.summary.total} ready, ${catalog.summary.red_db_backed} RedDB-backed`,
    );
    for (const item of catalog.capabilities) {
      console.log(`  ${item.category}/${item.id}: ${item.status}`);
      if (item.cli.length > 0) console.log(`      cli: ${item.cli.join(", ")}`);
      if (item.mcp.length > 0) console.log(`      mcp: ${item.mcp.join(", ")}`);
    }
  } finally {
    await store.close();
  }
}


export async function runReferenceRadar(args: ParsedArgs): Promise<void> {
  const rootDir = resolve(rootOf(args.flags));
  const { store } = await openGraphStore(args);
  try {
    const radar = await buildMemoryReferenceRadar(store, rootDir);
    if (args.flags.json === true) {
      console.log(JSON.stringify(radar, null, 2));
      return;
    }
    console.log(
      `memory references radar: ${radar.summary.references} reference(s), ${radar.summary.degraded_or_not_configured} gap signal(s)`,
    );
    console.log(`  note: ${radar.note}`);
    for (const reference of radar.references) {
      console.log(
        `  ${reference.repository}: ${reference.posture} score=${reference.score.toFixed(3)} capabilities=${reference.relevant_capabilities}`,
      );
      for (const gap of reference.gaps) {
        console.log(`      gap: ${gap.capability_id} (${gap.status}) -> ${gap.next_action}`);
      }
    }
  } finally {
    await store.close();
  }
}


export async function runMemoryLayers(args: ParsedArgs): Promise<void> {
  const { store } = await openGraphStore(args);
  try {
    const report = await buildMemoryLayersReport(store);
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(
      `memory layers: ${report.summary.ready_layers}/${report.summary.total_layers} ready, ${report.summary.red_db_backed_layers} RedDB-backed`,
    );
    for (const layer of report.layers) {
      console.log(`  ${layer.id}: ${layer.status}`);
      const counts = Object.entries(layer.counts)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      if (counts) console.log(`      ${counts}`);
    }
  } finally {
    await store.close();
  }
}


export async function runMemoryLayersViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const { store } = await openGraphStore(args);
  try {
    const outPath = resolve(
      stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/layers-viewer.html"),
    );
    const report = await buildMemoryLayersReport(store);
    const artifact = buildMemoryLayersViewerArtifact(report);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, artifact.html, "utf8");
    console.log(`memory: layers viewer written ${outPath}`);
    console.log(
      `  ready: ${report.summary.ready_layers}/${report.summary.total_layers}`,
    );
    console.log(`  contract: ${artifact.contract.consumes}`);
  } finally {
    await store.close();
  }
}
