import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "./competitive-baseline/cli.js";

export {
  evaluateCompetitiveBaseline,
  graphifyOutSummary,
  renderBaselineJson,
  renderComparisonTable,
} from "./competitive-baseline/baseline.js";
export {
  evaluateCompetitiveEval,
  renderCompetitiveEvalHuman,
  renderCompetitiveEvalJson,
} from "./competitive-baseline/eval.js";
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

if (isCompetitiveBaselineEntrypoint()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

function isCompetitiveBaselineEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  const entryName = basename(entrypoint);
  if (
    entryName !== "competitive-baseline.ts" &&
    entryName !== "competitive-baseline.js" &&
    entryName !== "competitive-baseline.mjs"
  ) {
    return false;
  }
  return import.meta.url === pathToFileURL(entrypoint).href;
}
