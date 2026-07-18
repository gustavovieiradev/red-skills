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



export async function runHooks(args: ParsedArgs): Promise<void> {
  const action = args.positional[0];
  if (action === "coverage-viewer") return runHooksCoverageViewer(args);
  if (action !== "coverage") {
    throw new Error("hooks needs an action — supported: memory hooks coverage, memory hooks coverage-viewer");
  }
  const report = await buildHookCoverageReport(rootOf(args.flags));
  if (args.flags.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    `memory hooks coverage: ${report.summary.enabled_events}/${report.summary.total_events} enabled (${report.mode})`,
  );
  for (const runner of report.runners) {
    console.log(
      `  ${runner.runner}: ${runner.coverage.enabled}/${runner.coverage.total} enabled, ${runner.coverage.wired} wired`,
    );
    for (const event of runner.events) {
      const state = event.enabled ? "enabled" : event.wired ? "wired" : "missing";
      const matcher = event.matcher ? ` matcher=${event.matcher}` : "";
      console.log(`    ${event.event}: ${state}${matcher}`);
    }
  }
  for (const gap of report.gaps) console.log(`  gap: ${gap}`);
  for (const action of report.recommended_next_actions) console.log(`  next: ${action}`);
}


export async function runHooksCoverageViewer(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const outPath = resolve(
    stringFlag(args.flags, "out") ?? join(rootDir, ".red/memory/hook-coverage-viewer.html"),
  );
  const report = await buildHookCoverageReport(rootDir);
  const artifact = buildHookCoverageViewerArtifact(report);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, artifact.html, "utf8");
  console.log(`memory: hook coverage viewer written ${outPath}`);
  console.log(`  effective: ${report.summary.effective_events}/${report.summary.total_events}`);
  console.log(`  contract: ${artifact.contract.consumes}`);
}


export async function runClaimCheck(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const assertion = args.positional.join(" ").trim();
  if (!assertion) {
    throw new Error("nothing to claim-check — pass an assertion: memory claim-check <assertion>");
  }
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `claim-check needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }

  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const result = await claimCheck(store, assertion);
    if (args.flags.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printClaimCheck(result);
  } finally {
    await store.close();
  }
}


export function printClaimCheck(result: ClaimCheckResult): void {
  console.log(`memory claim-check: ${result.status}`);
  console.log(result.answer);
  console.log(`citations: ${result.citations.length}`);
  for (const item of [...result.evidence.active, ...result.evidence.superseded]) {
    const source = item.source ? ` source=${item.source}` : "";
    console.log(
      `  ${item.citation} memory_nodes:${item.rid} ${item.title} (${item.confidence}, ${item.status}${source})`,
    );
  }
  if (result.evidence.conflicting.length > 0) {
    console.log(`conflicting evidence: ${result.evidence.conflicting.length}`);
    for (const item of result.evidence.conflicting) {
      const reason = item.reason ? ` reason=${item.reason}` : "";
      console.log(`  ${item.from.citation} contradicts ${item.to.citation}${reason}`);
    }
  }
}


export async function runIngest(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const target = args.positional[0] ?? ".";
  const config = await requireConfig(rootDir);

  if (config.mode !== "graph") {
    throw new Error(
      `ingest needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }

  const cwd = isAbsolute(target) ? target : resolve(rootDir, target);
  const maxFiles =
    typeof args.flags["max-files"] === "string"
      ? Number(args.flags["max-files"])
      : undefined;
  const structuralOnly = args.flags["structural-only"] === true;

  // Pre-ingest scope wizard (#235): pick a preset, report the candidate count
  // before processing, and optionally generate the committed `.memoryignore`.
  const preset = resolvePreset(typeof args.flags.scope === "string" ? args.flags.scope : undefined);

  if (preset.name === "generate-ignore") {
    const path = await writeMemoryIgnore(cwd, defaultIgnorePatterns());
    console.log(`memory: wrote ${path}`);
    console.log("  edit and commit it; subsequent ingests honour it without re-prompting.");
    return;
  }

  const candidateFiles = await collectCandidates({ cwd });
  const memoryIgnore = await readMemoryIgnore(cwd);
  console.log(formatScopeReport(planScope(candidateFiles, preset.name, memoryIgnore)));

  const semanticProvider = !structuralOnly && config.provider ? resolveProvider(config.provider) : null;
  if (semanticProvider && config.provider) applyProviderEnv(semanticProvider, config.provider.apiKeyEnv);

  if (!semanticProvider && shouldUseResidentMemory(rootDir, config)) {
    let residentReport: Awaited<ReturnType<typeof ingestProject>> | null = null;
    try {
      residentReport = await residentMemoryRequest(rootDir, config, "ingest", {
        cwd,
        maxFiles,
        ignore: preset.ignore,
      }) as Awaited<ReturnType<typeof ingestProject>>;
    } catch {
      // Fail open: keep the legacy embedded ingest path available if the
      // resident cannot come up in this environment.
    }
    if (residentReport) {
      console.log(
        renderIngestReportToon(residentReport, {
          includeSemanticCost: false,
        }),
      );
      console.log(ingestGuidance(await currentGitCommit(rootDir)));
      return;
    }
  }

  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const report = await ingestProject(store, {
      cwd,
      maxFiles,
      ignore: preset.ignore,
      semantic: {
        enabled: Boolean(semanticProvider),
        client: semanticProvider && config.provider ? redDbProviderClient(store, config.provider) : undefined,
      },
    });
    console.log(
      renderIngestReportToon(report, {
        includeSemanticCost: Boolean(semanticProvider),
      }),
    );
    // Audit-marker contract (.red/agents/memory.md): commit-trailer surface.
    // Emit guidance for the commit that lands this ingest rather than writing
    // an on-disk log. Best-effort — never let HEAD lookup abort the ingest.
    console.log(ingestGuidance(await currentGitCommit(rootDir)));
  } finally {
    await store.close();
  }
}


