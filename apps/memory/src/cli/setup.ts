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
import { runConflicts, runSupersede, runResolveConflict, runTimeline, runCommunities, renderCommunitiesToon, runCommunitiesViewer, runCommunityDigest, runHubReport, runSuggestedQuestions, parseHubRankBy, renderHubReportToon, renderSuggestedQuestionsToon, parseRid, printConflicts, printTimeline, printTimelineToon, runStructuralImpact, runPrePrReview, runPrePrReviewViewer, runStructuralImpactViewer, printStructuralImpact, readChangedFiles, parseChangedFiles, printPrePrReview, printPrePrSection, printReadinessEnvelope } from "./analytics.js";
import type { TimelineToonEntry } from "./analytics.js";
import { runStats, runVector, runDoctor, runExport, runGlobalSearch, resolveOverviewContract, runArchitectureOverview, readStdin, HOOK_EVENTS, runHook, VCS_EVENTS, runVcs, runVcsRefresh, resolveHooksDir, resolveBootstrapPath, runVcsInstallHooks, runVcsUninstallHooks, runAttempt, runAttemptLearn, runAttemptLearnApply, runImport, parseComplementaryMapKind, runPromoteCmd, runAfkFinalize } from "./system.js";



export const USAGE = `memory — governed operational memory for code agents

Common workflows:
  remember one fact          memory store "Decision: ..."
  get context before acting  memory recall "topic"
  map code before reading    memory map-context "who calls token refresh?"
  prepare another agent      memory capsule "goal"       | memory context-pack "goal"
  decide if safe to proceed  memory readiness "goal"     | memory claim-check "assertion"
  search every surface       memory smart-search "query"
  operate/debug Memory       memory workbench             | memory health-viewer | memory governance

Rule of thumb: recall is the canonical governed context path; readiness is the
go/no-go envelope; context-pack and handoff are continuation surfaces; smart
search, docs, vectors, Workbench, MCP, and HTTP are diagnostics/integration views
over the same evidence store.

Usage:
  memory init [--mode markdown-only|graph] [--hooks] [--skill-telemetry] [--event-retention-days N] [--root <dir>] [--yes]
  memory store <fact...>            [--root <dir>] [--scope project|repo|branch|worktree|session|agent-run|user] [--scope-id ID]
  memory store-evidence             [--root <dir>] --claim <text> --source-ref <ref> --citation-excerpt <text> --intent <text> --observer <id> [--blast-radius low|medium|high] [--route <target>] [--confidence EXTRACTED|INFERRED|AMBIGUOUS] [--json]
  memory inbox quarantine <fact...> [--root <dir>] --reason <text> --evidence <summary> [--confidence EXTRACTED|INFERRED|AMBIGUOUS] [--source-kind manual|hook|derived|system] [--writer <name>] [--command <cmd>] [--hook <event>] [--json]
  memory inbox list                 [--root <dir>] [--status quarantined|approved|rejected|promoted|all] [--json]
  memory inbox inspect <id>         [--root <dir>] [--json]
  memory inbox approve <id>         [--root <dir>] --yes [--json]
  memory inbox reject <id>          [--root <dir>] --reason <text> --yes [--json]
  memory inbox promote <id>         [--root <dir>] --yes [--json]
  memory evidence create            [--root <dir>] --summary <text> --source-ref <ref> --citation <label|uri|quote> --lesson <text> [--source-kind <kind>] [--route <target>] [--confidence EXTRACTED|INFERRED|AMBIGUOUS] [--json]
  memory evidence list              [--root <dir>] [--status pending|approved|rejected|all] [--json]
  memory evidence show <id>         [--root <dir>] [--json]
  memory evidence approve <id>      [--root <dir>] --yes [--reviewer <id>] [--json]
  memory evidence reject <id>       [--root <dir>] --reason <text> --yes [--reviewer <id>] [--json]
  memory classify <candidate...>    [--root <dir>] [--json]
  memory recall <query...>          [--root <dir>] [--limit N] [--include-superseded] [--scope ...] [--scope-id ID] [--include-narrower-scopes] [--as-of <reddb-ref>] [--layer L1|L2|L3]
  memory federate                   [--root <dir>] --query "<topic>" [--limit N] [--per-root-limit N] [--json]
  memory whatif                     [--root <dir>] --change "<descriptor>" [--change "<descriptor>" ...] [--limit N] [--json]
  memory autocure                   [--root <dir>] [--apply] [--stale-days N] [--json]
  memory smart-search <query...>    [--root <dir>] [--limit N] [--depth N] [--json]
  memory capsule <goal...>          [--root <dir>] [--source context-pack|handoff] [--budget N] [--limit N] [--json] [--scope ...] [--scope-id ID] [--include-narrower-scopes]
  memory smart-search-viewer <query...> [--root <dir>] [--limit N] [--depth N] [--out <file>]
  memory context-pack <goal...>     [--root <dir>] [--budget N] [--limit N] [--json] [--scope ...] [--scope-id ID] [--include-narrower-scopes]
  memory context-pack-viewer <goal...> [--root <dir>] [--budget N] [--limit N] [--depth N] [--out <file>] [--scope ...] [--scope-id ID] [--include-narrower-scopes]
  memory recommend skills <task...> [--root <dir>] [--limit N] [--json] [--scope ...] [--scope-id ID] [--include-narrower-scopes]
  memory claim-check <assertion...> [--root <dir>] [--json]
  memory preflight <task...>        [--root <dir>] [--limit N] [--min-evidence N] [--stale-days N] [--json] [--scope ...] [--scope-id ID] [--include-narrower-scopes]
  memory readiness <goal...>        [--root <dir>] [--limit N] [--min-evidence N] [--stale-days N] [--json] [--scope ...] [--scope-id ID] [--include-narrower-scopes]
  memory readiness-viewer <goal...> [--root <dir>] [--out <file>] [--limit N] [--min-evidence N] [--stale-days N] [--scope ...] [--scope-id ID] [--include-narrower-scopes]
  memory capabilities              [--root <dir>] [--json]
  memory assets [query...]          [--root <dir>] [--kind <kind>] [--json]
  memory assets-viewer [query...]   [--root <dir>] [--kind <kind>] [--out <file>]
  memory references-radar          [--root <dir>] [--json]
  memory layers                    [--root <dir>] [--json]
  memory layers-viewer             [--root <dir>] [--out <file>]
  memory handoff [focus...]         [--root <dir>] [--limit N] [--json]
  memory handoff-viewer [focus...]  [--root <dir>] [--limit N] [--out <file>]
  memory frontier [focus...]        [--root <dir>] [--limit N] [--json]
  memory frontier-viewer [focus...] [--root <dir>] [--limit N] [--out <file>]
  memory dashboard                 [--root <dir>] [--out <file>] [--stale-days N] [--json]
  memory workbench                 [--root <dir>] [--out <file>] [--session <id>] [--limit N] [--json]
  memory session timeline           [--root <dir>] [--session <id>] [--limit N] [--json]
  memory session timeline-viewer    [--root <dir>] [--session <id>] [--limit N] [--out <file>]
  memory session show               [--root <dir>] [--json]   (prints the current session id, or "none")
  memory session start              [--root <dir>] [--id <id>] [--json]   (mints + writes a fresh id)
  memory session end                [--root <dir>] [--json]   (drops .red/memory/sessions/current)
  memory working append             [--root <dir>] --type <event-type> --value <text> [--json]
  memory working get                [--root <dir>] [--type <event-type>] [--json]
  memory working raw                [--root <dir>] [--set <text>] [--json]
  memory working evict              [--root <dir>] [--ttl-ms N] [--byte-budget N] [--json]
  memory learning-debt              [--root <dir>] [--stale-days N] [--json]
  memory learning-debt-viewer       [--root <dir>] [--stale-days N] [--out <file>]
  memory decay                      [--root <dir>] [--stale-days N] [--deprecate-days N] [--limit N] [--json]
  memory decay-viewer               [--root <dir>] [--stale-days N] [--deprecate-days N] [--limit N] [--out <file>]
  memory merge-pass                 [--root <dir>] [--min-score N] [--limit N] [--json]
  memory merge-pass execute         --candidate-ranks 1,2 --approver <id> --yes [--root <dir>] [--min-score N] [--limit N] [--batch-id ID] [--json]
  memory merge-pass unmerge         --batch-id ID --yes [--root <dir>] [--json]
  memory tidy-review refresh        [--root <dir>] [--json]
  memory tidy-review accept <id>    --approver <id> --yes [--root <dir>] [--reason <text>] [--json]
  memory tidy-review dismiss <id>   --approver <id> --yes [--root <dir>] [--reason <text>] [--json]
  memory health-viewer              [--root <dir>] [--stale-days N] [--out <file>]
  memory map freshness              [--root <dir>] [--json]   (map freshness and extraction diagnostic, read-only)
  memory onboarding-map             [--root <dir>] [--stale-days N] [--json]
  memory onboarding-map-viewer      [--root <dir>] [--stale-days N] [--out <file>]
  memory onboarding-map export <out-dir> --public-safe [--strict] [--root <dir>] [--json]
  memory routing-guide              [--agent codex|claude|cursor|gemini|aider|opencode|generic] [--json]
  memory routing-guide-viewer       [--agent codex|claude|cursor|gemini|aider|opencode|generic] [--out <file>]
  memory integration-status         [--root <dir>] [--agent codex|claude|cursor|gemini|aider|opencode|generic] [--json]
  memory integration-status-viewer  [--root <dir>] [--agent codex|claude|cursor|gemini|aider|opencode|generic] [--out <file>]
  memory ask <question...>          [--root <dir>] [--json]
  memory docs search <query...>     [--root <dir>] [--limit N] [--json]
  memory docs search-viewer <query...> [--root <dir>] [--limit N] [--out <file>]
  memory docs brief <query...>      [--root <dir>] [--limit N] [--max-bytes N] [--json]
  memory docs brief-viewer <query...> [--root <dir>] [--limit N] [--max-bytes N] [--out <file>]
  memory docs bundle <query...>     [--root <dir>] [--limit N] [--max-bytes N] [--json]
  memory docs bundle-viewer <query...> [--root <dir>] [--limit N] [--max-bytes N] [--out <file>]
  memory docs read <path|rid>       [--root <dir>] [--max-bytes N] [--json]
  memory docs evidence-pack <path|rid> [--root <dir>] [--max-bytes N] [--json]
  memory docs evidence-pack-viewer <path|rid> [--root <dir>] [--max-bytes N] [--out <file>]
  memory docs backlinks <label|rid> [--root <dir>] [--json]
  memory docs backlinks-viewer <label|rid> [--root <dir>] [--out <file>]
  memory docs related <path|rid>    [--root <dir>] [--json]
  memory docs related-viewer <path|rid> [--root <dir>] [--out <file>]
  memory docs restore [path|rid]    [--root <dir>] [--out <dir>|--in-place] [--overwrite] [--dry-run] [--yes] [--json]
  memory docs coverage              [--root <dir>] [--json]
  memory docs coverage-viewer       [--root <dir>] [--out <file>]
  memory docs reference-graph       [--root <dir>] [--json]
  memory docs reference-graph-viewer [--root <dir>] [--out <file>]
  memory bootstrap                  [--root <dir>] [--dry-run] [--max-files N] [--include-git-log] [--json]
  memory backup create              [--root <dir>] [--name <name>] [--json]
  memory backup list                [--root <dir>] [--json]
  memory backup inspect <name>      [--root <dir>] [--json]
  memory backup restore <name>      [--root <dir>] --yes [--json]
  memory serve                      [--root <dir>] [--host 127.0.0.1] [--port 49375] [--token-env ENV]
  memory provenance <rid|label>     [--root <dir>] [--json]
  memory governance                 [--root <dir>] [--stale-progress-days N] [--json]
  memory governance-viewer          [--root <dir>] [--stale-progress-days N] [--out <file>]
  memory ingest <path>              [--root <dir>] [--max-files N] [--structural-only]
  memory refresh [<path...>]         [--root <dir>] [--stdin] [--changed|--staged] [--json]
  memory extract [<transcript-file>] [--root <dir>] [--local]   (reads stdin if no file)
  memory extraction status           [--root <dir>] [--json]
  memory extraction status-viewer    [--root <dir>] [--out <file>]
  memory code-drift                  [--root <dir>] [--recurring-threshold N] [--json]   (read-only)
  memory code-curate list|promote|alias [args] [--root <dir>] [--json]
  memory event skill                [--root <dir>] [--event-type ...] ... (or JSON/JSONL on stdin)
  memory curate skills              [--root <dir>] [--stale-days N] [--json]   (report-only)
  memory curate check|list|background|archive|restore [--root <dir>]   (/curate workflow)
  memory improve skills             [--root <dir>] [--write-proposal] [--json]   (proposal-gated)
  memory improve proposals list      [--root <dir>] [--json]
  memory improve proposals show <proposal> [--root <dir>] [--json]
  memory improve proposals archive <proposal> --reason applied|rejected|stale --yes [--root <dir>] [--json]
  memory improve apply <proposal>    [--root <dir>] --yes [--json]   (explicit patch apply)
  memory health                    [--root <dir>] [--json]   (operational healthcheck, read-only)
  memory recall-telemetry          [--root <dir>] [--window-ms N] [--json]   (real-run recall metrics, read-only; distinct from bench)
  memory hooks coverage            [--root <dir>] [--json]   (hook manifest/config coverage, read-only)
  memory hooks coverage-viewer     [--root <dir>] [--out <file>]
  memory lint                      [--root <dir>] [--json]   (policy hygiene report, read-only)
  memory privacy scan              [--root <dir>] [--json]   (sensitive data report, read-only)
  memory privacy export [<out-dir>] [--root <dir>] [--communities] [--json]   (redacted graph export)
  memory status skills              [--root <dir>] [--all] [--limit N] [--json]   (diagnostic, read-only)
  memory status context             [--root <dir>] [--json]   (context stack healthcheck, read-only)
  memory attempt record             [--root <dir>]             (reads AFK attempt JSON from stdin)
  memory attempt learn              [--root <dir>] [--write-proposal] [--json]   (proposal-gated)
  memory attempt learn apply <proposal> [--root <dir>] --yes [--json]
  memory commit                    [--root <dir>] [--message <text>] [--author <name>] [--email <addr>] [--json]

  Graph-mode read verbs (require \`memory init --mode graph\`):
  memory search <query...>          [--root <dir>] [--limit N]
  memory map-context <query...>     [--root <dir>] [--depth N] [--mode bfs|dfs] [--context call,import,type,validation,decision,work,reference] [--budget N] [--json]
  memory neighbors <label>          [--root <dir>] [--depth N] [--direction outgoing|incoming|both]
  memory traverse <label>           [--root <dir>] [--depth N] [--strategy bfs|dfs] [--direction ...]
  memory path <from> <to>           [--root <dir>] [--algorithm bfs|dijkstra]
  memory path-explain <from> <to>   [--root <dir>] [--max-depth N] [--json]
  memory path-explain-viewer <from> <to> [--root <dir>] [--max-depth N] [--out <file>]
  memory confidence --node <rid>    [--root <dir>] [--json]
  memory conflicts                  [--root <dir>] [--include-resolved] [--json]
  memory supersede <old-rid> <new-rid> [--root <dir>] [--reason <text>]
  memory resolve-conflict <active-rid> <superseded-rid> [--root <dir>] [--reason <text>]
  memory timeline <topic|rid>       [--root <dir>] [--include-audit] [--json]
  memory communities                [--root <dir>] [--no-cache] [--json]
  memory communities-viewer         [--root <dir>] [--no-cache] [--out <file>]
  memory community-digest           [--root <dir>] [--no-cache] [--json]
  memory suggested-questions        [--root <dir>] [--limit N] [--json]
  memory global-search <query...>   [--root <dir>] [--limit N] [--no-cache] [--json]
  memory structural-impact          [--root <dir>] [--file <path>] [--symbol <name>]
  memory structural-impact-viewer   [--root <dir>] [--file <path>] [--symbol <name>] [--out <file>]
  memory pre-pr-review              [--root <dir>] [--range <git-range>] [--json]
  memory pre-pr-review-viewer       [--root <dir>] [--range <git-range>] [--out <file>]
  memory vector status              [--root <dir>] [--local] [--json]
  memory vector status-viewer       [--root <dir>] [--local] [--out <file>]
  memory vector maintain            [--root <dir>] [--local] [--strict] [--json]
  memory vector search <query...>   [--root <dir>] [--local] [--limit N] [--json]
  memory stats                      [--root <dir>]
  memory doctor                     [--root <dir>] [--stale-days N] [--prune] [--yes]
  memory export [<out-dir>]         [--root <dir>] [--communities] [--interop]
  memory graph  [<out-dir>]         [--root <dir>] [--communities]   (alias of export)
  memory map-contract               [--root <dir>] [--communities] [--json]
  memory architecture-overview      [--root <dir>] [--from <graph.json>] [--out <file>] [--stdout] [--json]

  Auto-firing hooks (invoked by the plugin manifest, reads payload on stdin):
  memory hook <event> --runner <claude|codex>   [--root <dir>]

  Git auto-update hooks (#236) — keep the graph fresh on commit/checkout:
  memory vcs install-hooks          [--root <dir>] [--force] [--json]
  memory vcs uninstall-hooks        [--root <dir>] [--json]
  memory vcs refresh --event post-commit|post-checkout   [--prev <sha> --new <sha> --flag <0|1>] [--no-export] [--root <dir>] [--json]

  Promotion (PRD #174, issue #183) — run the PromotionEngine for the current
  session, promoting typed L2 candidates and bumping reinforcement on dedup
  hits. Emits one promote event per decision.
  memory promote [--triggered-by explicit|hook|overflow] [--session <id>] [--json] [--root <dir>]

  AFK lifecycle (PRD #174, issue #187) — end-of-worktree sequence the AFK
  worker invokes after its iteration closes: promote-all typed L2 candidates
  into L3, archive the raw transcript as a durable L3 \`transcript\` node
  tagged with the worktree id, then drop the session's L2 nodes. Idempotent.
  memory afk-finalize --worktree <id>  [--session <id>] [--json] [--root <dir>]

  AMS migration (PRD #174, issue #184) — one-shot offline importer for Redis
  agent-memory-server JSON dumps. See \`docs/migrating-from-ams.md\`.
  memory import ams <dump.json>     [--root <dir>] [--json]
  memory import map <artifact.json> [--kind graphify|scip|lsp|static-analysis] [--root <dir>] [--json]

  Benchmarks and reference eval live in the embedded app \`benchmark-memory\`.

Two storage modes: markdown-only (plain notes, no engine) and graph (a typed
knowledge graph over a per-project RedDB store). Run \`memory init\` once to pick
one, then use /memory:store and /memory:recall (or the CLI verbs) — they route
to whichever mode init configured.`;


