import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const memoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(memoryRoot, "src");
const graphStoreBarrel = join(sourceRoot, "graph-store.ts");
const graphStoreModules = join(sourceRoot, "graph-store");
const maxLines = 1_200;

async function lineCount(path: string): Promise<number> {
  const source = await readFile(path, "utf8");
  return source.split(/\r?\n/).length;
}

async function graphStoreSourceFiles(): Promise<string[]> {
  const entries = await readdir(graphStoreModules, { withFileTypes: true }).catch(() => []);
  return [
    graphStoreBarrel,
    ...entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(graphStoreModules, entry.name)),
  ];
}

function exportedNames(source: string): string[] {
  return [...source.matchAll(/export(?:\s+type)?\s+\{\s*([^}]+?)\s*\}\s+from/g)]
    .flatMap((match) => match[1].split(","))
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
}

describe("graph-store split contract", () => {
  it("keeps the graph-store barrel and sibling modules within the line budget", async () => {
    for (const path of await graphStoreSourceFiles()) {
      expect(await lineCount(path), path).toBeLessThanOrEqual(maxLines);
    }
  });

  it("keeps the original graph-store public surface on the barrel", async () => {
    const source = await readFile(graphStoreBarrel, "utf8");

    expect(exportedNames(source)).toEqual([
      "AskCost",
      "GraphRow",
      "MemoryStore",
      "MemoryStoreOptions",
      "NodeScopeInput",
      "SearchRow",
      "ShortestPathResult",
      "StoredNode",
      "VectorDocStatus",
      "VectorNodeStatus",
      "VectorProjectionState",
      "VectorStatusReport",
      "factToNode",
      "isExpired",
      "rowToGraphRow",
      "rowToNode",
    ]);
  });
});
