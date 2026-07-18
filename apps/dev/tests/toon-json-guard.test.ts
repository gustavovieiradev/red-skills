import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkToonJsonGuard,
  formatToonJsonGuardViolations,
  scanRepositoryForStackOwnedJsonFileIo,
  scanTextForStackOwnedJsonFileIo,
  TOON_JSON_ALLOWLIST,
  type ToonJsonAllowlistEntry,
} from "../src/core/toon-json-guard.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

describe("TOON JSON guard fixtures", () => {
  it("fails on a new unallowlisted JSON.stringify file write", () => {
    const findings = scanTextForStackOwnedJsonFileIo({
      filePath: "apps/example/src/state.ts",
      text: `
        import { writeFile } from "node:fs/promises";
        export async function saveState(path: string, state: unknown) {
          await writeFile(path, JSON.stringify(state), "utf8");
        }
      `,
    });

    const result = checkToonJsonGuard(findings, []);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.operation).toBe("write");
  });

  it("passes once the JSON.stringify file write is allowlisted", () => {
    const findings = scanTextForStackOwnedJsonFileIo({
      filePath: "apps/example/src/state.ts",
      text: `
        import { writeFile } from "node:fs/promises";
        export async function saveState(path: string, state: unknown) {
          await writeFile(path, JSON.stringify(state), "utf8");
        }
      `,
    });
    const allowlist: ToonJsonAllowlistEntry[] = [
      {
        id: findings[0]!.id,
        file: findings[0]!.file,
        operation: findings[0]!.operation,
        classification: "migrate",
      },
    ];

    const result = checkToonJsonGuard(findings, allowlist);

    expect(result.violations).toEqual([]);
  });

  it("detects JSON.parse of a file read", () => {
    const findings = scanTextForStackOwnedJsonFileIo({
      filePath: "packages/example/src/load.ts",
      text: `
        import { readFileSync } from "node:fs";
        export function load(path: string) {
          return JSON.parse(readFileSync(path, "utf8"));
        }
      `,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.operation).toBe("read");
  });

  it("ignores in-memory JSON use and external command output", () => {
    const findings = scanTextForStackOwnedJsonFileIo({
      filePath: "apps/example/src/interop.ts",
      text: `
        import { createHash } from "node:crypto";
        export function handle(stdout: string, payload: unknown) {
          const parsed = JSON.parse(stdout);
          return createHash("sha256").update(JSON.stringify(payload)).digest("hex") + parsed.ok;
        }
      `,
    });

    expect(findings).toEqual([]);
  });
});

describe("TOON JSON guard repository ratchet", () => {
  it("keeps stack-owned-file JSON I/O frozen behind the allowlist", async () => {
    const findings = await scanRepositoryForStackOwnedJsonFileIo(REPO_ROOT);
    const result = checkToonJsonGuard(findings, TOON_JSON_ALLOWLIST);

    expect(formatToonJsonGuardViolations(result.violations)).toBe("");
  });

  it("requires external allowlist entries to carry one-line reasons", () => {
    const missingReasons = TOON_JSON_ALLOWLIST.filter(
      (entry) => entry.classification === "external" && (!entry.reason || entry.reason.trim().split(/\r?\n/).length !== 1),
    );

    expect(missingReasons).toEqual([]);
  });
});