export type ParsedArgs = LooseParsedArgs;


export const execFileAsync = promisify(execFile);

export const LEGACY_CLI_OPERATION_IDS = new Set(["memory.health"]);

export const LEGACY_SUBCOMMANDS_BY_REGISTRY_COMMAND: Readonly<Record<string, readonly string[]>> = {
  "merge-pass": ["execute", "unmerge"],
  "onboarding-map": ["export"],
  "tidy-review": ["refresh", "accept", "dismiss"],
};

export const PROOF_REGISTRY_CLI_COMMANDS = new Set(["docs brief", "docs brief-viewer"]);

export const REGISTRY_CLI_OPERATIONS = new Map<string, ReadOnlyMemoryOperation>(
  listReadOnlyMemoryOperations()
    .filter((operation) => !LEGACY_CLI_OPERATION_IDS.has(operation.id))
    .map((operation) => [operation.renderer.cli.command, operation]),
);


export function rootOf(flags: Record<string, string | boolean>): string {
  return typeof flags.root === "string" ? flags.root : process.cwd();
}


export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}


export const MEMORY_SCOPES: readonly MemoryScope[] = [
  "user",
  "project",
  "repo",
  "branch",
  "worktree",
  "session",
  "agent-run",
];


export function parseMemoryScope(value: string | boolean | undefined): MemoryScope | undefined {
  if (value == null || value === false) return undefined;
  if (value === true) throw new Error("--scope requires a value");
  if ((MEMORY_SCOPES as readonly string[]).includes(value)) return value as MemoryScope;
  throw new Error(`invalid memory scope "${value}"`);
}


