import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(process.cwd(), "src");
const CLI_BARREL = join(SRC_ROOT, "cli.ts");
const CLI_MODULE_DIR = join(SRC_ROOT, "cli");
const MAX_CLI_LINES = 1200;

function lineCount(path: string): number {
  return readFileSync(path, "utf8").split("\n").length;
}

function cliModuleFiles(): string[] {
  try {
    return readdirSync(CLI_MODULE_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(CLI_MODULE_DIR, entry.name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

describe("memory CLI barrel", () => {
  it("keeps the executable barrel and sibling modules within the CLI line budget", () => {
    expect(lineCount(CLI_BARREL)).toBeLessThanOrEqual(MAX_CLI_LINES);

    for (const file of cliModuleFiles()) {
      expect(lineCount(file)).toBeLessThanOrEqual(MAX_CLI_LINES);
    }
  });
});
