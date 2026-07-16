// Claim recovery planning for the ADR 0066 claim-comment substrate.
//
// The claim comment remains the cross-host ordering truth, but steal/release is
// no longer derived from wall-clock age. A claimant is recoverable only when the
// tracker/supervisor layer supplies an explicit dead-owner verdict.

import type { ClaimRecord } from "./claim.js";

/** The folded claim state of a single issue. */
export interface IssueClaimState {
  /** The winning worker among owners not proven dead, or null when none remain. */
  liveOwner: string | null;
  /** Active claimants rejected by the injected supervisor liveness verdict. */
  staleOwners: string[];
}

/**
 * Fold an issue's claim records into its live owner + dead owners (pure). A
 * worker's latest marker decides whether it still contends (a `concede`
 * withdraws it); its earliest `claim` id is its order key. The live owner is the
 * lowest order key among contenders whose owner was not rejected by the injected
 * liveness verdict.
 */
export function classifyIssueClaims(
  records: readonly ClaimRecord[],
  isDeadOwner: (record: ClaimRecord) => boolean,
): IssueClaimState {
  interface Fold {
    earliestClaimId: number | null;
    latestId: number;
    latestKind: "claim" | "concede";
    latestRecord: ClaimRecord;
  }
  const folds = new Map<string, Fold>();
  for (const r of records) {
    if (!Number.isFinite(r.commentId) || r.worker === "") continue;
    const f = folds.get(r.worker);
    if (f === undefined) {
      folds.set(r.worker, {
        earliestClaimId: r.kind === "claim" ? r.commentId : null,
        latestId: r.commentId,
        latestKind: r.kind,
        latestRecord: r,
      });
      continue;
    }
    if (r.kind === "claim" && (f.earliestClaimId === null || r.commentId < f.earliestClaimId)) {
      f.earliestClaimId = r.commentId;
    }
    if (r.commentId >= f.latestId) {
      f.latestId = r.commentId;
      f.latestKind = r.kind;
      f.latestRecord = r;
    }
  }

  let liveOwner: string | null = null;
  let liveOwnerId = Infinity;
  const staleOwners: string[] = [];
  for (const [worker, f] of folds) {
    if (f.latestKind === "concede") continue;
    if (f.earliestClaimId === null) continue;
    if (isDeadOwner(f.latestRecord)) {
      staleOwners.push(worker);
      continue;
    }
    if (f.earliestClaimId < liveOwnerId) {
      liveOwnerId = f.earliestClaimId;
      liveOwner = worker;
    }
  }
  staleOwners.sort();
  return { liveOwner, staleOwners };
}

/** One claimed issue handed to the sweep: the issue number + its parsed claim
 * marker records (from `parseClaimRecords`). */
export interface ClaimedIssue {
  issue: number;
  records: readonly ClaimRecord[];
  /** Claim owners proven dead by the supervisor/tracker liveness verdict. */
  deadOwners?: readonly string[];
}

/** A planned release: the issue to return to the executable pool + the owners
 * whose dead claim it recovered (for the audit comment). */
export interface StaleClaimRelease {
  issue: number;
  staleOwners: string[];
}

/** Render the single audit comment the boot sweep posts when it releases an
 * issue whose owner was proven dead by the supervisor liveness verdict. */
export function renderStaleClaimSweepAudit(staleOwners: readonly string[]): string {
  const who = staleOwners.map((w) => `\`${w}\``).join(", ");
  return (
    `🤖 AFK claim sweep: released this issue back to \`ready-for-agent\` — ` +
    `${staleOwners.length === 1 ? "the claim" : "the claims"} held by ${who} ` +
    `had a dead-owner liveness verdict.`
  );
}

/** Render the audit comment for an immediate same-host ghost-claim release. */
export function renderDeadClaimSweepAudit(staleOwners: readonly string[]): string {
  const who = staleOwners.map((w) => `\`${w}\``).join(", ");
  return (
    `🤖 AFK same-host ghost-claim sweep: released this issue back to \`ready-for-agent\` — ` +
    `${staleOwners.length === 1 ? "the claim" : "the claims"} held by ${who} had a dead \`worker.pid\`.`
  );
}

/**
 * Plan which claimed issues to release back to the executable pool (pure). An
 * issue is released only when every active claimant has an explicit dead-owner
 * verdict. Old timestamps, missing refreshes, and branch age do not release a
 * claim.
 */
export function planStaleClaimSweep(claimed: readonly ClaimedIssue[]): StaleClaimRelease[] {
  const releases: StaleClaimRelease[] = [];
  for (const c of claimed) {
    const deadOwners = new Set(c.deadOwners ?? []);
    const state = classifyIssueClaims(c.records, (record) => deadOwners.has(record.worker));
    if (state.liveOwner === null && state.staleOwners.length > 0) {
      releases.push({ issue: c.issue, staleOwners: state.staleOwners });
    }
  }
  return releases;
}
