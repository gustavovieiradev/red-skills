// supervisor-boot.test.ts — the fleet supervisor owns the boot (#623).
//
// runSupervisor runs the injected `bootSweeps` ONCE, before the initial fleet
// spawn, and never again for the rest of its lifetime (a worker death + respawn
// inside the tick loop must not re-trigger the sweeps). A bootSweeps throw is
// caught and logged; the fleet still spawns. Kept in its own small file so it
// runs without the environmental heap pressure of the full supervisor suite.

import { describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runSupervisor,
  initSupervisorState,
  SUPERVISOR_DEFAULTS,
  type SupervisorConfig,
  type SupervisorDeps,
} from "../src/core/supervisor.js";
import { OperationalProbeHaltError, type OperationalProbeReport } from "../src/core/operational-probes.js";
import { buildSupervisorBootSweeps } from "../src/commands/supervise.js";
import type { ProcessSnapshotEntry } from "../src/core/reaper-signal.js";
import type { LivenessVerdict } from "@reddb-io/red-castle";

const NOW = 1_000_000;

function config(over: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return { ...SUPERVISOR_DEFAULTS, ...over };
}

interface DepsOverrides {
  isAlive?: () => boolean;
  lastExitCode?: () => number | null;
  readyQueueDepth?: () => Promise<number>;
  bootSweeps?: (() => Promise<void>) | undefined;
}

/** A minimal real-shaped SupervisorDeps with every closure spied. The `sleep`
 * resolves on a macrotask (setTimeout 0) — NOT immediately — so guardedTick's
 * race lets the real tick win and `stopped` propagates (avoids the #446 spin). */
function makeDeps(over: DepsOverrides = {}): {
  deps: SupervisorDeps;
  spawnSlot: ReturnType<typeof vi.fn>;
  bootSweeps: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  order: string[];
} {
  let nextPid = 2000;
  const order: string[] = [];
  const hasBoot = !("bootSweeps" in over) || over.bootSweeps !== undefined;
  const bootSweeps = vi.fn(
    over.bootSweeps ??
      (async () => {
        order.push("boot");
      }),
  );
  const spawnSlot = vi.fn(async () => {
    order.push("spawn");
    return { pid: ++nextPid, spawnEpoch: NOW };
  });
  const log = vi.fn();
  const deps: SupervisorDeps = {
    proc: {
      spawnSlot,
      isAlive: vi.fn(over.isAlive ?? (() => true)),
      killTree: vi.fn(async () => {}),
      inspectTree: vi.fn((): readonly ProcessSnapshotEntry[] => []),
      sleep: vi.fn((_ms: number) => new Promise<void>((resolve) => setTimeout(resolve, 0))),
      lastExitCode: vi.fn(over.lastExitCode ?? (() => null as number | null)),
    },
    fs: {
      workerLivenessVerdict: vi.fn((): LivenessVerdict | null => null),
      resolveIterDir: vi.fn(() => null),
      teardownIterDir: vi.fn(async () => {}),
      parkedSlotWork: vi.fn(() => ({ workers: [], supervisorLogPath: ".red/tmp/afk-supervisor.log" })),
      removeDir: vi.fn(async () => {}),
    },
    gh: {
      comment: vi.fn(async () => {}),
      editLabels: vi.fn(async () => {}),
      ensureRunnerErrorLabel: vi.fn(async () => {}),
      ensureLabel: vi.fn(async () => {}),
      readyQueueDepth: vi.fn(over.readyQueueDepth ?? (async () => 0)),
    },
    now: vi.fn(() => NOW),
    log,
    ...(hasBoot ? { bootSweeps } : {}),
  };
  return { deps, spawnSlot, bootSweeps, log, order };
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body, "utf8");
  chmodSync(path, 0o755);
}

