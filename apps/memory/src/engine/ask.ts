import type { AskCost, MemoryStore } from "../graph-store.js";
import type { Confidence, NodeType } from "../schema.js";
import type { ConfidenceBreakdown } from "../confidence-scoring.js";
import type {
  AskContradiction,
  AskEvidence,
  AskEvidenceSummary,
  AskFederationHit,
  AskGapAnalysis,
  RecalledNode,
} from "./core.js";
import { edgeFrom, edgeLabel, edgeReason, edgeTo } from "./edges.js";

export async function composeWhatIDontKnow(
  store: MemoryStore,
  question: string,
  gapAnalysis: AskGapAnalysis,
  now?: number,
): Promise<string[]> {
  const out: string[] = [...gapAnalysis.gaps];
  try {
    const { buildReasoningReplay } = await import("../reasoning/reasoning-replay.js");
    const replay = await buildReasoningReplay(store, question, { limit: 5, now });
    for (const gap of replay.gaps) out.push(gap);
  } catch {
    /* degrade silently — ask stays zero-token by default */
  }
  try {
    const { buildLearningDebtReport } = await import("../learning-debt.js");
    const report = await buildLearningDebtReport(
      store as unknown as import("../learning-debt.js").LearningDebtStore,
      { now },
    );
    for (const debt of report.categories.repeatedFailurePatterns) {
      if (debt.hasDurableLesson) continue;
      out.push(
        `repeated-failure: ${debt.pattern} (${debt.attemptCount} attempts) — no durable lesson recorded`,
      );
    }
  } catch {
    /* degrade silently */
  }
  return [...new Set(out)];
}

export async function composeFederationHits(
  question: string,
  rootDir: string | undefined,
  now?: number,
): Promise<AskFederationHit[]> {
  if (!rootDir) return [];
  try {
    const { buildFederationReport } = await import("../federation.js");
    const report = await buildFederationReport(rootDir, question, { now });
    return report.results.map((hit) => ({
      origin_repo: hit.origin_repo,
      id: hit.id,
      score: hit.score,
      confidence_local: hit.confidence_local,
      confidence_remote: hit.confidence_remote,
      path: hit.path,
      excerpt: hit.excerpt,
    }));
  } catch {
    return [];
  }
}

export async function buildAskEvidence(
  store: MemoryStore,
  nodes: RecalledNode[],
): Promise<AskEvidenceSummary> {
  const rids = nodes.map((node) => node.rid);
  const superseded = await store.supersededByMany(rids);
  const nodeEvidence = nodes.map((node, index) => toAskEvidence(node, index + 1, superseded));
  const byRid = new Map(nodeEvidence.map((item) => [item.rid, item]));
  const contradictory: AskContradiction[] = [];

  for (const edge of await store.listEdges()) {
    if (edgeLabel(edge) !== "CONTRADICTS") continue;
    const from = byRid.get(edgeFrom(edge));
    const to = byRid.get(edgeTo(edge));
    if (!from || !to) continue;
    const resolved = from.activeRid === to.activeRid;
    contradictory.push({
      from,
      to,
      reason: edgeReason(edge),
      resolved,
      activeRid: resolved ? from.activeRid : null,
    });
  }

  return {
    active: nodeEvidence.filter((item) => item.status === "active"),
    superseded: nodeEvidence.filter((item) => item.status === "superseded"),
    contradictory,
    byConfidence: evidenceByConfidence(nodeEvidence),
  };
}

function evidenceByConfidence(items: AskEvidence[]): Record<Confidence, AskEvidence[]> {
  return {
    EXTRACTED: items.filter((item) => item.confidence === "EXTRACTED"),
    INFERRED: items.filter((item) => item.confidence === "INFERRED"),
    AMBIGUOUS: items.filter((item) => item.confidence === "AMBIGUOUS"),
  };
}

export function buildAskGapAnalysis(evidence: AskEvidenceSummary): AskGapAnalysis {
  const gaps: string[] = [];
  const nextActions: string[] = [];
  const unresolvedContradictions = evidence.contradictory.filter((item) => !item.resolved);
  const totalEvidence = evidence.active.length + evidence.superseded.length;

  if (totalEvidence === 0) {
    return {
      status: "unsupported",
      summary: "Memory has no recalled evidence for this question.",
      gaps: ["No active or superseded Memory evidence matched the question."],
      next_actions: [
        "Store a grounded project fact or bootstrap repository docs before asking again.",
      ],
    };
  }

  if (unresolvedContradictions.length > 0) {
    gaps.push(`${unresolvedContradictions.length} unresolved contradiction(s) affect the evidence.`);
    nextActions.push("Resolve or supersede the contradictory Memory nodes before relying on the answer.");
  }

  if (evidence.active.length === 0 && evidence.superseded.length > 0) {
    gaps.push("Only superseded evidence matched the question.");
    nextActions.push("Ask against the active replacement evidence or add a current Memory node.");
  }

  if (evidence.byConfidence.EXTRACTED.length === 0) {
    gaps.push("No EXTRACTED evidence supports the answer.");
    nextActions.push("Ground this answer in source-backed extracted evidence when possible.");
  }

  if (evidence.active.length === 1) {
    gaps.push("Only one active citation supports the answer.");
    nextActions.push("Add independent supporting evidence if this answer will guide a risky change.");
  }

  if (gaps.length === 0) {
    return {
      status: "grounded",
      summary: "Memory has active, non-contradictory extracted evidence for this question.",
      gaps: [],
      next_actions: [],
    };
  }

  return {
    status: unresolvedContradictions.length > 0 ? "conflicted" : "partial",
    summary:
      unresolvedContradictions.length > 0
        ? "Memory found relevant evidence, but unresolved contradictions need attention."
        : "Memory found relevant evidence, but the support is incomplete.",
    gaps,
    next_actions: [...new Set(nextActions)],
  };
}

