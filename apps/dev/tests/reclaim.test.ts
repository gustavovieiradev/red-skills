import { describe, expect, it } from "vitest";
import {
  ORPHAN_TTL_LONG_S,
  ORPHAN_TTL_SHORT_S,
  decideOrphanFate,
  planAttemptCap,
  planLivenessReclaim,
  type AttemptDir,
  type LivenessReclaimInput,
  type OrphanFate,
  type OrphanInput,
} from "../src/core/reclaim.js";

const DAY = 86400;
const NOW = 1700000000;

/** Build a minimal orphan input, overriding only the fields under test. */
function orphan(over: Partial<OrphanInput>): OrphanInput {
  return {
    issueState: "OPEN",
    label: null,
    envelopePosted: false,
    hasStateFile: true,
    ageS: 0,
    ghOk: true,
    ...over,
  };
}

describe("decideOrphanFate", () => {
  it("CLOSED issue is removed immediately", () => {
    expect(decideOrphanFate(orphan({ issueState: "CLOSED" }))).toEqual<OrphanFate>({
      kind: "remove",
    });
  });

  it("ready-for-human with envelope.posted=true uses the 1-day split TTL", () => {
    expect(
      decideOrphanFate(orphan({ issueState: "OPEN", label: "ready-for-human", envelopePosted: true })),
    ).toEqual<OrphanFate>({ kind: "keep-until", ttlS: ORPHAN_TTL_SHORT_S });
    expect(ORPHAN_TTL_SHORT_S).toBe(1 * DAY);
  });

  it("ready-for-human with envelope.posted=false uses the 7-day split TTL", () => {
    expect(
      decideOrphanFate(orphan({ issueState: "OPEN", label: "ready-for-human", envelopePosted: false })),
    ).toEqual<OrphanFate>({ kind: "keep-until", ttlS: ORPHAN_TTL_LONG_S });
    expect(ORPHAN_TTL_LONG_S).toBe(7 * DAY);
  });

  it("running issue (crashed mid-issue) restores the queue then removes the dir", () => {
    expect(
      decideOrphanFate(orphan({ issueState: "OPEN", label: "running" })),
    ).toEqual<OrphanFate>({ kind: "restore-and-remove" });
  });

  it("any other open state is removed", () => {
    expect(decideOrphanFate(orphan({ issueState: "OPEN", label: "needs-triage" }))).toEqual<OrphanFate>({
      kind: "remove",
    });
    expect(decideOrphanFate(orphan({ issueState: "OPEN", label: null }))).toEqual<OrphanFate>({
      kind: "remove",
    });
  });

  it("CLOSED wins even when a stale ready-for-human label is still attached", () => {
    expect(
      decideOrphanFate(orphan({ issueState: "CLOSED", label: "ready-for-human", envelopePosted: true })),
    ).toEqual<OrphanFate>({ kind: "remove" });
  });

  describe("gh-failure mtime TTL fallback", () => {
    it("with a state file → 7-day TTL", () => {
      expect(decideOrphanFate(orphan({ ghOk: false, hasStateFile: true }))).toEqual<OrphanFate>({
        kind: "keep-until",
        ttlS: ORPHAN_TTL_LONG_S,
      });
    });

    it("without a state file → 1-day TTL", () => {
      expect(decideOrphanFate(orphan({ ghOk: false, hasStateFile: false }))).toEqual<OrphanFate>({
        kind: "keep-until",
        ttlS: ORPHAN_TTL_SHORT_S,
      });
    });
  });

  it("no state file (no issue number) → 1-day TTL regardless of gh", () => {
    // A dir with no state file carries no issue number, so gh is never queried;
    // it is garbage past the short TTL. Mirrors the bash `-z issue_n` branch.
    expect(decideOrphanFate(orphan({ hasStateFile: false, ghOk: true }))).toEqual<OrphanFate>({
      kind: "keep-until",
      ttlS: ORPHAN_TTL_SHORT_S,
    });
  });
});

/** Build an issue-dir fixture under the nested worker layout. */
function attempt(worker: string, ageS: number, live = false): AttemptDir {
  return { path: `/root/workers/${worker}/42`, mtimeS: NOW - ageS, live };
}

