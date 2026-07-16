import type { TrackerPort } from "./port.js";

export type { TrackerPort } from "./port.js";

export const TRACKER_CLAIM_MARKER_VERSION = 1;

export type TrackerClaimKind = "claim" | "concede";

export interface RawTrackerClaimComment {
  readonly id: number;
  readonly body: string;
  readonly createdAt?: string;
}

export interface TrackerClaimRecord {
  readonly commentId: number;
  readonly worker: string;
  readonly kind: TrackerClaimKind;
  readonly runner?: string;
  readonly createdAt?: string;
}

export interface TrackerClaimSelf {
  readonly worker: string;
  readonly commentId: number;
  readonly runner?: string;
  readonly createdAt?: string;
}

export interface TrackerClaimDecision {
  readonly verdict: "won" | "lost";
  readonly winner: string | null;
  readonly reason: string;
  readonly winnerClaimId?: number;
  readonly recovered: readonly string[];
}

export interface TrackerClaimReconcileOptions {
  readonly isClaimantLive?: (claim: TrackerClaimRecord) => boolean;
}

export interface LocalIssueLeasePort {
  acquire(issue: number): Promise<boolean>;
  release(issue: number): Promise<void>;
}

export interface AcquireDualLeaseClaimOptions {
  readonly issue: number;
  readonly lease: LocalIssueLeasePort;
  readonly tracker: TrackerPort;
  readonly self: {
    readonly worker: string;
    readonly runner?: string;
    readonly createdAt?: string;
  };
  readonly liveness?: TrackerClaimReconcileOptions;
}

export interface DualLeaseClaimHandle {
  readonly decision: TrackerClaimDecision;
  retire(): Promise<void>;
}

const MARKER_OPEN = "<!-- afk:claim";
const MARKER_RE = /<!--\s*afk:claim\s+([^>]*?)\s*-->/g;

function escapeField(value: string): string {
  return value.replace(/[\s>]/g, "_");
}

export function renderTrackerClaimComment(
  self: { readonly worker: string; readonly runner?: string; readonly createdAt?: string },
  kind: TrackerClaimKind = "claim",
): string {
  const fields = [
    `v${TRACKER_CLAIM_MARKER_VERSION}`,
    `worker=${escapeField(self.worker)}`,
    `kind=${kind}`,
  ];
  if (self.runner) fields.push(`runner=${escapeField(self.runner)}`);
  if (self.createdAt) fields.push(`ts=${escapeField(self.createdAt)}`);
  const human =
    kind === "claim"
      ? `🤖 AFK claim by worker \`${self.worker}\`${self.runner ? ` (runner \`${self.runner}\`)` : ""}.`
      : `🤖 AFK worker \`${self.worker}\` conceded this issue (lost the claim race or released).`;
  return `${MARKER_OPEN} ${fields.join(" ")} -->\n${human}`;
}

function parseFields(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const token of raw.split(/\s+/)) {
    const equals = token.indexOf("=");
    if (equals <= 0) continue;
    out.set(token.slice(0, equals), token.slice(equals + 1));
  }
  return out;
}

export function parseTrackerClaimRecords(comments: readonly RawTrackerClaimComment[]): TrackerClaimRecord[] {
  const records: TrackerClaimRecord[] = [];
  for (const comment of comments) {
    if (!Number.isFinite(comment.id) || typeof comment.body !== "string") continue;
    MARKER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKER_RE.exec(comment.body)) !== null) {
      const fields = parseFields(match[1] ?? "");
      const worker = fields.get("worker");
      if (!worker) continue;
      const kind = fields.get("kind") === "concede" ? "concede" : "claim";
      records.push({
        commentId: comment.id,
        worker,
        kind,
        runner: fields.get("runner"),
        createdAt: fields.get("ts") ?? comment.createdAt,
      });
    }
  }
  return records;
}