export const MEMORY_LAYERS: readonly MemoryLayer[] = ["L1", "L2", "L3"];


export function parseLayerFlag(value: string | boolean | undefined): MemoryLayer | undefined {
  if (value == null || value === false) return undefined;
  if (value === true) throw new Error("--layer requires a value (L1|L2|L3)");
  const upper = value.toUpperCase();
  if ((MEMORY_LAYERS as readonly string[]).includes(upper)) return upper as MemoryLayer;
  throw new Error(`invalid memory layer "${value}" — expected L1, L2, or L3`);
}


export const CONFIDENCE_VALUES: readonly Confidence[] = ["EXTRACTED", "INFERRED", "AMBIGUOUS"];


export function parseConfidence(value: string | boolean | undefined): Confidence | undefined {
  if (value == null || value === false) return undefined;
  if (value === true) throw new Error("--confidence requires a value");
  if ((CONFIDENCE_VALUES as readonly string[]).includes(value)) return value as Confidence;
  throw new Error(`invalid confidence "${value}"`);
}


export const SOURCE_KINDS: readonly MemoryProvenance["source_kind"][] = [
  "manual",
  "hook",
  "derived",
  "system",
  "external-map",
];


export function parseSourceKind(
  value: string | boolean | undefined,
): MemoryProvenance["source_kind"] | undefined {
  if (value == null || value === false) return undefined;
  if (value === true) throw new Error("--source-kind requires a value");
  if ((SOURCE_KINDS as readonly string[]).includes(value)) {
    return value as MemoryProvenance["source_kind"];
  }
  throw new Error(`invalid source kind "${value}"`);
}


