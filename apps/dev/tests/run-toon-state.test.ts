import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeDevSnapshotSniff } from "../src/core/toon-snapshot.js";
import { openRunnerCircuit, recordBootError, runnerCircuitOpen } from "../src/commands/run.js";

describe("run command TOON state files", () => {
  it("writes worker boot/session error payloads as TOON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-toon-worker-"));

    await recordBootError(dir, "boot-error", new Error("boom"));

    const raw = await readFile(join(dir, "boot-error.log"), "utf8");
    expect(() => JSON.parse(raw)).toThrow();
    expect(decodeDevSnapshotSniff(raw)).toMatchObject({
      type: "boot-error",
      message: "boom",
    });
  });

  it("writes runner circuit state as TOON and sniff-reads legacy JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-toon-circuit-"));

    await openRunnerCircuit(dir, "codex", 100, { RED_AFK_RUNNER_TRANSIENT_COOLDOWN_S: "5" });

    const path = join(dir, "codex.json");
    const raw = await readFile(path, "utf8");
    expect(() => JSON.parse(raw)).toThrow();
    expect(decodeDevSnapshotSniff(raw)).toMatchObject({
      runner: "codex",
      opened_at: 100,
      expires_at: 105,
    });
    await expect(runnerCircuitOpen(dir, "codex", 104)).resolves.toBe(true);
    await expect(runnerCircuitOpen(dir, "codex", 106)).resolves.toBe(false);

    const legacy = await mkdtemp(join(tmpdir(), "run-json-circuit-"));
    await writeFile(join(legacy, "claude.json"), JSON.stringify({ expires_at: 210 }), "utf8");
    await expect(runnerCircuitOpen(legacy, "claude", 200)).resolves.toBe(true);
  });
});
