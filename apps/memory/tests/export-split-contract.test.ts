import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const memoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(memoryRoot, "src");
const exportBarrel = join(sourceRoot, "export.ts");
const exportModules = join(sourceRoot, "export");
const maxLines = 1_200;

async function lineCount(path: string): Promise<number> {
  const source = await readFile(path, "utf8");
  return source.split(/\r?\n/).length;
}

async function exportSourceFiles(): Promise<string[]> {
  const entries = await readdir(exportModules, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return [
    exportBarrel,
    ...entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(exportModules, entry.name)),
  ];
}

function exportedNames(source: string): string[] {
  const direct = [...source.matchAll(/export\s+(?:async\s+)?(?:function|interface|class|const|let|var|type)\s+([A-Za-z0-9_$]+)/g)].map(
    (match) => match[1],
  );
  const reexports = [...source.matchAll(/export(?:\s+type)?\s+\{\s*([^}]+?)\s*\}\s+from/g)]
    .flatMap((match) => match[1].split(","))
    .map((name) => name.trim())
    .filter(Boolean);
  return [...direct, ...reexports].sort();
}

describe("export split contract", () => {
  it("keeps the export barrel and sibling modules within the line budget", async () => {
    for (const path of await exportSourceFiles()) {
      expect(await lineCount(path), path).toBeLessThanOrEqual(maxLines);
    }
  });

  it("keeps the original export public surface on the barrel", async () => {
    const source = await readFile(exportBarrel, "utf8");

    expect(exportedNames(source)).toEqual([
      "ExportEdge",
      "ExportOptions",
      "ExportResult",
      "exportGraph",
      "toEdge",
    ]);
  });
});