function toAskEvidence(
  node: RecalledNode,
  marker: number,
  superseded: Map<number, number>,
): AskEvidence {
  const activeRid = activeHead(node.rid, superseded);
  return {
    citation: `[${marker}]`,
    rid: node.rid,
    label: node.label,
    node_type: node.node_type as NodeType,
    title: node.properties.title ?? node.label,
    excerpt: node.excerpt,
    confidence: node.properties.confidence ?? "AMBIGUOUS",
    source: typeof node.properties.source === "string" ? node.properties.source : null,
    status: activeRid === node.rid ? "active" : "superseded",
    activeRid,
    confidence_score: node.confidence,
    confidence_breakdown: node.confidence_breakdown as ConfidenceBreakdown | undefined,
  };
}

export function askPrompt(
  question: string,
  evidence: AskEvidenceSummary,
  gapAnalysis: AskGapAnalysis,
): string {
  return [
    "Answer the question using only the Memory evidence below.",
    "Cite every substantive claim with the evidence marker, for example [1].",
    "If the evidence does not support an answer, reply with: Insufficient evidence.",
    "Call out contradictions and superseded evidence when relevant.",
    "End with a short gap note when the gap analysis is not grounded.",
    "",
    `Question: ${question}`,
    "",
    "Active evidence:",
    ...renderAskEvidence(evidence.active),
    "",
    "Superseded evidence:",
    ...renderAskEvidence(evidence.superseded),
    "",
    "Contradictions:",
    ...renderAskContradictions(evidence.contradictory),
    "",
    "Gap analysis:",
    ...renderAskGapAnalysis(gapAnalysis),
  ].join("\n");
}

function renderAskEvidence(items: AskEvidence[]): string[] {
  if (items.length === 0) return ["(none)"];
  return items.map((item) => {
    const source = item.source ? ` source=${item.source}` : "";
    const score =
      item.confidence_score != null ? ` confidence=${item.confidence_score.toFixed(3)}` : "";
    return `${item.citation} ${item.title} (${item.confidence}; rid=${item.rid}; ${item.status}${source}${score}) ${item.excerpt}`;
  });
}

function renderAskContradictions(items: AskContradiction[]): string[] {
  if (items.length === 0) return ["(none)"];
  return items.map((item) => {
    const state = item.resolved ? `resolved active=${item.activeRid}` : "unresolved";
    const reason = item.reason ? ` reason=${item.reason}` : "";
    return `${item.from.citation} contradicts ${item.to.citation} (${state}${reason})`;
  });
}

function renderAskGapAnalysis(gapAnalysis: AskGapAnalysis): string[] {
  return [
    `status=${gapAnalysis.status}`,
    `summary=${gapAnalysis.summary}`,
    `gaps=${gapAnalysis.gaps.length > 0 ? gapAnalysis.gaps.join(" | ") : "(none)"}`,
    `next_actions=${
      gapAnalysis.next_actions.length > 0 ? gapAnalysis.next_actions.join(" | ") : "(none)"
    }`,
  ];
}

export function evidenceOnlyAnswer(
  evidence: AskEvidenceSummary,
  gapAnalysis: AskGapAnalysis,
  error: string,
): string {
  return [
    `Evidence-only fallback: LLM provider unavailable (${error}).`,
    "Active evidence:",
    ...renderAskEvidence(evidence.active),
    "Superseded evidence:",
    ...renderAskEvidence(evidence.superseded),
    "Contradictions:",
    ...renderAskContradictions(evidence.contradictory),
    "Confidence buckets:",
    `EXTRACTED: ${evidence.byConfidence.EXTRACTED.map((item) => item.citation).join(", ") || "(none)"}`,
    `INFERRED: ${evidence.byConfidence.INFERRED.map((item) => item.citation).join(", ") || "(none)"}`,
    `AMBIGUOUS: ${evidence.byConfidence.AMBIGUOUS.map((item) => item.citation).join(", ") || "(none)"}`,
    "Gap analysis:",
    ...renderAskGapAnalysis(gapAnalysis),
  ].join("\n");
}

function activeHead(rid: number, superseded: Map<number, number>): number {
  const seen = new Set<number>();
  let current = rid;
  while (!seen.has(current)) {
    seen.add(current);
    const next = superseded.get(current);
    if (next == null) return current;
    current = next;
  }
  return current;
}