/**
 * PR-level CI drift guard (ADR 0027 Gap 3, issue #224). Reuses the pure
 * {@link evaluateDriftGuard} decision core over inputs collected from git / the
 * workflow. On failure it prints the documented actionable line, best-effort
 * appends a `memory.drift.caught` event to the Memory event log (ADR 0025), and
 * sets a non-zero exit code. Code-only PRs (no watched path changed) pass
 * silently with no telemetry event.
 */
export async function runDriftGuard(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);

  const changedFiles = await driftGuardChangedFiles(rootDir, args);
  const headCommitMessage = await driftGuardHeadMessage(rootDir, args);
  const auditLogLines = await driftGuardAuditLog(rootDir);

  const verdict = evaluateDriftGuard({ changedFiles, headCommitMessage, auditLogLines });

  if (args.flags.json === true) {
    console.log(JSON.stringify(verdict, null, 2));
  }

  if (verdict.status === "pass") {
    if (args.flags.json !== true) {
      if (verdict.reason === "no-watched-paths") {
        console.log("memory drift-guard: no watched paths changed — pass");
      } else {
        console.log(
          `memory drift-guard: audit marker present (${verdict.marker.form}) — pass`,
        );
      }
    }
    return;
  }

  // Failure: emit the actionable line, record the telemetry event, exit non-zero.
  console.error(verdict.actionableLine);

  const event = driftCaughtToMemoryEvent({
    changedPaths: verdict.watchedChanged,
    reason: verdict.actionableLine,
    prNumber: typeof args.flags["pr-number"] === "string" ? args.flags["pr-number"] : undefined,
    headSha: typeof args.flags["head-sha"] === "string" ? args.flags["head-sha"] : undefined,
    baseRef: typeof args.flags["base-ref"] === "string" ? args.flags["base-ref"] : undefined,
  });
  // The envelope is always emitted so CI logs carry the ADR 0025 event even when
  // no local graph store exists (the Action runs against a fresh checkout).
  console.log(JSON.stringify(event));
  // Best-effort append to the local event log when graph mode is initialized —
  // never let a telemetry write turn a guard failure into a crash (issue #181).
  await driftGuardRecordEvent(rootDir, event);

  process.exitCode = 1;
}


