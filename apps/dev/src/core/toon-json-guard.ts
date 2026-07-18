import { readdir, readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import ts from "typescript";

export type ToonJsonOperation = "read" | "write";
export type ToonJsonClassification = "migrate" | "external";

export interface ToonJsonFinding {
  id: string;
  file: string;
  line: number;
  column: number;
  operation: ToonJsonOperation;
  api: string;
  expression: string;
}

export interface ToonJsonAllowlistEntry {
  id: string;
  file: string;
  operation: ToonJsonOperation;
  classification: ToonJsonClassification;
  reason?: string;
}

export interface ToonJsonGuardResult {
  findings: ToonJsonFinding[];
  violations: ToonJsonFinding[];
}

export const TOON_JSON_ALLOWLIST: readonly ToonJsonAllowlistEntry[] = [
  {
    id: "apps/benchmark-code-understanding/src/runner.ts:97:9:write",
    file: "apps/benchmark-code-understanding/src/runner.ts",
    operation: "write",
    classification: "external",
    reason: "MCP config JSON is consumed by external benchmark runners.",
  },
  {
    id: "apps/brain/src/hook-runtime.ts:15:9:write",
    file: "apps/brain/src/hook-runtime.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/brain/src/scheduled-ingestion.ts:54:12:read",
    file: "apps/brain/src/scheduled-ingestion.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/brain/src/scheduled-ingestion.ts:63:9:write",
    file: "apps/brain/src/scheduled-ingestion.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/commands/activity-review.ts:335:20:read",
    file: "apps/dev/src/commands/activity-review.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/commands/activity-review.ts:349:9:write",
    file: "apps/dev/src/commands/activity-review.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/commands/run.ts:1446:25:read",
    file: "apps/dev/src/commands/run.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/commands/run.ts:1454:15:write",
    file: "apps/dev/src/commands/run.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/commands/run.ts:1675:16:read",
    file: "apps/dev/src/commands/run.ts",
    operation: "read",
    classification: "external",
    reason: "Version manifest JSON is a release/runtime artifact boundary.",
  },
  {
    id: "apps/dev/src/commands/run.ts:1751:13:write",
    file: "apps/dev/src/commands/run.ts",
    operation: "write",
    classification: "external",
    reason: "Brain outcome event JSON is an interop payload for the brain CLI.",
  },
  {
    id: "apps/dev/src/commands/run.ts:1807:9:write",
    file: "apps/dev/src/commands/run.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/commands/run.ts:1832:9:write",
    file: "apps/dev/src/commands/run.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/commands/run.ts:1851:20:read",
    file: "apps/dev/src/commands/run.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/commands/statusline.ts:165:42:read",
    file: "apps/dev/src/commands/statusline.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/core/bundle-version.ts:109:20:read",
    file: "apps/dev/src/core/bundle-version.ts",
    operation: "read",
    classification: "external",
    reason: "Version manifest JSON is a release/runtime artifact boundary.",
  },
  {
    id: "apps/dev/src/runtime/feedback-worktree.ts:323:21:read",
    file: "apps/dev/src/runtime/feedback-worktree.ts",
    operation: "read",
    classification: "external",
    reason: "package.json is an ecosystem manifest.",
  },
  {
    id: "apps/dev/src/runtime/review-gh.ts:93:9:write",
    file: "apps/dev/src/runtime/review-gh.ts",
    operation: "write",
    classification: "external",
    reason: "Review JSON is a GitHub API payload.",
  },
  {
    id: "apps/dev/src/runtime/wire.ts:1010:5:write",
    file: "apps/dev/src/runtime/wire.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/dev/src/runtime/wire.ts:1017:7:write",
    file: "apps/dev/src/runtime/wire.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/memory/src/backup.ts:143:20:read",
    file: "apps/memory/src/backup.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/memory/src/backup.ts:84:9:write",
    file: "apps/memory/src/backup.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/memory/src/backup.ts:98:9:write",
    file: "apps/memory/src/backup.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/memory/src/bench-eval.ts:387:18:read",
    file: "apps/memory/src/bench-eval.ts",
    operation: "read",
    classification: "external",
    reason: "Benchmark corpus JSON is a fixture input format.",
  },
  {
    id: "apps/memory/src/bench-eval.ts:394:18:read",
    file: "apps/memory/src/bench-eval.ts",
    operation: "read",
    classification: "external",
    reason: "Benchmark question JSON is a fixture input format.",
  },
  {
    id: "apps/memory/src/bench-latency.ts:484:20:read",
    file: "apps/memory/src/bench-latency.ts",
    operation: "read",
    classification: "external",
    reason: "Benchmark workload JSON is a fixture input format.",
  },
  {
    id: "apps/memory/src/bench-mistake-avoided.ts:111:18:read",
    file: "apps/memory/src/bench-mistake-avoided.ts",
    operation: "read",
    classification: "external",
    reason: "Benchmark dataset JSON is a fixture input format.",
  },
  {
    id: "apps/memory/src/bench-recall.ts:47:18:read",
    file: "apps/memory/src/bench-recall.ts",
    operation: "read",
    classification: "external",
    reason: "Benchmark corpus JSON is a fixture input format.",
  },
  {
    id: "apps/memory/src/bench-recall.ts:54:18:read",
    file: "apps/memory/src/bench-recall.ts",
    operation: "read",
    classification: "external",
    reason: "Benchmark query JSON is a fixture input format.",
  },
  {
    id: "apps/memory/src/cli.ts:3108:7:write",
    file: "apps/memory/src/cli.ts",
    operation: "write",
    classification: "external",
    reason: "Codebase map JSON is a deliberate export artifact.",
  },
  {
    id: "apps/memory/src/cli.ts:3110:7:write",
    file: "apps/memory/src/cli.ts",
    operation: "write",
    classification: "external",
    reason: "Codebase map metadata JSON is a deliberate export artifact.",
  },
  {
    id: "apps/memory/src/cli.ts:8037:17:read",
    file: "apps/memory/src/cli.ts",
    operation: "read",
    classification: "external",
    reason: "Architecture overview accepts a caller-provided JSON contract.",
  },
  {
    id: "apps/memory/src/competitive-baseline.ts:1844:9:write",
    file: "apps/memory/src/competitive-baseline.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/memory/src/config.ts:249:12:read",
    file: "apps/memory/src/config.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/memory/src/curate-skill/archive-engine.ts:192:9:write",
    file: "apps/memory/src/curate-skill/archive-engine.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/memory/src/curate-skill/archive-engine.ts:221:20:read",
    file: "apps/memory/src/curate-skill/archive-engine.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/memory/src/export.ts:182:5:write",
    file: "apps/memory/src/export.ts",
    operation: "write",
    classification: "external",
    reason: "Memory graph JSON is a deliberate interop export.",
  },
  {
    id: "apps/memory/src/hook-coverage.ts:112:22:read",
    file: "apps/memory/src/hook-coverage.ts",
    operation: "read",
    classification: "external",
    reason: "Plugin manifests are external ecosystem JSON.",
  },
  {
    id: "apps/memory/src/hook-coverage.ts:192:12:read",
    file: "apps/memory/src/hook-coverage.ts",
    operation: "read",
    classification: "external",
    reason: "Plugin manifests are external ecosystem JSON.",
  },
  {
    id: "apps/memory/src/inbox.ts:117:12:read",
    file: "apps/memory/src/inbox.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/memory/src/inbox.ts:205:9:write",
    file: "apps/memory/src/inbox.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/opencode-host/src/emit.ts:98:5:write",
    file: "apps/opencode-host/src/emit.ts",
    operation: "write",
    classification: "external",
    reason: "opencode.json is an external agent manifest.",
  },
  {
    id: "apps/opencode-host/src/generate.ts:264:5:write",
    file: "apps/opencode-host/src/generate.ts",
    operation: "write",
    classification: "external",
    reason: "Generated opencode JSON is an external agent manifest.",
  },
  {
    id: "apps/opencode-host/src/hooks-to-events.ts:564:13:read",
    file: "apps/opencode-host/src/hooks-to-events.ts",
    operation: "read",
    classification: "external",
    reason: "opencode hook JSON is an external agent manifest.",
  },
  {
    id: "apps/opencode-host/src/mcp-passthrough.ts:70:12:read",
    file: "apps/opencode-host/src/mcp-passthrough.ts",
    operation: "read",
    classification: "external",
    reason: "MCP config JSON is an external protocol boundary.",
  },
  {
    id: "apps/rsp/src/elision-store.ts:1341:20:read",
    file: "apps/rsp/src/elision-store.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "apps/rsp/src/elision-store.ts:1400:9:write",
    file: "apps/rsp/src/elision-store.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "apps/rsp/src/two-axis-benchmark.ts:422:18:read",
    file: "apps/rsp/src/two-axis-benchmark.ts",
    operation: "read",
    classification: "external",
    reason: "Benchmark baseline JSON is a fixture input format.",
  },
  {
    id: "apps/rsp/src/two-axis-benchmark.ts:428:18:read",
    file: "apps/rsp/src/two-axis-benchmark.ts",
    operation: "read",
    classification: "external",
    reason: "Benchmark baseline JSON is a fixture input format.",
  },
  {
    id: "packages/browser-bridge/session.ts:133:3:write",
    file: "packages/browser-bridge/session.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "packages/browser-bridge/session.ts:160:3:write",
    file: "packages/browser-bridge/session.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "packages/browser-bridge/session.ts:168:3:write",
    file: "packages/browser-bridge/session.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "packages/browser-bridge/session.ts:55:12:read",
    file: "packages/browser-bridge/session.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "packages/browser-bridge/session.ts:89:3:write",
    file: "packages/browser-bridge/session.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "packages/red-castle/.red-castle/agent-workflows/shared/common.ts:44:3:write",
    file: "packages/red-castle/.red-castle/agent-workflows/shared/common.ts",
    operation: "write",
    classification: "external",
    reason: "red-castle workflow JSON is a generated workflow artifact.",
  },
  {
    id: "packages/red-castle/src/WorktreeLock.ts:182:24:read",
    file: "packages/red-castle/src/WorktreeLock.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "packages/red-castle/src/WorktreeLock.ts:53:22:read",
    file: "packages/red-castle/src/WorktreeLock.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "packages/red-castle/src/WorktreeLock.ts:95:18:read",
    file: "packages/red-castle/src/WorktreeLock.ts",
    operation: "read",
    classification: "migrate",
  },
  {
    id: "packages/red-castle/tsup.config.ts:4:13:read",
    file: "packages/red-castle/tsup.config.ts",
    operation: "read",
    classification: "external",
    reason: "package.json is an ecosystem manifest.",
  },
  {
    id: "packages/shared/entrypoint-cli.ts:257:12:read",
    file: "packages/shared/entrypoint-cli.ts",
    operation: "read",
    classification: "external",
    reason: "Version manifest JSON is a release/runtime artifact boundary.",
  },
  {
    id: "packages/shared/self-update.ts:195:9:write",
    file: "packages/shared/self-update.ts",
    operation: "write",
    classification: "migrate",
  },
  {
    id: "packages/shared/toon-migration.ts:366:10:read",
    file: "packages/shared/toon-migration.ts",
    operation: "read",
    classification: "migrate",
  },
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const EXCLUDED_SEGMENTS = new Set([
  "dist",
  "node_modules",
  "coverage",
  "docs",
  "tests",
  "fixtures",
  "fixtures-neutral",
]);

const TEST_FILE_RE = /(?:^|[./-])(?:test|spec)\.[cm]?[tj]sx?$/;
const WRITE_APIS = new Set(["writeFile", "writeFileSync"]);
const READ_APIS = new Set(["readFile", "readFileSync"]);

export function checkToonJsonGuard(
  findings: readonly ToonJsonFinding[],
  allowlist: readonly ToonJsonAllowlistEntry[] = TOON_JSON_ALLOWLIST,
): ToonJsonGuardResult {
  const allowed = new Set(allowlist.map((entry) => entry.id));
  return {
    findings: [...findings],
    violations: findings.filter((finding) => !allowed.has(finding.id)),
  };
}

export function formatToonJsonGuardViolations(violations: readonly ToonJsonFinding[]): string {
  if (violations.length === 0) return "";
  return violations
    .map((finding) => {
      return [
        `${finding.id}`,
        `  ${finding.operation} via ${finding.api}`,
        `  ${finding.expression}`,
      ].join("\n");
    })
    .join("\n\n");
}

export async function scanRepositoryForStackOwnedJsonFileIo(rootDir: string): Promise<ToonJsonFinding[]> {
  const files = await listSourceFiles(rootDir);
  const all: ToonJsonFinding[] = [];

  for (const file of files) {
    const text = await readFile(file.absPath, "utf8");
    all.push(...scanTextForStackOwnedJsonFileIo({ filePath: file.relPath, text }));
  }

  return all.sort((a, b) => a.id.localeCompare(b.id));
}

export function scanTextForStackOwnedJsonFileIo(opts: {
  filePath: string;
  text: string;
}): ToonJsonFinding[] {
  const sourceFile = ts.createSourceFile(
    opts.filePath,
    opts.text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(opts.filePath),
  );
  const findings: ToonJsonFinding[] = [];
  const rootTaint: TaintState = { stringifiedVars: new Set(), fileReadVars: new Set() };

  function visit(node: ts.Node, taint: TaintState): void {
    if (isFunctionWithBody(node)) {
      visit(node.body, { stringifiedVars: new Set(), fileReadVars: new Set() });
      return;
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (containsJsonStringify(node.initializer, taint.stringifiedVars)) taint.stringifiedVars.add(node.name.text);
      if (containsFileRead(node.initializer) || containsIdentifierFrom(node.initializer, taint.fileReadVars)) {
        taint.fileReadVars.add(node.name.text);
      }
    }

    if (ts.isForOfStatement(node) && ts.isIdentifier(node.initializer)) {
      const childTaint = cloneTaint(taint);
      if (containsFileRead(node.expression) || containsIdentifierFrom(node.expression, taint.fileReadVars)) {
        childTaint.fileReadVars.add(node.initializer.text);
      }
      visit(node.statement, childTaint);
      return;
    }

    if (ts.isCallExpression(node)) {
      const jsonCall = jsonMethodName(node);
      if (jsonCall === "parse" && node.arguments[0]) {
        if (containsFileRead(node.arguments[0]) || containsIdentifierFrom(node.arguments[0], taint.fileReadVars)) {
          findings.push(makeFinding(sourceFile, opts.filePath, node, "read", "JSON.parse"));
        }
      }

      const writeArg = writtenDataArgument(node);
      if (writeArg && containsJsonStringify(writeArg, taint.stringifiedVars)) {
        findings.push(makeFinding(sourceFile, opts.filePath, node, "write", callApiName(node)));
      }
    }

    ts.forEachChild(node, (child) => visit(child, taint));
  }

  visit(sourceFile, rootTaint);
  return dedupeFindings(findings);
}

interface TaintState {
  stringifiedVars: Set<string>;
  fileReadVars: Set<string>;
}

function cloneTaint(taint: TaintState): TaintState {
  return {
    stringifiedVars: new Set(taint.stringifiedVars),
    fileReadVars: new Set(taint.fileReadVars),
  };
}

async function listSourceFiles(rootDir: string): Promise<Array<{ absPath: string; relPath: string }>> {
  const out: Array<{ absPath: string; relPath: string }> = [];

  for (const top of ["apps", "packages"]) {
    await walk(`${rootDir}/${top}`);
  }

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = `${dir}/${entry.name}`;
      const relPath = relative(rootDir, absPath).split(sep).join("/");
      if (entry.isDirectory()) {
        if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
        await walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isSourcePath(relPath)) continue;
      out.push({ absPath, relPath });
    }
  }

  return out;
}

