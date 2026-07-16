import { describe, expect, it } from "vitest";
import {
  acquireDualLeaseClaim,
  parseTrackerClaimRecords,
  reconcileTrackerClaims,
  renderTrackerClaimComment,
  type LocalIssueLeasePort,
  type TrackerClaimRecord,
  type TrackerPort,
} from "./claim.js";

function record(commentId: number, worker: string, kind: "claim" | "concede" = "claim"): TrackerClaimRecord {
  return { commentId, worker, kind };
}

function fakeLease(acquired: boolean): LocalIssueLeasePort & { released: number[] } {
  const released: number[] = [];
  return {
    released,
    async acquire() {
      return acquired;
    },
    async release(issue) {
      released.push(issue);
    },
  };
}

function fakeTracker(existing: TrackerClaimRecord[] = []): TrackerPort & { comments: string[] } {
  let nextId = Math.max(0, ...existing.map((r) => r.commentId)) + 1;
  const records = [...existing];
  const comments: string[] = [];
  return {
    comments,
    async listOpenIssuesByLabel() {
      return [];
    },
    async isIssueClosed() {
      return false;
    },
    async editIssueLabels() {},
    async commentOnIssue(_issue, body) {
      comments.push(body);
    },
    async postIssueClaim(issue, body) {
      await this.commentOnIssue(issue, body);
      const commentId = nextId++;
      records.push(...parseTrackerClaimRecords([{ id: commentId, body }]));
      return commentId;
    },
    async listIssueClaims() {
      return records;
    },
    async concedeIssueClaim(issue, body) {
      await this.commentOnIssue(issue, body);
      const commentId = nextId++;
      records.push(...parseTrackerClaimRecords([{ id: commentId, body }]));
    },
  };
}

describe("tracker claim comments", () => {
  it("preserves the ADR 0066 claim-comment marker format", () => {
    const body = renderTrackerClaimComment({ worker: "host:w1", runner: "codex" }, "claim");
    expect(body).toContain("<!-- afk:claim v1 worker=host:w1 kind=claim runner=codex -->");
    expect(parseTrackerClaimRecords([{ id: 42, body }])).toEqual([
      { commentId: 42, worker: "host:w1", kind: "claim", runner: "codex", createdAt: undefined },
    ]);
  });
});

describe("reconcileTrackerClaims", () => {
  it("requires an injected liveness verdict to steal an earlier claim", () => {
    const records = [record(10, "other"), record(50, "self")];
    expect(reconcileTrackerClaims(records, { worker: "self", commentId: 50 }).verdict).toBe("lost");

    const stolen = reconcileTrackerClaims(records, { worker: "self", commentId: 50 }, {
      isClaimantLive: (claim) => claim.worker !== "other",
    });

    expect(stolen).toMatchObject({ verdict: "won", winner: "self", recovered: ["other"] });
  });
});

describe("acquireDualLeaseClaim", () => {
  it("stops at the local lease fast path when another same-host worker holds it", async () => {
    const lease = fakeLease(false);
    const tracker = fakeTracker();

    const result = await acquireDualLeaseClaim({ issue: 7, lease, tracker, self: { worker: "self" } });

    expect(result.decision).toMatchObject({ verdict: "lost", reason: "local lease held" });
    expect(tracker.comments).toEqual([]);
    expect(lease.released).toEqual([]);
  });

  it("concedes the tracker claim and releases the local lease on graceful retire", async () => {
    const lease = fakeLease(true);
    const tracker = fakeTracker();

    const result = await acquireDualLeaseClaim({ issue: 7, lease, tracker, self: { worker: "self", runner: "codex" } });
    expect(result.decision.verdict).toBe("won");

    await result.retire();

    expect(tracker.comments.some((body) => body.includes("kind=concede"))).toBe(true);
    expect(lease.released).toEqual([7]);
  });
});