/** Resolve the PR's changed files: an explicit `--changed-files <path>` list, or a `git diff` against `--base`. */
export async function driftGuardChangedFiles(rootDir: string, args: ParsedArgs): Promise<string[]> {
  const listPath = args.flags["changed-files"];
  if (typeof listPath === "string") {
    const resolved = isAbsolute(listPath) ? listPath : resolve(rootDir, listPath);
    const body = await readFile(resolved, "utf8");
    return body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  }
  const base = args.flags.base;
  if (typeof base === "string") {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", `${base}...HEAD`], {
      cwd: rootDir,
      encoding: "utf8",
    });
    return stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  }
  throw new Error(
    "drift-guard needs the PR's changed files — pass --changed-files <path> or --base <ref>",
  );
}


/** Resolve the head commit message: an explicit `--head-message <path>`, or `git log -1` at HEAD. */
export async function driftGuardHeadMessage(rootDir: string, args: ParsedArgs): Promise<string | undefined> {
  const msgPath = args.flags["head-message"];
  if (typeof msgPath === "string") {
    const resolved = isAbsolute(msgPath) ? msgPath : resolve(rootDir, msgPath);
    return readFile(resolved, "utf8");
  }
  try {
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%B"], {
      cwd: rootDir,
      encoding: "utf8",
    });
    return stdout;
  } catch {
    return undefined;
  }
}


/** Read `.red/memory/.audit.log` lines if the project maintains that surface; absent is fine. */
export async function driftGuardAuditLog(rootDir: string): Promise<string[] | undefined> {
  try {
    const body = await readFile(join(rootDir, ".red/memory/.audit.log"), "utf8");
    return body.split(/\r?\n/);
  } catch {
    return undefined;
  }
}


/** Best-effort append of the drift event to the local Memory event log. Swallows all failure. */
export async function driftGuardRecordEvent(
  rootDir: string,
  event: ReturnType<typeof driftCaughtToMemoryEvent>,
): Promise<void> {
  try {
    const config = await readConfig(rootDir);
    if (!config || config.mode !== "graph") return;
    const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
    try {
      await appendMemoryEvent(store, event);
    } finally {
      await store.close();
    }
  } catch {
    // Telemetry is best-effort — a missing/locked store must not change the verdict.
  }
}


export async function runBootstrap(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `bootstrap needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }

  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const report = await bootstrapProjectMemory(store, {
      rootDir,
      dryRun: args.flags["dry-run"] === true,
      maxFiles: intFlag(args.flags, "max-files"),
      includeGitLog: args.flags["include-git-log"] === true,
    });
    if (args.flags.json === true) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const mode = report.dry_run ? "planned" : "indexed";
    console.log(
      `memory bootstrap: ${mode} ${report.summary.indexed_sources}/${report.summary.discovered_sources} source(s)`,
    );
    console.log(
      `  ${report.summary.nodes} node(s), ${report.summary.edges} edge(s), ${report.summary.docs} doc(s)`,
    );
    for (const source of report.sources.slice(0, 20)) {
      const status = source.indexed ? "indexed" : "skipped";
      const reason = source.reason ? ` (${source.reason})` : "";
      console.log(`  ${status}: ${source.kind} ${source.path}${reason}`);
    }
    for (const action of report.recommended_next_actions) {
      console.log(`  next: ${action}`);
    }
  } finally {
    await store.close();
  }
}


export async function runRefresh(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);
  if (config.mode !== "graph") {
    throw new Error(
      `refresh needs graph mode — this project is "${config.mode}". Re-run \`memory init --mode graph\` first`,
    );
  }

  const paths = await refreshPaths(rootDir, args);
  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  let report;
  try {
    report = await refreshFiles(store, paths, { rootDir });
  } finally {
    await store.close();
  }

  if (args.flags.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`memory: refreshed ${report.files} changed file(s)`);
  console.log(
    `  ${report.added} added, ${report.updated} updated, ${report.skipped} skipped, ${report.stale} stale graph element(s) in ${report.durationMs}ms`,
  );
}