export function scopeFlags(flags: Record<string, string | boolean>) {
  const level = parseMemoryScope(flags.scope);
  if (!level) return undefined;
  return {
    level,
    id: typeof flags["scope-id"] === "string" ? flags["scope-id"] : undefined,
    includeNarrower: flags["include-narrower-scopes"] === true,
  };
}


export async function requireConfig(rootDir: string) {
  const config = await readConfig(rootDir);
  if (!config) {
    throw new Error("memory is not initialized here — run `memory init` first");
  }
  return config;
}


export async function runInit(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  let mode = typeof args.flags.mode === "string" ? args.flags.mode : undefined;

  // Interactive wizard only when no mode was given and we have a TTY.
  if (!mode && args.flags.yes !== true && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (
      await rl.question(
        "What do you want to use? [markdown-only] / graph: ",
      )
    ).trim();
    rl.close();
    mode = answer || "markdown-only";
  }
  mode = mode ?? "markdown-only";
  const skillTelemetry = args.flags["skill-telemetry"] === true;
  const eventRetentionDays = intFlag(args.flags, "event-retention-days");
  if (eventRetentionDays != null && (!Number.isFinite(eventRetentionDays) || eventRetentionDays < 0)) {
    throw new Error("--event-retention-days must be a non-negative number");
  }

  if (mode === "markdown-only") {
    const result = await initMarkdownOnly(rootDir);
    console.log(`memory: initialized markdown-only mode`);
    console.log(`  config: ${result.configPath}`);
    console.log(`  notes:  ${result.notesDir}`);
    console.log(`  hooks:  off    mcp: off    reddb: not required`);
    if (skillTelemetry) {
      console.log(
        `  note:   skill telemetry is unsupported in markdown-only mode — re-run \`memory init --mode graph --skill-telemetry\` to enable it`,
      );
    }
    return;
  }

  if (mode === "graph") {
    // Hooks are opt-in: `--hooks` (or `--hooks all`) turns all four on; absent
    // leaves them off. markdown-only never gets hooks regardless.
    const hooks = args.flags.hooks === true || args.flags.hooks === "all";
    // Skill telemetry is a separate explicit opt-in, graph-mode only.
    const result = await initGraph(rootDir, { hooks, skillTelemetry, eventRetentionDays });
    const on = Object.values(result.config.hooks).some(Boolean);
    console.log(`memory: initialized graph mode`);
    console.log(`  config: ${result.configPath}`);
    console.log(`  store:  ${result.storeUri}`);
    console.log(`  hooks:  ${on ? "on" : "off"}    mcp: off    reddb: required`);
    console.log(`  skill telemetry: ${result.config.skillTelemetry ? "on" : "off"}`);
    console.log(
      `  event retention: ${result.config.eventLog?.retentionDays ?? DEFAULT_MEMORY_EVENT_RETENTION_DAYS} day(s)`,
    );
    console.log(`  vcs versioned: ${result.versioning.versioned.join(", ")}`);
    console.log(`  vcs skipped:   ${result.versioning.skipped.join(", ")}`);
    return;
  }

  throw new Error(
    `mode "${mode}" is not available yet — this build supports markdown-only and graph`,
  );
}


