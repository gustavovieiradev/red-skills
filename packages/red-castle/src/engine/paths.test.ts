import { describe, expect, it } from "vitest";
import { createEnginePaths } from "./paths.js";

describe("EnginePaths", () => {
  it("resolves every castle lane from an injected .red root", () => {
    const paths = createEnginePaths("/repo/.red");

    expect(paths.redRoot).toBe("/repo/.red");
    expect(paths.stateRoot).toBe("/repo/.red/state/castle");
    expect(paths.history).toBe("/repo/.red/state/castle/history.toonl");
    expect(paths.tmpRoot).toBe("/repo/.red/tmp");
    expect(paths.supervisorsRoot).toBe("/repo/.red/tmp/supervisors");
    expect(paths.workersRoot).toBe("/repo/.red/tmp/workers");
    expect(paths.monitorsRoot).toBe("/repo/.red/tmp/monitors");
    expect(paths.worktreesRoot).toBe("/repo/.red/tmp/worktrees");
    expect(paths.workerWorktreesRoot).toBe("/repo/.red/tmp/worktrees/workers");
    expect(paths.config).toBe("/repo/.red/config.yaml");
  });

  it("resolves entity paths without hardcoded roots", () => {
    const paths = createEnginePaths("/workspace/custom/.red");

    expect(paths.supervisor("s1").root).toBe("/workspace/custom/.red/tmp/supervisors/s1");
    expect(paths.supervisor("s1").state).toBe("/workspace/custom/.red/tmp/supervisors/s1/state.toon");
    expect(paths.supervisor("s1").lane).toBe("/workspace/custom/.red/tmp/supervisors/s1/lane.toonl");

    expect(paths.worker("w9GOF").root).toBe("/workspace/custom/.red/tmp/workers/w9GOF");
    expect(paths.worker("w9GOF").state).toBe("/workspace/custom/.red/tmp/workers/w9GOF/state.toon");
    expect(paths.worker("w9GOF").lane).toBe("/workspace/custom/.red/tmp/workers/w9GOF/worker.log.toonl");
    expect(paths.worker("w9GOF").liveness).toBe("/workspace/custom/.red/tmp/workers/w9GOF/liveness.toonl");

    expect(paths.monitor("m1").root).toBe("/workspace/custom/.red/tmp/monitors/m1");
    expect(paths.workerWorktree("w9GOF", 1904)).toBe(
      "/workspace/custom/.red/tmp/worktrees/workers/w9GOF-1904",
    );
  });
});
