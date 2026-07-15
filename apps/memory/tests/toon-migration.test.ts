import { mkdtemp, readFile, rm, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { encode } from "@reddb-io/toon";
import {
  convertRegisteredToonSurfaces,
  MEMORY_TOON_SURFACES,
  readRegisteredSurface,
} from "../src/toon-migration.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memory-toon-migration-"));
  roots.push(root);
  return root;
}

async function write(root: string, rel: string, body: string): Promise<string> {
  const path = join(root, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
  return path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("Memory TOON migration", () => {
  test("registry includes a real snapshot surface as proof", () => {
    expect(MEMORY_TOON_SURFACES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dev.statusline-cache",
          legacyPath: ".red/tmp/statusline-cache.json",
          toonPath: ".red/tmp/statusline-cache.toon",
          kind: "toon",
        }),
      ]),
    );
  });

  test("refuses while fleet or residents are active and explains why", async () => {
    const root = await scratch();
    await write(root, ".red/tmp/statusline-cache.json", JSON.stringify({ queue: 2, human: 1, ts: 10 }));
    await write(root, ".red/tmp/afk-supervisor.pid", `${process.pid}\n`);

    const report = await convertRegisteredToonSurfaces({ rootDir: root });

    expect(report.status).toBe("refused");
    expect(report.reasons.join("\n")).toContain("active fleet");
    expect(report.converted).toHaveLength(0);
    expect(await exists(join(root, ".red/tmp/statusline-cache.toon"))).toBe(false);
  });

  test("converts legacy JSON idempotently when quiesced", async () => {
    const root = await scratch();
    const legacy = await write(root, ".red/tmp/statusline-cache.json", JSON.stringify({ queue: 4, human: 2, ts: 12 }));

    const first = await convertRegisteredToonSurfaces({ rootDir: root });
    const toonPath = join(root, ".red/tmp/statusline-cache.toon");
    const afterFirst = await readFile(toonPath, "utf8");
    const legacyAfterFirst = await readFile(legacy, "utf8");

    const second = await convertRegisteredToonSurfaces({ rootDir: root });
    const afterSecond = await readFile(toonPath, "utf8");

    expect(first.status).toBe("converted");
    expect(first.converted).toEqual(["dev.statusline-cache"]);
    expect(first.skipped).toHaveLength(0);
    expect(legacyAfterFirst).toBe(JSON.stringify({ queue: 4, human: 2, ts: 12 }));
    expect(second.status).toBe("noop");
    expect(second.converted).toHaveLength(0);
    expect(second.skipped).toEqual(["dev.statusline-cache"]);
    expect(afterSecond).toBe(afterFirst);
  });

  test("format-sniff helper reads legacy JSON and converted TOON", async () => {
    const root = await scratch();
    await write(root, ".red/tmp/statusline-cache.json", JSON.stringify({ queue: 1, human: 0, ts: 3 }));

    await expect(readRegisteredSurface(root, "dev.statusline-cache")).resolves.toMatchObject({
      format: "json",
      value: { queue: 1, human: 0, ts: 3 },
    });

    await write(root, ".red/tmp/statusline-cache.toon", encode({ queue: 8, human: 5, ts: 34 }));

    await expect(readRegisteredSurface(root, "dev.statusline-cache")).resolves.toMatchObject({
      format: "toon",
      value: { queue: 8, human: 5, ts: 34 },
    });
  });
});