export async function runStore(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const fact = args.positional.join(" ").trim();
  if (!fact) throw new Error("nothing to store — pass a fact: memory store <fact>");
  const config = await requireConfig(rootDir);

  if (config.mode === "graph") {
    const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
    try {
      const explicitScope = parseMemoryScope(args.flags.scope);
      const rid = await store.upsertNode(
        factToNode(fact, slugify, {
          scope: explicitScope,
          scopeId: typeof args.flags["scope-id"] === "string" ? args.flags["scope-id"] : undefined,
          provenance: {
            source_kind: "manual",
            writer: "cli",
            command: "memory store",
            scope: {
              ...(explicitScope ? { level: explicitScope } : {}),
              ...(typeof args.flags["scope-id"] === "string" ? { id: args.flags["scope-id"] } : {}),
            },
            confidence: "EXTRACTED",
            evidence: ["fact argument"],
          },
        }),
      );
      console.log(`memory: stored node ${rid}`);
    } finally {
      await store.close();
    }
    return;
  }

  const note = await storeNote(resolveNotesDir(rootDir, config), fact, new Date(), {
    provenance: {
      source_kind: "manual",
      writer: "cli",
      command: "memory store",
      confidence: "EXTRACTED",
      evidence: ["fact argument"],
    },
  });
  console.log(`memory: stored ${note.id}`);
  console.log(`  ${note.path}`);
}


