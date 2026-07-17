import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode } from "@reddb-io/toon";
import { afterEach, describe, expect, it } from "vitest";
import { afkStateDir, legacyAfkStateDir, monitorDir, stateDir, statuslineStateDir, supervisorDir, tmpDir } from "@reddb-io/shared/red-paths.js";
import { readCastleHistoryRecords } from "@reddb-io/red-castle/engine";
import { migrateLegacyDevPaths } from "./red-path-migration.js";

const roots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "red-path-mig-"));
  roots.push(root);
  await mkdir(tmpDir(root), { recursive: true });
  return root;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  // temp dirs live under the OS tmp; leave them for the OS reaper.
  roots.length = 0;
});

describe("migrateLegacyDevPaths", () => {
  it("relocates legacy durable and live artifacts to their canonical lanes", async () => {
    const root = await freshRoot();
    const tmp = tmpDir(root);
    await writeFile(join(tmp, "afk-supervisor.pid"), "123", "utf8");
    await writeFile(join(tmp, "afk-supervisor.state.json"), JSON.stringify({
      ts: "2026-07-17T00:00:00.000Z",
      epoch: 1784246400,
      ready_for_agent: 2,
      slots: { busy: 1, free: 1, total: 2, parked: 0 },
    }), "utf8");
    await writeFile(join(tmp, "monitor-log-cursors.json"), JSON.stringify({ "/x/afk.log": { size: 1, lines: 1 } }), "utf8");
    await writeFile(join(tmp, "statusline-cache.json"), "{}", "utf8");
    await writeFile(join(tmp, "afk-supervisor.log"), "log", "utf8");
    await writeFile(join(tmp, "afk-supervisor.log.jsonl"), "{}", "utf8");
    await mkdir(join(tmp, "runner-circuit"), { recursive: true });
    await writeFile(join(tmp, "runner-circuit", "claude.json"), "{}", "utf8");

    const { moved } = await migrateLegacyDevPaths(root);
    const supervisor = supervisorDir(root, "fleet");

    expect(await readFile(join(supervisor, "afk-supervisor.pid"), "utf8")).toBe("123");
    expect(await readFile(join(statuslineStateDir(root), "statusline-cache.toon"), "utf8")).toBe("{}");
    expect(await readFile(join(supervisor, "supervisor.log.toonl"), "utf8")).toBe("{}");
    expect(decode(await readFile(join(afkStateDir(root), "supervisors", "fleet", "state.toon"), "utf8"))).toMatchObject({
      kind: "supervisor",
      id: "fleet",
    });
    expect(decode(await readFile(join(monitorDir(root, "default"), "log-cursors.toon"), "utf8"))).toEqual({
      "/x/afk.log": { size: 1, lines: 1 },
    });
    expect(await readFile(join(afkStateDir(root), "runner-circuit", "claude.json"), "utf8")).toBe("{}");
    // Legacy copies are gone (moved, not copied).
    expect(await exists(join(tmp, "afk-supervisor.pid"))).toBe(false);
    expect(await exists(join(tmp, "afk-supervisor.log"))).toBe(false);
    expect(moved).toContain("afk-supervisor.pid");
    expect(moved).toContain("afk-supervisor.state.json");
    expect(moved).toContain("afk-supervisor.log.jsonl");
  });

  it("renames legacy statusline state cache files to .toon", async () => {
    const root = await freshRoot();
    const statusline = statuslineStateDir(root);
    await mkdir(statusline, { recursive: true });
    await writeFile(join(statusline, "statusline-cache.json"), "cache", "utf8");

    const { moved } = await migrateLegacyDevPaths(root);

    expect(await readFile(join(statusline, "statusline-cache.toon"), "utf8")).toBe("cache");
    expect(await exists(join(statusline, "statusline-cache.json"))).toBe(false);
    expect(moved).toContain("state/statusline-cache.json");
  });

  it("is a no-op on a second boot (idempotent)", async () => {
    const root = await freshRoot();
    await writeFile(join(tmpDir(root), "afk-supervisor.pid"), "9", "utf8");
    await migrateLegacyDevPaths(root);
    const second = await migrateLegacyDevPaths(root);
    expect(second.moved).toEqual([]);
    expect(await readFile(join(supervisorDir(root, "fleet"), "afk-supervisor.pid"), "utf8")).toBe("9");
  });

  it("relocates already-state-tier legacy AFK artifacts to the split castle/tmp lanes", async () => {
    const root = await freshRoot();
    const legacyAfk = legacyAfkStateDir(root);
    await mkdir(join(legacyAfk, "runner-circuit"), { recursive: true });
    await writeFile(join(legacyAfk, "afk-supervisor.pid"), "321", "utf8");
    await writeFile(join(legacyAfk, "afk-supervisor.log.toonl"), "[0]{ts,msg}:\n", "utf8");
    await writeFile(join(legacyAfk, "runner-circuit", "codex.json"), "{}", "utf8");
    await writeFile(join(stateDir(root), "afk-history.toonl"), "[0]{ts,epoch,worker,issue,event,duration_s,runner,merge_sha,reason}:\n", "utf8");

    const { moved } = await migrateLegacyDevPaths(root);

    expect(await readFile(join(supervisorDir(root, "fleet"), "afk-supervisor.pid"), "utf8")).toBe("321");
    expect(await readFile(join(supervisorDir(root, "fleet"), "supervisor.log.toonl"), "utf8")).toBe("[0]{ts,msg}:\n");
    expect(await readFile(join(afkStateDir(root), "runner-circuit", "codex.json"), "utf8")).toBe("{}");
    expect(await readFile(join(afkStateDir(root), "history.toonl"), "utf8")).toBe(
      "[0]{ts,epoch,worker,issue,event,duration_s,runner,merge_sha,reason}:\n",
    );
    expect(await exists(join(legacyAfk, "afk-supervisor.pid"))).toBe(false);
    expect(await exists(join(stateDir(root), "afk-history.toonl"))).toBe(false);
    expect(moved).toContain("state/afk/afk-supervisor.pid");
    expect(moved).toContain("afk-history.toonl");
  });

  it("converts legacy JSONL history into castle TOONL when no castle history exists", async () => {
    const root = await freshRoot();
    await mkdir(stateDir(root), { recursive: true });
    await writeFile(
      join(stateDir(root), "afk-history.jsonl"),
      `${JSON.stringify({ ts: "t", epoch: 1, worker: "wA", issue: 1, event: "done", duration_s: 2, runner: "codex" })}\n`,
      "utf8",
    );

    const { moved } = await migrateLegacyDevPaths(root);
    const converted = await readCastleHistoryRecords(join(afkStateDir(root), "history.toonl"));

    expect(converted).toEqual([expect.objectContaining({ ts: "t", issue: 1, event: "done", runner: "codex" })]);
    expect(await exists(join(stateDir(root), "afk-history.jsonl"))).toBe(false);
    expect(moved).toContain("afk-history.jsonl");
  });

  it("never deletes the legacy copy when the canonical copy already exists (ambiguous)", async () => {
    const root = await freshRoot();
    const legacy = join(tmpDir(root), "afk-supervisor.pid");
    const current = join(supervisorDir(root, "fleet"), "afk-supervisor.pid");
    await writeFile(legacy, "legacy", "utf8");
    await mkdir(supervisorDir(root, "fleet"), { recursive: true });
    await writeFile(current, "current", "utf8");

    const { moved } = await migrateLegacyDevPaths(root);

    expect(moved).not.toContain("afk-supervisor.pid");
    expect(await readFile(legacy, "utf8")).toBe("legacy");
    expect(await readFile(current, "utf8")).toBe("current");
  });
});