function makeBootFixtureRepo(): { root: string; restore: () => void } {
  const root = mkdtempSync(join(tmpdir(), "afk-operational-probe-"));
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });

  writeExecutable(
    join(bin, "gh"),
    `#!/bin/sh
case "$1 $2" in
  "--version ") echo "gh version 2.0.0"; exit 0 ;;
  "auth status") exit 0 ;;
  "repo view") echo "reddb-io/red-skills"; exit 0 ;;
  "issue list") echo "[]"; exit 0 ;;
esac
echo "[]" 
exit 0
`,
  );
  writeExecutable(
    join(bin, "pnpm"),
    `#!/bin/sh
echo "11.5.0"
exit 0
`,
  );
  writeExecutable(
    join(bin, "git"),
    `#!/bin/sh
if [ "$1" = "remote" ] && [ "$2" = "-v" ]; then
  echo "origin https://github.com/reddb-io/red-skills.git (fetch)"
  echo "origin https://github.com/reddb-io/red-skills.git (push)"
  exit 0
fi
if [ "$1" = "ls-remote" ]; then
  exit 0
fi
exec /usr/bin/git "$@"
`,
  );

  execFileSync("/usr/bin/git", ["init", "-b", "main"], { cwd: root });
  execFileSync("/usr/bin/git", ["config", "user.email", "fixture@example.com"], { cwd: root });
  execFileSync("/usr/bin/git", ["config", "user.name", "Fixture"], { cwd: root });
  writeFileSync(join(root, "README.md"), "fixture\n", "utf8");
  execFileSync("/usr/bin/git", ["add", "README.md"], { cwd: root });
  execFileSync("/usr/bin/git", ["commit", "-m", "init"], { cwd: root });
  execFileSync("/usr/bin/git", ["remote", "add", "origin", "https://github.com/reddb-io/red-skills.git"], { cwd: root });

  const oldPath = process.env.PATH;
  const oldGithubActions = process.env.GITHUB_ACTIONS;
  const oldLane = process.env.RED_AFK_LANE;
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  delete process.env.GITHUB_ACTIONS;
  delete process.env.RED_AFK_LANE;

  return {
    root,
    restore: () => {
      process.env.PATH = oldPath;
      if (oldGithubActions === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = oldGithubActions;
      if (oldLane === undefined) delete process.env.RED_AFK_LANE;
      else process.env.RED_AFK_LANE = oldLane;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("runSupervisor — supervisor owns the boot (#623)", () => {
  it("runs bootSweeps exactly once, before the initial fleet spawn", async () => {
    const { deps, spawnSlot, bootSweeps, order } = makeDeps();
    const state = initSupervisorState(2);

    await runSupervisor(state, deps, config({ target: 2 }), () => true);

    expect(bootSweeps).toHaveBeenCalledTimes(1);
    expect(spawnSlot).toHaveBeenCalledTimes(2);
    // The single boot strictly precedes every spawn.
    expect(order).toEqual(["boot", "spawn", "spawn"]);
  });

  it("does not re-run bootSweeps when a worker dies and the slot respawns", async () => {
    // Slot worker pid is reported dead from tick 1 onward → handleDeadSlot
    // respawns it (clean queue has work). bootSweeps must NOT fire again.
    const { deps, spawnSlot, bootSweeps } = makeDeps({
      isAlive: vi.fn(() => false),
      lastExitCode: vi.fn(() => 0), // clean exit + queue>0 → respawn, not park.
      readyQueueDepth: vi.fn(async () => 3),
    });
    const state = initSupervisorState(1);

    // Stop on the 2nd probe: tick 1 respawns the dead slot, then stop.
    let probes = 0;
    const stop = () => ++probes >= 2;

    await runSupervisor(state, deps, config({ target: 1, pollIntervalS: 15 }), stop);

    // Boot ran once for the whole lifetime; the slot spawned initial + respawn.
    expect(bootSweeps).toHaveBeenCalledTimes(1);
    expect(spawnSlot.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("spawns the fleet even when bootSweeps throws (best-effort, logged)", async () => {
    const { deps, spawnSlot, log } = makeDeps({
      bootSweeps: vi.fn(async () => {
        throw new Error("gh down");
      }),
    });
    const state = initSupervisorState(1);

    await runSupervisor(state, deps, config({ target: 1 }), () => true);

    expect(spawnSlot).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.some((c) => String(c[0]).includes("boot sweeps failed"))).toBe(true);
  });

  it("refuses the fleet when bootSweeps raises a red operational probe", async () => {
    const report: OperationalProbeReport = {
      schema_version: "red.dev.operational_probes.v1",
      status: "red",
      probes: [
        {
          probe: "https-git-remote",
          name: "Git remotes must use SSH for AFK",
          status: "red",
          evidence: "https remotes: https://github.com/reddb-io/red-skills.git",
          canonicalFix: "Set each GitHub HTTPS remote to its SSH URL.",
          fixGate: "confirm",
        },
      ],
    };
    const { deps, spawnSlot, log } = makeDeps({
      bootSweeps: vi.fn(async () => {
        throw new OperationalProbeHaltError(report);
      }),
    });
    const state = initSupervisorState(1);

    await runSupervisor(state, deps, config({ target: 1 }), () => true);

    expect(spawnSlot).not.toHaveBeenCalled();
    const line = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(line).toContain("Git remotes must use SSH for AFK");
    expect(line).toContain("Canonical fix");
  });

  it("live boot invocation refuses a fixture repo with a red operational probe", async () => {
    const fixture = makeBootFixtureRepo();
    try {
      const bootLog: string[] = [];
      const { deps, spawnSlot, log } = makeDeps({
        bootSweeps: buildSupervisorBootSweeps(
          fixture.root,
          "reddb-io/red-skills",
          (line) => bootLog.push(line),
        ),
      });
      const state = initSupervisorState(1);

      await runSupervisor(state, deps, config({ target: 1 }), () => true);

      expect(spawnSlot).not.toHaveBeenCalled();
      expect(bootLog).toEqual([]);
      const line = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(line).toContain("Git remotes must use SSH for AFK");
      expect(line).toContain("Canonical fix");
    } finally {
      fixture.restore();
    }
  });

  it("spawns normally when no bootSweeps is wired (back-compat)", async () => {
    const { deps, spawnSlot, bootSweeps } = makeDeps({ bootSweeps: undefined });
    const state = initSupervisorState(1);

    await runSupervisor(state, deps, config({ target: 1 }), () => true);

    expect(bootSweeps).not.toHaveBeenCalled();
    expect(spawnSlot).toHaveBeenCalledTimes(1);
  });
});
