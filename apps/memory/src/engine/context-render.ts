import type { RecalledNode, RecallDiagnostics, VectorRecallDiagnostics } from "./types.js";

function defaultDiagnostics(): RecallDiagnostics {
  return {
    vector: {
      status: "unavailable",
      candidates: 0,
      contributed: 0,
    },
  };
}

export function renderContext(
  query: string,
  nodes: RecalledNode[],
  diagnostics: RecallDiagnostics = defaultDiagnostics(),
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