export async function refreshPaths(rootDir: string, args: ParsedArgs): Promise<string[]> {
  const paths = [...args.positional];
  const hasRefreshSource =
    paths.length > 0 ||
    args.flags.stdin === true ||
    args.flags.staged === true ||
    args.flags.changed === true;
  if (args.flags.stdin === true) {
    paths.push(...splitPathList(await readStdin()));
  }
  if (args.flags.staged === true) {
    paths.push(...(await gitDiffPaths(rootDir, "staged")));
  }
  if (args.flags.changed === true) {
    paths.push(...(await gitDiffPaths(rootDir, "changed")));
  }
  if (!hasRefreshSource) {
    throw new Error(
      "refresh needs changed files — pass paths, --stdin, --staged, or --changed",
    );
  }
  return [...new Set(paths)];
}


export function splitPathList(input: string): string[] {
  return input
    .split(/\0|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}


export async function gitDiffPaths(rootDir: string, mode: "changed" | "staged"): Promise<string[]> {
  const diffArgs = [
    "-C",
    rootDir,
    "diff",
    "--name-only",
    "--diff-filter=ACMRTUXBD",
    ...(mode === "staged" ? ["--cached"] : ["HEAD"]),
  ];
  const { stdout } = await execFileAsync("git", diffArgs, { encoding: "utf8" });
  return splitPathList(stdout);
}


export async function runSkillEvent(args: ParsedArgs): Promise<void> {
  const kind = args.positional[0];
  if (kind !== "skill") {
    throw new Error("event needs a kind — supported: memory event skill");
  }

  const rootDir = rootOf(args.flags);
  const config = await readConfig(rootDir);
  if (!config) {
    console.log("memory: skill event ignored — memory is not initialized here");
    return;
  }
  if (config.mode !== "graph") {
    console.log(
      `memory: skill event ignored — needs graph mode, this project is "${config.mode}"`,
    );
    return;
  }
  if (!skillTelemetryEnabled(config)) {
    console.log(
      "memory: skill event ignored — skill telemetry is not enabled, re-run `memory init --mode graph --skill-telemetry`",
    );
    return;
  }

  const raw = await readStdin();
  const events = raw.trim()
    ? parseSkillEventInput(raw)
    : [parseSkillEvent(skillEventFromFlags(args.flags))];

  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const report = await ingestSkillEvents(store, events);
    console.log(`memory: ingested ${report.events} ${plural(report.events, "skill event")}`);
  } finally {
    await store.close();
  }
}


/**
 * memory curate skills — the report-only Skill curator surface. It reads
 * Memory-owned Skill telemetry rollups and prints evidence-based curation
 * recommendations. It NEVER mutates a skill file, the graph, or anything else:
 * it only reads rollups and runs the pure {@link curateSkills} over them. Heavy
 * / model-based review is intentionally absent — this is deterministic and runs
 * only when explicitly invoked.
 */
export async function readSkillCuratorReport(
  rootDir: string,
  staleDays?: number,
): Promise<CuratorReportEnvelope> {
  const config = await readConfig(rootDir);
  if (!config) {
    throw new Error("memory is not initialized here");
  }
  if (config.mode !== "graph") {
    throw new Error(`needs graph mode, this project is "${config.mode}"`);
  }
  if (!skillTelemetryEnabled(config)) {
    throw new Error("skill telemetry is not enabled");
  }

  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const rollups = await readSkillRollups(store);
    return curateSkills(rollupsToCuratorInput(rollups), { staleDays });
  } finally {
    await store.close();
  }
}


