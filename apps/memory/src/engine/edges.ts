export function edgeLabel(edge: Record<string, unknown>): string {
  return String(edge.label ?? edge.edge_label ?? "");
}

export function edgeFrom(edge: Record<string, unknown>): number {
  return Number(edge.from_rid ?? edge.from ?? edge.from_id ?? edge.source ?? edge.source_id);
}

export function edgeTo(edge: Record<string, unknown>): number {
  return Number(edge.to_rid ?? edge.to ?? edge.to_id ?? edge.target ?? edge.target_id);
}

export function edgeReason(edge: Record<string, unknown>): string | null {
  const props = edge.properties;
  if (props && typeof props === "object" && "reason" in props) {
    const reason = (props as { reason?: unknown }).reason;
    return reason == null ? null : String(reason);
  }
  return null;
}
