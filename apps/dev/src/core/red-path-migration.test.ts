import { describe, expect, it } from "vitest";
import {
  legacyMonitorCursorMigrations,
  legacySupervisorRestartMigrations,
  legacySupervisorStateMigrations,
  migrationActionFor,
  planDevDurablePathMigration,
  supervisorLogMigration,
} from "./red-path-migration.js";

const ROOT = "/repo";

describe("planDevDurablePathMigration", () => {
  const plan = planDevDurablePathMigration(ROOT);
  const byId = new Map(plan.map((e) => [e.id, e]));

  it("maps live supervisor artifacts from .red/tmp to tmp/supervisors/fleet", () => {
    expect(byId.get("afk-supervisor.pid")?.current).toBe("/repo/.red/tmp/supervisors/fleet/afk-supervisor.pid");
    expect(byId.get("afk-supervisor-boot.pid")?.current).toBe("/repo/.red/tmp/supervisors/fleet/afk-supervisor-boot.pid");
    expect(byId.get("afk-supervisor.stop")?.current).toBe("/repo/.red/tmp/supervisors/fleet/afk-supervisor.stop");
    expect(byId.get("afk-history.toonl")).toMatchObject({
      legacy: "/repo/.red/state/afk-history.toonl",
      current: "/repo/.red/state/castle/history.toonl",
      kind: "file",
    });
  });

  it("relocates runner circuit directories into state/castle", () => {
    expect(byId.get("runner-circuit")).toMatchObject({
      legacy: "/repo/.red/tmp/runner-circuit",
      current: "/repo/.red/state/castle/runner-circuit",
      kind: "dir",
    });
    expect(byId.get("state/afk/runner-circuit")).toMatchObject({
      legacy: "/repo/.red/state/afk/runner-circuit",
      current: "/repo/.red/state/castle/runner-circuit",
      kind: "dir",
    });
  });

  it("retires the legacy state/afk supervisor lane into tmp/supervisors", () => {
    expect(byId.get("state/afk/afk-supervisor.pid")).toMatchObject({
      legacy: "/repo/.red/state/afk/afk-supervisor.pid",
      current: "/repo/.red/tmp/supervisors/fleet/afk-supervisor.pid",
      kind: "file",
    });
  });

  it("plans transformed legacy supervisor state/cursors/restarts separately", () => {
    expect(legacySupervisorStateMigrations(ROOT).map((e) => e.current)).toEqual([
      "/repo/.red/state/castle/supervisors/fleet/state.toon",
      "/repo/.red/state/castle/supervisors/fleet/state.toon",
      "/repo/.red/state/castle/supervisors/fleet/state.toon",
    ]);
    expect(legacyMonitorCursorMigrations(ROOT).map((e) => e.current)).toEqual([
      "/repo/.red/tmp/monitors/default/log-cursors.toon",
      "/repo/.red/tmp/monitors/default/log-cursors.toon",
      "/repo/.red/tmp/monitors/default/log-cursors.toon",
    ]);
    expect(legacySupervisorRestartMigrations(ROOT).map((e) => e.current)).toEqual([
      "/repo/.red/tmp/supervisors/fleet/restarts.toon",
      "/repo/.red/tmp/supervisors/fleet/restarts.toon",
      "/repo/.red/tmp/supervisors/fleet/restarts.toon",
    ]);
  });

  it("relocates statusline caches into the statusline state lane", () => {
    expect(byId.get("statusline-cache.json")?.current).toBe("/repo/.red/state/statusline/statusline-cache.toon");
    expect(byId.get("statusline-repo-cache.json")?.current).toBe(
      "/repo/.red/state/statusline/statusline-repo-cache.toon",
    );
    expect(byId.get("state/statusline-cache.json")).toMatchObject({
      legacy: "/repo/.red/state/statusline/statusline-cache.json",
      current: "/repo/.red/state/statusline/statusline-cache.toon",
    });
    expect(byId.get("state/statusline-repo-cache.json")).toMatchObject({
      legacy: "/repo/.red/state/statusline/statusline-repo-cache.json",
      current: "/repo/.red/state/statusline/statusline-repo-cache.toon",
    });
  });

  it("does not migrate the branch lock (its shell writer still owns tmp)", () => {
    expect(byId.has("branch-lock.yaml")).toBe(false);
  });

  it("never sources from outside .red/tmp or .red/state nor targets outside .red", () => {
    for (const entry of plan) {
      expect(entry.legacy.startsWith("/repo/.red/tmp/") || entry.legacy.startsWith("/repo/.red/state/")).toBe(true);
      expect(entry.current.startsWith("/repo/.red/state") || entry.current.startsWith("/repo/.red/tmp/")).toBe(true);
    }
  });
});

describe("supervisorLogMigration", () => {
  it("globs the rotated supervisor logs from tmp into tmp/supervisors/fleet", () => {
    expect(supervisorLogMigration(ROOT)).toEqual({
      legacyDir: "/repo/.red/tmp",
      currentDir: "/repo/.red/tmp/supervisors/fleet",
      logPrefix: "afk-supervisor.log",
    });
  });
});

describe("migrationActionFor", () => {
  it("moves when only the legacy copy exists", () => {
    expect(migrationActionFor(true, false)).toBe("move");
  });

  it("is ambiguous (delete nothing) when both exist", () => {
    expect(migrationActionFor(true, true)).toBe("ambiguous");
  });

  it("is a no-op when the legacy copy is gone (idempotent second boot)", () => {
    expect(migrationActionFor(false, false)).toBe("absent");
    expect(migrationActionFor(false, true)).toBe("absent");
  });
});
