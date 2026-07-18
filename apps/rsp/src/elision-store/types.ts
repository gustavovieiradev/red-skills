import { DEFAULT_RSP_BYTE_BUDGET, DEFAULT_RSP_EPHEMERAL_TTL_HOURS, DEFAULT_RSP_TTL_DAYS } from "../config.js";

export const RSP_ELISION_COLLECTION = "rsp_elisions_v1";

export { DEFAULT_RSP_BYTE_BUDGET, DEFAULT_RSP_EPHEMERAL_TTL_HOURS, DEFAULT_RSP_TTL_DAYS };

export type RspLossLevel = "lossless" | "brief" | "terse" | (string & {});

export interface RspLossMeta {
  level: RspLossLevel;
  bytes_elided: number;
}

export interface RspMintMeta {
  command: string;
  loss: RspLossMeta;
}

export type RspStorageClass = "derivable" | "re-executable" | "ephemeral";

export type RspStorageClassStats = Record<RspStorageClass, { records: number; bytes: number; raw_bytes: number }>;

export interface RspElisionRecord {
  collection: typeof RSP_ELISION_COLLECTION;
  handle: `el:${string}`;
  original: Buffer;
  command: string;
  created_at: string;
  loss: RspLossMeta;
  storage_class: RspStorageClass;
}

export interface RspExpiredHandle {
  status: "expired";
  expired_at: string;
  command: string;
  original?: undefined;
}

export interface RspStoreStats {
  records: number;
  bytes: number;
  oldest: string | null;
  budget: number;
  storage_classes: RspStorageClassStats;
}

export interface RspRecoveryHandle {
  handle: `el:${string}`;
  command: string;
  created_at: string;
  expires_at: string;
  age_seconds: number;
  age_display: string;
  storage_class: RspStorageClass;
  recover: string;
}

export interface RspElisionStoreOptions {
  uri: string;
  ttlDays?: number;
  ephemeralTtlHours?: number;
  byteBudget?: number;
  now?: () => Date;
  allowResidentOpen?: boolean;
}

export interface StoredRecord {
  collection: typeof RSP_ELISION_COLLECTION;
  handle: `el:${string}`;
  original?: string;
  original_encoding?: "base64";
  original_bytes: number;
  content_hash?: string;
  stored_bytes?: number;
  blob_key?: string;
  command: string;
  created_at: string;
  expires_at: string;
  loss: RspLossMeta;
  storage_class?: RspStorageClass;
  derivation_recipe?: RspDerivationRecipe;
  reexecution_recipe?: RspReexecutionRecipe;
}

export interface IndexEntry {
  handle: `el:${string}`;
  key: string;
  bytes: number;
  raw_bytes?: number;
  command: string;
  created_at: string;
  expires_at: string;
  storage_class?: RspStorageClass;
  blob_key?: string;
}

export interface StoredBlob {
  key: string;
  content_hash: string;
  encoding: "gzip+base64";
  bytes: string;
  original_bytes: number;
  stored_bytes: number;
  created_at: string;
}

export interface RspDerivationRecipe {
  kind: "git-blob";
  command: string;
  cwd: string;
  object_ids: string[];
  working_tree_fingerprint: string;
  original_bytes: number;
}

export interface RspReexecutionRecipe {
  kind: "command";
  command: string;
  cwd: string;
  argv: string[];
  original_bytes: number;
  content_hash: string;
}

export interface IndexDocument {
  version: 1;
  records: IndexEntry[];
}

export interface StoreDocument {
  version: 1;
  records: Record<string, StoredRecord>;
  blobs: Record<string, StoredBlob>;
  tombstones: Record<string, RspExpiredHandle>;
  index: IndexDocument;
}

export interface RedDbKvCollectionSnapshot {
  name: string;
  items: Array<{ key: string; value: unknown }>;
}