export async function runStoreEvidence(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const input: MemoryStoreEvidenceInput = {
    claim: stringFlag(args.flags, "claim") ?? args.positional.join(" "),
    sourceRef: stringFlag(args.flags, "source-ref") ?? stringFlag(args.flags, "source"),
    citationExcerpt:
      stringFlag(args.flags, "citation-excerpt") ?? stringFlag(args.flags, "citation"),
    intent: stringFlag(args.flags, "intent"),
    observer: stringFlag(args.flags, "observer") ?? stringFlag(args.flags, "writer"),
    blastRadius: stringFlag(args.flags, "blast-radius"),
    route: stringFlag(args.flags, "route"),
    confidence: parseConfidence(args.flags.confidence),
    proposalKind: stringFlag(args.flags, "proposal-kind"),
    proposalId: stringFlag(args.flags, "proposal-id"),
    proposalPath: stringFlag(args.flags, "proposal-path"),
  };

  const config = await readConfig(rootDir);
  if (!config || config.mode !== "graph") {
    const rejected = rejectMemoryStoreEvidence(input, "graph_mode_required");
    printGovernedWriteResult(rejected, args.flags.json === true);
    return;
  }

  const store = await MemoryStore.open({ uri: resolveStoreUri(rootDir, config) });
  try {
    const result = await memoryStoreEvidence(store, input, { rootDir });
    printGovernedWriteResult(result, args.flags.json === true);
  } finally {
    await store.close();
  }
}


export async function runCommit(args: ParsedArgs): Promise<void> {
  const rootDir = rootOf(args.flags);
  const config = await requireConfig(rootDir);
  const result = await commitMemoryGraph(rootDir, config, {
    message: stringFlag(args.flags, "message") ?? stringFlag(args.flags, "m"),
    author: stringFlag(args.flags, "author"),
    email: stringFlag(args.flags, "email"),
  });
  if (args.flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printCommitResult(result);
}


export function printCommitResult(result: MemoryGraphCommitResult): void {
  if (result.committed) {
    console.log(`memory commit: ${result.commit?.hash}`);
    console.log(`  message: ${result.message}`);
  } else {
    console.log("memory commit: nothing meaningful to commit");
    if (result.previousCommit) console.log(`  previous: ${result.previousCommit}`);
  }
  console.log(`  included: ${result.included.join(", ") || "none"}`);
  console.log(`  skipped:  ${result.skipped.join(", ") || "none"}`);
}