function isSourcePath(path: string): boolean {
  const ext = path.match(/\.[^.]+$/)?.[0] ?? "";
  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  if (TEST_FILE_RE.test(path)) return false;
  return true;
}

function scriptKindForPath(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isFunctionWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) && node.body !== undefined;
}

function makeFinding(
  sourceFile: ts.SourceFile,
  filePath: string,
  node: ts.Node,
  operation: ToonJsonOperation,
  api: string,
): ToonJsonFinding {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const line = position.line + 1;
  const column = position.character + 1;
  return {
    id: `${filePath}:${line}:${column}:${operation}`,
    file: filePath,
    line,
    column,
    operation,
    api,
    expression: singleLine(node.getText(sourceFile)),
  };
}

function dedupeFindings(findings: readonly ToonJsonFinding[]): ToonJsonFinding[] {
  const byId = new Map<string, ToonJsonFinding>();
  for (const finding of findings) byId.set(finding.id, finding);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function jsonMethodName(node: ts.CallExpression): "parse" | "stringify" | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "JSON") return null;
  if (node.expression.name.text === "parse" || node.expression.name.text === "stringify") {
    return node.expression.name.text;
  }
  return null;
}

function containsJsonStringify(node: ts.Node, stringifiedVars = new Set<string>()): boolean {
  let found = false;
  const visit = (next: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(next) && jsonMethodName(next) === "stringify") {
      found = true;
      return;
    }
    if (ts.isIdentifier(next) && stringifiedVars.has(next.text)) {
      found = true;
      return;
    }
    ts.forEachChild(next, visit);
  };
  visit(node);
  return found;
}

function containsFileRead(node: ts.Node): boolean {
  let found = false;
  const visit = (next: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(next) && isFileReadCall(next)) {
      found = true;
      return;
    }
    ts.forEachChild(next, visit);
  };
  visit(node);
  return found;
}

function containsIdentifierFrom(node: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (next: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(next) && names.has(next.text)) {
      found = true;
      return;
    }
    ts.forEachChild(next, visit);
  };
  visit(node);
  return found;
}

function writtenDataArgument(node: ts.CallExpression): ts.Expression | null {
  if (!isFileWriteCall(node)) return null;
  return node.arguments[1] ?? null;
}

function isFileWriteCall(node: ts.CallExpression): boolean {
  return WRITE_APIS.has(callApiName(node));
}

function isFileReadCall(node: ts.CallExpression): boolean {
  return READ_APIS.has(callApiName(node));
}

function callApiName(node: ts.CallExpression): string {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return "";
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
