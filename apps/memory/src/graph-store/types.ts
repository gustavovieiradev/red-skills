import {
  COLLECTIONS,
  type MemoryDoc,
  type MemoryNode,
  type MemoryProvenance,
  type MemoryScope,
  type NodeType,
} from "../schema.js";

export interface MemoryStoreOptions {
  /** RedDB connection URI, e.g. file:///abs/path/.red/memory/graph.rdb. */
  uri: string;
  /** Project tag stamped on every node. Used for multi-project hosts. */
  project?: string;
  /** TTL horizon for `ephemeral` nodes, in ms (default 24h). */
  ephemeralTtlMs?: number;
}

/** A node row read back from the graph, with its engine-assigned id. */
export type StoredNode = MemoryNode & { rid: number };

export type VectorProjectionState = "ready" | "stale" | "unavailable" | "failed";

export interface VectorNodeStatus {
  source_collection: typeof COLLECTIONS.nodes;
  rid: number;
  label: string;
  node_type: NodeType;
  status: VectorProjectionState;
  text_hash: string;
  projected_text_hash?: string;
  error?: string;
  updated_at?: number;
}

export interface VectorDocStatus {
  source_collection: typeof COLLECTIONS.docs;
  rid: number;
  path: string;
  title: string | null;
  status: VectorProjectionState;
  text_hash: string;
  projected_text_hash?: string;
  error?: string;
  updated_at?: number;
}

export interface VectorStatusReport {
  schema_version: "memory.vector_status.v1";
  read_only: true;
  overall: VectorProjectionState;
  total: number;
  ready: number;
  stale: number;
  unavailable: number;
  failed: number;
  nodes: VectorNodeStatus[];
  docs: VectorDocStatus[];
}

/** A node reached by a graph walk (neighborhood/traverse), with its hop depth.
 *  Graph walks return only the engine `node_id` + `label` + `depth`; the full
 *  node (real `node_type`, `properties`) is resolved against `listNodes` by the
 *  recall engine. */
export interface GraphRow {
  rid: number;
  label: string;
  depth: number;
}

/** A full-text search hit: an engine node id and its relevance score. */
export interface SearchRow {
  rid: number;
  score: number;
}

export interface NodeScopeInput {
  scope?: MemoryScope;
  scopeId?: string;
  provenance?: MemoryProvenance;
}

/** Provider usage and billing metadata reported by RedDB ASK. */
export interface AskCost {
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  model: string;
  provider: string;
  cache_hit: boolean;
}

/** Result of a shortest-path query. `reachable` is false when the engine found
 *  no path (`hop_count` comes back null). */
export interface ShortestPathResult {
  source: number;
  target: number;
  reachable: boolean;
  hopCount: number | null;
  totalWeight: number | null;
  nodesVisited: number;
}

export interface VectorProjectionRecord {
  rid: number;
  node_rid: number;
  doc_rid?: number;
  node_hash?: string;
  text_hash: string;
  label: string;
  node_type?: NodeType;
  path?: string;
  title?: string | null;
  text_length: number;
  source_collection: string;
  project: string;
  provider: string;
  updated_at: number;
}

export interface LocalVectorProjectionRecord extends VectorProjectionRecord {
  embedding: string | number[];
}

export interface VectorFailureRecord {
  status: "unavailable" | "failed";
  error: string;
  text_hash: string;
  updated_at: number;
}

export type TraverseStrategy = "bfs" | "dfs";
export type GraphDirection = "outgoing" | "incoming" | "both";
export type PathAlgorithm = "bfs" | "dijkstra";

export const STRATEGIES: readonly TraverseStrategy[] = ["bfs", "dfs"];
export const DIRECTIONS: readonly GraphDirection[] = ["outgoing", "incoming", "both"];
export const ALGORITHMS: readonly PathAlgorithm[] = ["bfs", "dijkstra"];

export type SupersessionArchiveRecord = {
  superseded_by: number;
  valid_from?: number;
  valid_until: number;
  archived_at: number;
  reason?: string;
};

export type SupersessionArchiveMap = Record<string, SupersessionArchiveRecord>;

export type AccessOverlayMap = Record<string, { count: number; accessed_at: number }>;

export type ReinforceOverlayMap = Record<string, number>;
