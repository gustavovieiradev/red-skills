import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode } from "@reddb-io/toon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEnginePaths } from "./paths.js";
import {
  appendCastleHistoryEvent,
  CastleLaneWriter,
  readCastleLaneRecords,
  validateCastleLaneRecord,
  writeCastleStateSnapshot,
} from "./writers.js";

const AT = "2026-07-16T19:00:00.000Z";

async function makeTmpDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `castle-writers-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("castle lane writers", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends worker/supervisor/monitor/liveness records as red.castle.lane.v1 TOONL", async () => {
    const paths = createEnginePaths(join(dir, ".red"));
    const lanes = [
      paths.workerLog("wAB12"),
      paths.supervisorLog("sFleet"),
      paths.monitorLog("mStatus"),
      paths.workerLiveness("wAB12"),
    ];

    for (const path of lanes) {
      const writer = new CastleLaneWriter({ path });
      await writer.append({
        at: AT,
        kind:
          path === paths.workerLiveness("wAB12")
            ? "worker.heartbeat"
            : "worker.claimed",
        worker_id: "wAB12",
        issue: 1905,
        attempt: 1,
        payload: { source: "test", ok: true },
      });
    }

    for (const path of lanes) {
      const raw = await readFile(path, "utf8");
      const lines = raw.trimEnd().split("\n");
      expect(lines[0]).toBe(
        "[]{at,kind,worker_id,supervisor_id,issue,attempt,payload}:",
      );
      expect(() => JSON.parse(lines[0]!)).toThrow();
      expect(await readCastleLaneRecords(path)).toEqual([
        expect.objectContaining({
          at: AT,
          worker_id: "wAB12",
          issue: 1905,
          attempt: 1,
          payload: { source: "test", ok: true },
        }),
      ]);
    }
  });

  it("writes state.toon snapshots as TOON documents", async () => {
    const paths = createEnginePaths(join(dir, ".red"));
    const snapshot = {
      kind: "worker" as const,
      id: "wAB12",
      version: 1,
      updated_at: AT,
      worker_id: "wAB12",
      runner: "codex",
      pid: 123,
      current: { issue: 1905, stage: "run" },
      envelope: { posted: false },
    };

    await writeCastleStateSnapshot(paths.workerState("wAB12"), snapshot);

    expect(existsSync(paths.workerState("wAB12"))).toBe(true);
    expect(decode(await readFile(paths.workerState("wAB12"), "utf8"))).toEqual(
      snapshot,
    );
  });

  it("records durable history through the namespaced lane record family", async () => {
    const paths = createEnginePaths(join(dir, ".red"));

    await appendCastleHistoryEvent(paths.castleHistory, {
      ts: AT,
      epoch: 1784232000,
      worker: "wAB12",
      issue: 1905,
      event: "done",
      duration_s: 42,
      runner: "codex",
      merge_sha: "abc123",
    });

    expect(await readCastleLaneRecords(paths.castleHistory)).toEqual([
      {
        at: AT,
        kind: "history.done",
        worker_id: "wAB12",
        issue: 1905,
        payload: {
          duration_s: 42,
          epoch: 1784232000,
          event: "done",
          merge_sha: "abc123",
          runner: "codex",
        },
      },
    ]);
  });

  it("rejects records outside the red.castle.lane.v1 shape before writing", async () => {
    expect(() =>
      validateCastleLaneRecord({
        at: AT,
        kind: "not-namespaced",
      }),
    ).toThrow(/namespaced/);

    await expect(
      new CastleLaneWriter({ path: join(dir, "bad.toonl") }).append({
        at: AT,
        kind: "worker.claimed",
        issue: -1,
      }),
    ).rejects.toThrow(/issue/);
    expect(existsSync(join(dir, "bad.toonl"))).toBe(false);
  });

  it("does not expose prose .log writer paths for castle lanes", () => {
    const paths = createEnginePaths(join(dir, ".red"));
    const writerPaths = [
      paths.workerLog("wAB12"),
      paths.supervisorLog("sFleet"),
      paths.monitorLog("mStatus"),
      paths.workerLiveness("wAB12"),
      paths.castleHistory,
      paths.castleValidation,
    ];

    expect(writerPaths).toEqual(
      writerPaths.map((path) => expect.stringMatching(/\.toonl$/)),
    );
    expect(writerPaths).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\.log$/)]),
    );
  });
});
