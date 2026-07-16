import { describe, expect, it } from "vitest";
import {
  classifyIssueClaims,
  planStaleClaimSweep,
} from "../src/core/claim-staleness.js";
import type { ClaimRecord } from "../src/core/claim.js";

function claim(commentId: number, worker: string, createdAt = "2026-01-01T00:00:00Z"): ClaimRecord {
  return {
    commentId,
    worker,
    kind: "claim",
    createdAt,
  };
}

describe("classifyIssueClaims", () => {
  it("a single owner without a dead verdict is the live owner", () => {
    const st = classifyIssueClaims([claim(10, "live:host")], () => false);
    expect(st).toEqual({ liveOwner: "live:host", staleOwners: [] });
  });

  it("a single owner with a dead verdict has no live owner", () => {
    const st = classifyIssueClaims([claim(10, "dead:host")], (record) => record.worker === "dead:host");
    expect(st).toEqual({ liveOwner: null, staleOwners: ["dead:host"] });
  });

  it("a live contender holds the issue even when an older claimant is dead", () => {
    const st = classifyIssueClaims(
      [claim(10, "dead:host"), claim(20, "live:host")],
      (record) => record.worker === "dead:host",
    );
    expect(st.liveOwner).toBe("live:host");
    expect(st.staleOwners).toEqual(["dead:host"]);
  });

  it("the earliest live claim wins as the owner", () => {
    const st = classifyIssueClaims([claim(30, "b:host"), claim(10, "a:host")], () => false);
    expect(st.liveOwner).toBe("a:host");
  });

  it("a worker that conceded after a dead claim is not counted", () => {
    const records: ClaimRecord[] = [
      claim(10, "gone:host"),
      { commentId: 40, worker: "gone:host", kind: "concede" },
    ];
    const st = classifyIssueClaims(records, (record) => record.worker === "gone:host");
    expect(st).toEqual({ liveOwner: null, staleOwners: [] });
  });
});

describe("planStaleClaimSweep", () => {
  it("does not release an ancient claim without a dead-owner verdict", () => {
    const releases = planStaleClaimSweep([
      { issue: 7, records: [claim(10, "quiet:host", "2020-01-01T00:00:00Z")] },
    ]);
    expect(releases).toEqual([]);
  });

  it("releases an issue held only by a dead-owner claim", () => {
    const releases = planStaleClaimSweep([
      { issue: 7, records: [claim(10, "dead:host")], deadOwners: ["dead:host"] },
    ]);
    expect(releases).toEqual([{ issue: 7, staleOwners: ["dead:host"] }]);
  });

  it("never releases when a live claim coexists with a dead-owner claim", () => {
    const releases = planStaleClaimSweep([
      {
        issue: 7,
        records: [claim(10, "dead:host"), claim(20, "live:host")],
        deadOwners: ["dead:host"],
      },
    ]);
    expect(releases).toEqual([]);
  });

  it("releases only issues whose active owners all have dead verdicts", () => {
    const releases = planStaleClaimSweep([
      { issue: 1, records: [claim(10, "dead:1")], deadOwners: ["dead:1"] },
      { issue: 2, records: [claim(10, "live:2")] },
      { issue: 3, records: [claim(10, "dead:3")], deadOwners: ["dead:3"] },
      { issue: 4, records: [] },
    ]);
    expect(releases).toEqual([
      { issue: 1, staleOwners: ["dead:1"] },
      { issue: 3, staleOwners: ["dead:3"] },
    ]);
  });

  it("ignores branch-age evidence; liveness verdict is the only steal authority", () => {
    const releases = planStaleClaimSweep([
      {
        issue: 7,
        records: [claim(10, "quiet-work:host", "2020-01-01T00:00:00Z")],
      },
    ]);
    expect(releases).toEqual([]);
  });
});