describe("planAttemptCap", () => {
  it("reaps attempts older than the age cap, keeps the rest", () => {
    const attempts: AttemptDir[] = [
      attempt("wAAA", 20 * DAY),
      attempt("wBBB", 16 * DAY),
      attempt("wCCC", 1 * DAY),
    ];
    const reaped = planAttemptCap(attempts, { ttlS: 14 * DAY, keep: 5, nowS: NOW });
    expect(reaped.map((a) => a.path)).toEqual([
      "/root/workers/wAAA/42",
      "/root/workers/wBBB/42",
    ]);
  });

  it("reaps the oldest-by-mtime over the count cap, keeping the newest KEEP", () => {
    const attempts: AttemptDir[] = [
      attempt("wAAA", 4 * DAY),
      attempt("wBBB", 3 * DAY),
      attempt("wCCC", 2 * DAY),
      attempt("wDDD", 1 * DAY),
    ];
    const reaped = planAttemptCap(attempts, { ttlS: 14 * DAY, keep: 2, nowS: NOW });
    // Keep the newest two by mtime; drop the oldest two.
    expect(reaped.map((a) => a.path)).toEqual([
      "/root/workers/wAAA/42",
      "/root/workers/wBBB/42",
    ]);
  });

  it("count cap ranks by mtime, not worker id", () => {
    const attempts: AttemptDir[] = [
      attempt("wAAA", 1 * DAY),
      attempt("wBBB", 2 * DAY),
      attempt("wCCC", 3 * DAY),
      attempt("wDDD", 10 * DAY),
    ];
    const reaped = planAttemptCap(attempts, { ttlS: 14 * DAY, keep: 2, nowS: NOW });
    expect(reaped.map((a) => a.path)).toEqual([
      "/root/workers/wDDD/42",
      "/root/workers/wCCC/42",
    ]);
  });

  it("applies age and count caps together — age first, count over the survivors", () => {
    const attempts: AttemptDir[] = [
      attempt("wAAA", 20 * DAY), // over age cap → reaped by age
      attempt("wBBB", 3 * DAY),
      attempt("wCCC", 2 * DAY),
      attempt("wDDD", 1 * DAY),
    ];
    // After age cull, three survivors remain; keep=2 → drop the oldest survivor.
    const reaped = planAttemptCap(attempts, { ttlS: 14 * DAY, keep: 2, nowS: NOW });
    expect(reaped.map((a) => a.path)).toEqual([
      "/root/workers/wAAA/42",
      "/root/workers/wBBB/42",
    ]);
  });

  it("never counts or removes a live attempt", () => {
    const attempts: AttemptDir[] = [
      attempt("wAAA", 20 * DAY, true), // live AND over age cap → still spared
      attempt("wBBB", 1 * DAY),
      attempt("wCCC", 1 * DAY),
      attempt("wDDD", 1 * DAY, true), // live → excluded from the count too
    ];
    const reaped = planAttemptCap(attempts, { ttlS: 14 * DAY, keep: 2, nowS: NOW });
    // Live workers are excluded entirely. The two non-live survivors fit under keep=2.
    expect(reaped).toEqual([]);
  });

  it("a live attempt does not consume a keep slot", () => {
    const attempts: AttemptDir[] = [
      attempt("wAAA", 1 * DAY),
      attempt("wBBB", 1 * DAY),
      attempt("wCCC", 1 * DAY, true), // live, not counted
    ];
    // Two non-live worker issue dirs under keep=2 → nothing reaped, even though there are 3 dirs.
    const reaped = planAttemptCap(attempts, { ttlS: 14 * DAY, keep: 2, nowS: NOW });
    expect(reaped).toEqual([]);
  });

  it("ignores attempt dirs whose path does not parse under the nested layout", () => {
    const attempts: AttemptDir[] = [
      { path: "/root/garbage/not-an-attempt", mtimeS: NOW - 20 * DAY, live: false },
      attempt("wAAA", 20 * DAY),
    ];
    const reaped = planAttemptCap(attempts, { ttlS: 14 * DAY, keep: 5, nowS: NOW });
    expect(reaped.map((a) => a.path)).toEqual(["/root/workers/wAAA/42"]);
  });

  it("returns nothing when every attempt is within both caps", () => {
    const attempts: AttemptDir[] = [attempt("wAAA", 1 * DAY), attempt("wBBB", 2 * DAY)];
    expect(planAttemptCap(attempts, { ttlS: 14 * DAY, keep: 5, nowS: NOW })).toEqual([]);
  });
});

// issue #1219 PART 4: liveness-gated read-time reclaim planner.
describe("planLivenessReclaim (issue #1219)", () => {
  const input = (over: Partial<LivenessReclaimInput>): LivenessReclaimInput => ({
    attemptDir: "/r/.red/tmp/workers/wA/5",
    worktreePath: "/r/.red/tmp/workers/wA/5/worktree",
    workerPidAlive: false,
    preserved: false,
    ...over,
  });

  it("never touches a live worker's dir", () => {
    expect(planLivenessReclaim([input({ workerPidAlive: true })])).toEqual([]);
  });

  it("reclaims a dead, non-preserved worker's whole dir (worktree + dir)", () => {
    const [action] = planLivenessReclaim([input({ workerPidAlive: false, preserved: false })]);
    expect(action.removeWorktree).toBe(true);
    expect(action.reclaimDir).toBe(true);
  });

  it("removes only the worktree of a dead but preserved worker (keeps JSONL/handoff)", () => {
    const [action] = planLivenessReclaim([input({ workerPidAlive: false, preserved: true })]);
    expect(action.removeWorktree).toBe(true);
    expect(action.reclaimDir).toBe(false);
  });

  it("keeps a live worker's dir while reclaiming a sibling dead worker", () => {
    const actions = planLivenessReclaim([
      input({ attemptDir: "/r/.red/tmp/workers/wLIVE/5", workerPidAlive: true }),
      input({ attemptDir: "/r/.red/tmp/go-workers/wDEAD/6", workerPidAlive: false, preserved: false }),
    ]);
    expect(actions.map((a) => a.attemptDir)).toEqual(["/r/.red/tmp/go-workers/wDEAD/6"]);
  });
});
