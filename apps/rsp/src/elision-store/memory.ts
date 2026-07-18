import { readdir } from "node:fs/promises";
import { join } from "node:path";

export function parseMemoryRecallPayload(payload: unknown): {
  query: string;
  limit: number;
  options: {
    includeSuperseded?: boolean;
    scope?: unknown;
    now?: number;
    ranking?: unknown;
  };
} {
  if (!isPlainObject(payload)) throw new Error("memory recall payload must be an object");
  const query = payload.query;
  if (typeof query !== "string" || query.trim() === "") throw new Error("memory recall query is required");
  const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit) ? payload.limit : 10;
  return {
    query,
    limit,
    options: {
      includeSuperseded: payload.includeSuperseded === true,
      scope: isPlainObject(payload.scope) ? payload.scope : undefined,
      ranking: isPlainObject(payload.ranking) ? payload.ranking : undefined,
    },
  };
}

export function parseMemoryIngestPayload(payload: unknown): {
  cwd: string;
  maxFiles?: number;
  ignore?: string[];
} {
  if (!isPlainObject(payload)) throw new Error("memory ingest payload must be an object");
  const cwd = payload.cwd;
  if (typeof cwd !== "string" || cwd.trim() === "") throw new Error("memory ingest cwd is required");
  const maxFiles = typeof payload.maxFiles === "number" && Number.isFinite(payload.maxFiles)
    ? payload.maxFiles
    : undefined;
  const ignore = Array.isArray(payload.ignore)
    ? payload.ignore.filter((item): item is string => typeof item === "string")
    : undefined;
  return { cwd, maxFiles, ignore };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ResidentRecallHit {
  id: string;
  rid: number;
  label: string;
  node_type: string;
  score: number;
  excerpt: string;
}

export async function collectMemoryFiles(root: string, maxFiles: number, ignore: string[]): Promise<string[]> {
  const out: string[] = [];
  const ignored = new Set([".git", "node_modules", ".red", ...ignore]);
  async function walk(dir: string): Promise<void> {
    if (out.length >= maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (ignored.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && /\.(md|mdx|txt|ts|tsx|js|jsx|json|yaml|yml|toml|rs|go|py|sql)$/i.test(entry.name)) {
        out.push(path);
      }
    }
  }
  await walk(root);
  return out;
}

export function residentRowToRecallHit(row: Record<string, unknown>, terms: string[]): ResidentRecallHit | null {
  const rid = Number(row.red_entity_id ?? row.rid);
  if (!Number.isFinite(rid)) return null;
  const rawProperties = row.properties ?? row.PROPERTIES;
  const properties = isPlainObject(rawProperties) ? rawProperties : {};
  const label = String(row.label ?? row.LABEL ?? properties.title ?? `memory-${rid}`);
  const nodeType = String(row.node_type ?? row.NODE_TYPE ?? "concept");
  const content = String(properties.content ?? properties.summary ?? properties.title ?? label);
  const haystack = `${label} ${content}`.toLowerCase();
  const matched = terms.filter((term) => haystack.includes(term));
  if (matched.length === 0 && terms.length > 0) return null;
  return {
    id: String(rid),
    rid,
    label,
    node_type: nodeType,
    score: matched.length || 1,
    excerpt: content.slice(0, 500),
  };
}