export async function runCurate(args: ParsedArgs): Promise<void> {
  const kind = args.positional[0];
  if (kind !== "skills") {
    process.exitCode = await runCurateWorkflow(
      {
        command: kind,
        positional: args.positional.slice(1),
        flags: args.flags,
      },
      {
        usageCommand: "memory curate",
        loadCuratorReport: readSkillCuratorReport,
      },
    );
    return;
  }

  const rootDir = rootOf(args.flags);
  const config = await readConfig(rootDir);
  if (!config) {
    console.log("memory: curate ignored — memory is not initialized here");
    return;
  }
  if (config.mode !== "graph") {
    console.log(`memory: curate ignored — needs graph mode, this project is "${config.mode}"`);
    return;
  }
  if (!skillTelemetryEnabled(config)) {
    console.log(
      "memory: curate ignored — skill telemetry is not enabled, re-run `memory init --mode graph --skill-telemetry`",
    );
    return;
  }

  const report = await readSkillCuratorReport(rootDir, intFlag(args.flags, "stale-days"));

  if (args.flags.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    `memory: skill curator (report-only) — ${report.totalSkills} skill(s), ` +
      `${report.curatableSkills} curatable, ${report.readOnlySkills} read-only`,
  );
  if (report.recommendations.length === 0) {
    console.log("  no curation recommendations — evidence supports no action");
    return;
  }
  console.log(
    `  ${report.recommendations.length} recommendation(s) (stale threshold ${report.staleDays}d):`,
  );
  for (const rec of report.recommendations) {
    const tag = rec.curatable ? "curatable" : "read-only";
    console.log(`  [${rec.category}] ${rec.name} (${tag}) — ${rec.reason}`);
  }
  console.log("\nReport-only: no skill files were read, patched, archived, or deleted.");
}


/**
 * memory improve skills — proposal-gated self-improvement surface.
 *
 * This is the first non-read-only step in the Skill self-improvement loop. It
 * still NEVER edits a skill directly. It reads Skill telemetry, turns supported
 * recommendations into concrete Markdown proposals, and writes those proposals
 * only when explicitly asked with --write-proposal. Applying a proposal remains a
 * separate human-reviewed action.
 */
export async function runImprove(args: ParsedArgs): Promise<void> {
  const kind = args.positional[0];
  if (kind === "apply") return runImproveApply(args);
  if (kind === "proposals") return runImproveProposals(args);
  if (kind !== "skills") {
    throw new Error("improve needs a kind — supported: memory improve skills|proposals|apply");
  }

  const rootDir = rootOf(args.flags);
  const json = args.flags.json === true;
  const writeProposal = args.flags["write-proposal"] === true;
  const config = await readConfig(rootDir);
  if (!config) {
    return reportImproveState(json, "uninitialized", "memory is not initialized here", []);
  }
  if (config.mode !== "graph") {
    return reportImproveState(json, "no-op", `needs graph mode, this project is "${config.mode}"`, []);
  }
  if (!skillTelemetryEnabled(config)) {
    return reportImproveState(
      json,
      "unavailable",
      "skill telemetry is not enabled, re-run `memory init --mode graph --skill-telemetry`",
      [],
    );
  }

  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  let report;
  let recent: SkillEventSummary[];
  let rollups: SkillRollup[];
  try {
    rollups = await readSkillRollups(store);
    recent = await readRecentSkillEvents(store, 50);
    report = curateSkills(rollupsToCuratorInput(rollups), {
      staleDays: intFlag(args.flags, "stale-days"),
    });
  } finally {
    await store.close();
  }

  const { proposals, evidenceCards } = await buildSkillImprovementProposals(
    rootDir,
    report.recommendations,
    rollups,
    recent,
    writeProposal,
  );
  const state = proposals.length === 0 ? "no-candidates" : writeProposal ? "proposal-written" : "proposal-ready";

  if (json) {
    console.log(JSON.stringify({ state, proposals, evidenceCards }, null, 2));
    return;
  }

  console.log(`memory: skill improvement — ${state}`);
  if (proposals.length === 0) {
    console.log("  no proposal candidates found from current telemetry evidence");
    return;
  }
  for (const proposal of proposals) {
    console.log(`  ${proposal.skill}: ${proposal.category} — ${proposal.reason}`);
    if (proposal.path) console.log(`    proposal: ${proposal.path}`);
  }
  if (evidenceCards.length > 0) {
    console.log("\n  evidence cards:");
    for (const card of evidenceCards) console.log(`    ${card.skill}: ${card.path}`);
  }
  console.log("\nProposal-gated: skill files were not patched. Review and apply manually.");
}