export function reconcileTrackerClaims(
  records: readonly TrackerClaimRecord[],
  self: TrackerClaimSelf,
  options: TrackerClaimReconcileOptions = {},
): TrackerClaimDecision {
  const isClaimantLive = options.isClaimantLive ?? (() => true);
  interface Fold {
    earliestClaimId: number | null;
    latestId: number;
    latestKind: TrackerClaimKind;
    latestRecord: TrackerClaimRecord;
  }

  const folds = new Map<string, Fold>();
  const ingest = (record: TrackerClaimRecord) => {
    if (!Number.isFinite(record.commentId) || record.worker === "") return;
    const existing = folds.get(record.worker);
    if (!existing) {
      folds.set(record.worker, {
        earliestClaimId: record.kind === "claim" ? record.commentId : null,
        latestId: record.commentId,
        latestKind: record.kind,
        latestRecord: record,
      });
      return;
    }
    if (record.kind === "claim" && (existing.earliestClaimId === null || record.commentId < existing.earliestClaimId)) {
      existing.earliestClaimId = record.commentId;
    }
    if (record.commentId >= existing.latestId) {
      existing.latestId = record.commentId;
      existing.latestKind = record.kind;
      existing.latestRecord = record;
    }
  };

  for (const record of records) ingest(record);
  ingest({
    commentId: self.commentId,
    worker: self.worker,
    kind: "claim",
    runner: self.runner,
    createdAt: self.createdAt,
  });

  const contenders: Array<{ worker: string; claimId: number }> = [];
  const notLive: Array<{ worker: string; claimId: number }> = [];
  for (const [worker, fold] of folds) {
    if (fold.latestKind === "concede" || fold.earliestClaimId === null) continue;
    if (!isClaimantLive(fold.latestRecord)) {
      notLive.push({ worker, claimId: fold.earliestClaimId });
      continue;
    }
    contenders.push({ worker, claimId: fold.earliestClaimId });
  }

  if (contenders.length === 0) {
    return { verdict: "lost", winner: null, reason: "no live claim contends", recovered: [] };
  }

  contenders.sort((a, b) => a.claimId - b.claimId || (a.worker < b.worker ? -1 : 1));
  const winner = contenders[0]!;
  const recovered =
    winner.worker === self.worker
      ? notLive.filter((claim) => claim.claimId < winner.claimId).map((claim) => claim.worker).sort()
      : [];

  if (winner.worker === self.worker) {
    return {
      verdict: "won",
      winner: winner.worker,
      winnerClaimId: winner.claimId,
      reason: contenders.length === 1 ? "solo claim" : `earliest of ${contenders.length} live claims (id ${winner.claimId})`,
      recovered,
    };
  }

  return {
    verdict: "lost",
    winner: winner.worker,
    winnerClaimId: winner.claimId,
    reason: `worker ${winner.worker} holds earlier claim (id ${winner.claimId} < our ${self.commentId})`,
    recovered: [],
  };
}

export async function acquireDualLeaseClaim(options: AcquireDualLeaseClaimOptions): Promise<DualLeaseClaimHandle> {
  const { issue, lease, tracker, self } = options;
  if (!(await lease.acquire(issue))) {
    return {
      decision: { verdict: "lost", winner: null, reason: "local lease held", recovered: [] },
      async retire() {},
    };
  }

  let ownsLocalLease = true;
  let ownsTrackerClaim = false;
  const releaseLocal = async () => {
    if (!ownsLocalLease) return;
    ownsLocalLease = false;
    await lease.release(issue);
  };
  const concedeTracker = async () => {
    if (!ownsTrackerClaim) return;
    await tracker.concedeIssueClaim(issue, renderTrackerClaimComment(self, "concede"));
    ownsTrackerClaim = false;
  };

  let decision: TrackerClaimDecision;
  try {
    const commentId = await tracker.postIssueClaim(issue, renderTrackerClaimComment(self, "claim"));
    const records = await tracker.listIssueClaims(issue);
    decision = reconcileTrackerClaims(records, { ...self, commentId }, options.liveness);
  } catch (error) {
    await releaseLocal();
    throw error;
  }

  if (decision.verdict === "lost") {
    try {
      await tracker.concedeIssueClaim(issue, renderTrackerClaimComment(self, "concede"));
    } finally {
      await releaseLocal();
    }
    return { decision, retire: async () => {} };
  }

  ownsTrackerClaim = true;
  return {
    decision,
    async retire() {
      try {
        await concedeTracker();
      } finally {
        await releaseLocal();
      }
    },
  };
}
