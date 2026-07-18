import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const coreDir = join(packageRoot, "src", "core");
const supervisorBarrel = join(coreDir, "supervisor.ts");
const supervisorModulesDir = join(coreDir, "supervisor");
const maxLines = 1200;

const expectedSupervisorExports = [
  "CircuitDecision",
  "DrainBudgetStatus",
  "DrainBudgetTier",
  "ElasticResizeRequest",
  "ElasticShrinkMode",
  "FleetHeartbeat",
  "FleetHeartbeatEmitResult",
  "HEARTBEAT_STATE_REPAIR_AFTER_TICKS",
  "HeartbeatSlotDetail",
  "HeartbeatSlotPid",
  "IterDirInfo",
  "ReapContestResolution",
  "ReapContestState",
  "ReconcileCandidate",
  "SlotState",
  "SpawnPolicy",
  "SUPERVISOR_DEFAULTS",
  "SupervisorAdoptionResult",
  "SupervisorConfig",
  "SupervisorConfigReader",
  "SupervisorDeps",
  "SupervisorEventKind",
  "SupervisorEventRecord",
  "SupervisorFs",
  "SupervisorGh",
  "SupervisorHealth",
  "SupervisorLiveness",
  "SupervisorProc",
  "SupervisorState",
  "SweepWork",
  "SweepWorker",
  "TickResult",
  "TrunkFreshnessOutcome",
  "TrunkFreshnessStatus",
  "TrunkMirrorRefreshResult",
  "ValidationAdmissionDecision",
  "ValidationAdmissionInput",
  "adoptPersistedSlotPids",
  "buildCrashEnvelope",
  "buildDiscardEnvelope",
  "buildReaperEnvelope",
  "classifySupervisor",
  "decideCrashReconcile",
  "dispatchReconcileIfPossible",
  "evaluateDrainBudget",
  "evaluateValidationAdmission",
  "freshSlot",
  "guardedTick",
  "handleDeadSlot",
  "initSupervisorState",
  "pollStallDetector",
  "reapStalledSlot",
  "reconcileDeadWorkerClaim",
  "recordDeath",
  "resolveReapContest",
  "resolveSupervisorConfig",
  "runSupervisor",
  "superviseTick",
  "sweepParkedSlot",
  "terminateAll",
  "validateStallThresholds",
  "validateSupervisorProgressThreshold",
  "validateSupervisorStaleThreshold",
].sort();

function lineCount(path: string): number {
  return readFileSync(path, "utf8").split(/\r?\n/).length;
}

function supervisorModuleFiles(): string[] {
  try {
    if (!statSync(supervisorModulesDir).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(supervisorModulesDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(supervisorModulesDir, name));
}

function exportedNames(path: string): string[] {
  const configPath = join(packageRoot, "tsconfig.json");
  const rawConfig = ts.readConfigFile(configPath, ts.sys.readFile);
  if (rawConfig.error) {
    throw new Error(ts.flattenDiagnosticMessageText(rawConfig.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, packageRoot);
  const program = ts.createProgram({
    rootNames: Array.from(new Set([path, ...parsed.fileNames])),
    options: { ...parsed.options, noEmit: true },
  });
  const source = program.getSourceFile(path);
  if (!source) throw new Error("supervisor source was not included in the TypeScript program");
  const symbol = program.getTypeChecker().getSymbolAtLocation(source);
  if (!symbol) throw new Error("supervisor module symbol was not available");
  return program
    .getTypeChecker()
    .getExportsOfModule(symbol)
    .map((exported) => exported.getName())
    .sort();
}

describe("supervisor split contract", () => {
  it("keeps the original supervisor module path as the only public import target", () => {
    expect(statSync(supervisorBarrel).isFile()).toBe(true);
    expect(supervisorModuleFiles().some((path) => path.endsWith("/index.ts"))).toBe(false);
  });

  it("keeps the barrel and every supervisor implementation module under the line cap", () => {
    const files = [supervisorBarrel, ...supervisorModuleFiles()];
    expect(files.map((path) => [path.replace(`${packageRoot}/`, ""), lineCount(path)])).toEqual(
      files.map((path) => [path.replace(`${packageRoot}/`, ""), expect.any(Number)]),
    );
    for (const path of files) {
      expect(lineCount(path), path.replace(`${packageRoot}/`, "")).toBeLessThanOrEqual(maxLines);
    }
  });

  it("keeps the barrel export surface identical to the pre-split supervisor", () => {
    expect(exportedNames(supervisorBarrel)).toEqual(expectedSupervisorExports);
  });
});
