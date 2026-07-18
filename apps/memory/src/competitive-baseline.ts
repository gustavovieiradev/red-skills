export {
  evaluateCompetitiveBaseline,
  graphifyOutSummary,
  renderBaselineJson,
  renderComparisonTable,
} from "./competitive-baseline/baseline-report.js";
export {
  evaluateCompetitiveEval,
  renderCompetitiveEvalHuman,
  renderCompetitiveEvalJson,
} from "./competitive-baseline/eval-core.js";
export {
  evaluateCompetitiveEvalV2,
  renderCompetitiveEvalV2Human,
  renderCompetitiveEvalV2Json,
} from "./competitive-baseline/eval-v2.js";
export {
  evaluateCompetitiveInteropReport,
  renderCompetitiveInteropHuman,
  renderCompetitiveInteropJson,
} from "./competitive-baseline/interop.js";
export type {
  BaselineAssertion,
  ComparisonRow,
  CompetitiveBaselineReport,
  CompetitiveEvalContextPackCase,
  CompetitiveEvalOptions,
  CompetitiveEvalPolicyCase,
  CompetitiveEvalRecallCase,
  CompetitiveEvalReport,
  CompetitiveEvalV2Dimension,
  CompetitiveEvalV2Report,
  CompetitiveInteropArtifactReport,
  CompetitiveInteropMappingDecision,
  CompetitiveInteropOptions,
  CompetitiveInteropReport,
  CompetitorBaseline,
  FoundationEvidenceGateReport,
  FoundationGateAxis,
  GraphifyOutSummary,
} from "./competitive-baseline/types.js";
import {
  isCompetitiveBaselineEntrypoint,
  runCompetitiveBaselineCli,
} from "./competitive-baseline/cli.js";

if (isCompetitiveBaselineEntrypoint(import.meta.url)) {
  runCompetitiveBaselineCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
