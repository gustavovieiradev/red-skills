import type {
  AskContradiction,
  AskEvidence,
  AskEvidenceSummary,
  AskGapAnalysis,
  RecalledNode,
  RecallDiagnostics,
  VectorRecallDiagnostics,
} from "./core.js";

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

export function renderContext(
  query: string,
  nodes: RecalledNode[],
  diagnostics: RecallDiagnostics,
): string {
  const vectorLine = renderVectorDiagnostic(diagnostics.vector);
  if (nodes.length === 0) {
    return `# Memory recall: ${query}\n\n_${vectorLine}_\n\n_(no relevant memory)_\n`;
  }
  const lines = [`# Memory recall: ${query}`, ""];
  lines.push(`_${vectorLine}_`, "");
  for (const n of nodes.slice(0, 12)) {
    const p = n.properties;
    const source = p.source ? ` — ${p.source}` : "";
    lines.push(`- **${p.title ?? n.label}** _(${n.node_type})_${source}`);
    const detail = p.summary ?? p.content;
    if (detail) lines.push(`  ${detail.slice(0, 200)}`);
    // attempt nodes carry their Envelope hook executions as a `hooks` array
    // (issue #216). Surface a one-line summary so recall consumers see which
    // user hooks fired without re-reading the raw Envelope.
    const hooksLine = renderAttemptHooks(p.hooks);
    if (hooksLine) lines.push(`  ${hooksLine}`);
    const lineageLine = renderSupersessionLine(p);
    if (lineageLine) lines.push(`  ${lineageLine}`);
  }
  return `${lines.join("\n")}\n`;
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

function renderSupersessionLine(p: RecalledNode["properties"]): string | null {
  const supersededBy = numericProp(p.superseded_by);
  if (supersededBy == null) return null;
  const parts = [`superseded_by=memory_nodes:${supersededBy}`];
  const validFrom = numericProp(p.valid_from);
  const validUntil = numericProp(p.valid_until);
  if (validFrom != null) parts.push(`valid_from=${validFrom}`);
  if (validUntil != null) parts.push(`valid_until=${validUntil}`);
  return `_lineage: ${parts.join(" ")}_`;
}

function numericProp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function renderAttemptHooks(hooks: unknown): string | null {
  if (!Array.isArray(hooks) || hooks.length === 0) return null;
  const parts: string[] = [];
  for (const raw of hooks) {
    if (raw == null || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const lifecycle = typeof entry.lifecycle === "string" ? entry.lifecycle : "";
    if (!lifecycle) continue;
    const exit = entry.exit_code;
    const exitStr = typeof exit === "number" || typeof exit === "string" ? String(exit) : "?";
    parts.push(`${lifecycle}=${exitStr}`);
  }
  if (parts.length === 0) return null;
  return `_hooks: ${parts.join(", ")}_`;
}

function renderVectorDiagnostic(d: VectorRecallDiagnostics): string {
  if (d.status === "contributed") {
    return `vector retrieval contributed ${d.contributed} candidate(s)`;
  }
  if (d.status === "available") return "vector retrieval available; 0 candidate(s) contributed";
  const reason = d.reason ? `: ${d.reason}` : "";
  return `vector retrieval unavailable${reason}`;
}
