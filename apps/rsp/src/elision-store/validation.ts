import { RSP_ELISION_COLLECTION } from "./constants.js";
import type {
  IndexDocument,
  RspDerivationRecipe,
  RspExpiredHandle,
  RspLossMeta,
  RspReexecutionRecipe,
  RspStorageClass,
  StoreDocument,
  StoredBlob,
  StoredRecord,
} from "./types.js";

export function isReExecutableArgv(argv: readonly string[]): boolean {
  if (argv[0] === "git") {
    if (argv[1] === "status") return true;
    if (argv[1] !== "branch") return false;
    return argv.length === 2 || argv.slice(2).every((arg) => /^-[avvr]+$/.test(arg));
  }
  return false;
}

export function isHandle(value: string): value is `el:${string}` {
  return /^el:[a-f0-9]{12}$/.test(value);
}

export function isBlobKey(value: string): boolean {
  return /^blob:[a-f0-9]{64}$/.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function isStoredRecord(value: unknown): value is StoredRecord {
  if (!isRecord(value)) return false;
  const hasOriginal = typeof value.original === "string" && value.original_encoding === "base64";
  const hasRecipe = isDerivationRecipe(value.derivation_recipe);
  const hasReexecutionRecipe = isReexecutionRecipe(value.reexecution_recipe);
  const blobKeyValue = value.blob_key;
  const hasBlob = typeof blobKeyValue === "string" && isBlobKey(blobKeyValue);
  return value.collection === RSP_ELISION_COLLECTION &&
    typeof value.handle === "string" &&
    isHandle(value.handle) &&
    (hasOriginal || hasRecipe || hasReexecutionRecipe || hasBlob) &&
    typeof value.original_bytes === "number" &&
    (value.content_hash === undefined || isSha256(value.content_hash)) &&
    (value.stored_bytes === undefined || typeof value.stored_bytes === "number") &&
    (blobKeyValue === undefined || (typeof blobKeyValue === "string" && isBlobKey(blobKeyValue))) &&
    typeof value.command === "string" &&
    typeof value.created_at === "string" &&
    typeof value.expires_at === "string" &&
    isLossMeta(value.loss) &&
    (value.storage_class === undefined || isStorageClass(value.storage_class));
}

export function isIndexDocument(value: unknown): value is IndexDocument {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.records)) return false;
  return value.records.every((entry) => {
    if (!isRecord(entry)) return false;
    const blobKeyValue = entry.blob_key;
    return (
    typeof entry.handle === "string" &&
    isHandle(entry.handle) &&
    typeof entry.key === "string" &&
    typeof entry.bytes === "number" &&
    (entry.raw_bytes === undefined || typeof entry.raw_bytes === "number") &&
    typeof entry.command === "string" &&
    typeof entry.created_at === "string" &&
    typeof entry.expires_at === "string" &&
    (entry.storage_class === undefined || isStorageClass(entry.storage_class)) &&
    (blobKeyValue === undefined || (typeof blobKeyValue === "string" && isBlobKey(blobKeyValue)))
    );
  });
}

export function isStoredBlob(value: unknown): value is StoredBlob {
  return isRecord(value) &&
    typeof value.key === "string" &&
    isBlobKey(value.key) &&
    isSha256(value.content_hash) &&
    value.encoding === "gzip+base64" &&
    typeof value.bytes === "string" &&
    typeof value.original_bytes === "number" &&
    typeof value.stored_bytes === "number" &&
    typeof value.created_at === "string";
}

export function isExpiredHandle(value: unknown): value is RspExpiredHandle {
  return isRecord(value) &&
    value.status === "expired" &&
    typeof value.expired_at === "string" &&
    typeof value.command === "string";
}

export function isLossMeta(value: unknown): value is RspLossMeta {
  return isRecord(value) &&
    typeof value.level === "string" &&
    typeof value.bytes_elided === "number";
}

export function isStorageClass(value: unknown): value is RspStorageClass {
  return value === "derivable" || value === "re-executable" || value === "ephemeral";
}

export function isDerivationRecipe(value: unknown): value is RspDerivationRecipe {
  return isRecord(value) &&
    value.kind === "git-blob" &&
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    Array.isArray(value.object_ids) &&
    value.object_ids.every((item) => typeof item === "string" && /^[0-9a-f]{40,64}$/.test(item)) &&
    typeof value.working_tree_fingerprint === "string" &&
    typeof value.original_bytes === "number";
}

export function isReexecutionRecipe(value: unknown): value is RspReexecutionRecipe {
  return isRecord(value) &&
    value.kind === "command" &&
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    Array.isArray(value.argv) &&
    value.argv.every((item) => typeof item === "string") &&
    isReExecutableArgv(value.argv) &&
    typeof value.original_bytes === "number" &&
    isSha256(value.content_hash);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStoreDocument(value: unknown): value is StoreDocument {
  return isRecord(value) &&
    value.version === 1 &&
    isRecord(value.records) &&
    Object.values(value.records).every(isStoredRecord) &&
    (value.blobs === undefined || (isRecord(value.blobs) && Object.values(value.blobs).every(isStoredBlob))) &&
    isRecord(value.tombstones) &&
    Object.values(value.tombstones).every(isExpiredHandle) &&
    isIndexDocument(value.index);
}
