import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import type {
  IndexEntry,
  RspDerivationRecipe,
  RspElisionRecord,
  RspMintMeta,
  RspRecoveryHandle,
  RspReexecutionRecipe,
  RspStorageClass,
  RspStorageClassStats,
  StoredBlob,
  StoredRecord,
} from "./types.js";
import { isReExecutableArgv, isStorageClass } from "./validation.js";

export function contentHandle(original: Buffer, meta: RspMintMeta): `el:${string}` {
  const hash = createHash("sha256")
    .update("rsp-elision-v1\0")
    .update(original)
    .update("\0")
    .update(JSON.stringify({ command: meta.command, loss: meta.loss }))
    .digest("hex")
    .slice(0, 12);
  return `el:${hash}`;
}

export function recordKey(handle: `el:${string}`): string {
  return `record:${handle.slice(3)}`;
}

export function tombstoneKey(handle: `el:${string}`): string {
  return `expired:${handle.slice(3)}`;
}

export function indexKey(): string {
  return "index:v1";
}

export function blobKey(hash: string): string {
  return `blob:${hash}`;
}

export function redDbIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`invalid RedDB identifier: ${value}`);
  return value;
}

export function storageClassForCommand(command: string): RspStorageClass {
  const argv = command.trim().split(/\s+/).filter(Boolean);
  const executable = argv[0] ?? "";
  if (executable === "cat") return "derivable";
  if (executable === "git") {
    const subcommand = argv[1] ?? "";
    if (subcommand === "log" || subcommand === "diff" || subcommand === "blame" || subcommand === "show") {
      return "derivable";
    }
    if (isReExecutableArgv(argv)) return "re-executable";
    return "ephemeral";
  }
  return "ephemeral";
}

export function storageClassForRecord(record: Pick<StoredRecord, "command" | "storage_class">): RspStorageClass {
  return isStorageClass(record.storage_class) ? record.storage_class : storageClassForCommand(record.command);
}

export function storageClassForIndexEntry(entry: Pick<IndexEntry, "command" | "storage_class">): RspStorageClass {
  return isStorageClass(entry.storage_class) ? entry.storage_class : storageClassForCommand(entry.command);
}

export function storageStatsForIndex(records: readonly IndexEntry[]): RspStorageClassStats {
  const stats = emptyStorageClassStats();
  const seenBlobsByClass: Record<RspStorageClass, Set<string>> = {
    derivable: new Set(),
    "re-executable": new Set(),
    ephemeral: new Set(),
  };
  for (const entry of records) {
    const storageClass = storageClassForIndexEntry(entry);
    stats[storageClass].records += 1;
    stats[storageClass].raw_bytes += entry.raw_bytes ?? entry.bytes;
    if (entry.blob_key) {
      if (seenBlobsByClass[storageClass].has(entry.blob_key)) continue;
      seenBlobsByClass[storageClass].add(entry.blob_key);
    }
    stats[storageClass].bytes += entry.bytes;
  }
  return stats;
}

export function recoveryHandlesForIndex(records: readonly IndexEntry[], now: Date, limit: number): RspRecoveryHandle[] {
  const nowMs = now.getTime();
  return [...records]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, Math.max(0, limit))
    .map((entry) => {
      const ageSeconds = Math.max(0, Math.floor((nowMs - Date.parse(entry.created_at)) / 1000));
      return {
        handle: entry.handle,
        command: entry.command,
        created_at: entry.created_at,
        expires_at: entry.expires_at,
        age_seconds: ageSeconds,
        age_display: formatAge(ageSeconds),
        storage_class: storageClassForIndexEntry(entry),
        recover: `rsp show ${entry.handle}`,
      };
    });
}

export function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) return `${ageSeconds}s`;
  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `${ageMinutes}m`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h`;
  return `${Math.floor(ageHours / 24)}d`;
}

export function expiresAtFor(now: Date, storageClass: RspStorageClass, ttlDays: number, ephemeralTtlHours: number): string {
  const ttlMs = storageClass === "ephemeral"
    ? ephemeralTtlHours * 60 * 60 * 1000
    : ttlDays * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ttlMs).toISOString();
}

export function storedBytesForIndex(records: readonly IndexEntry[]): number {
  let bytes = 0;
  const seenBlobs = new Set<string>();
  for (const entry of records) {
    if (entry.blob_key) {
      if (seenBlobs.has(entry.blob_key)) continue;
      seenBlobs.add(entry.blob_key);
    }
    bytes += entry.bytes;
  }
  return bytes;
}

export function deriveGitBlobRecipe(bytes: Buffer, command: string): RspDerivationRecipe | null {
  const cwd = process.cwd();
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return null;
  const object = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd, input: bytes, encoding: "buffer" });
  if (object.status !== 0) return null;
  const objectId = object.stdout.toString("utf8").trim();
  if (!/^[0-9a-f]{40,64}$/.test(objectId)) return null;
  return {
    kind: "git-blob",
    command,
    cwd,
    object_ids: [objectId],
    working_tree_fingerprint: gitWorkingTreeFingerprint(cwd),
    original_bytes: bytes.length,
  };
}

export function gitWorkingTreeFingerprint(cwd: string): string {
  const head = gitOutput(cwd, ["rev-parse", "HEAD"]) || "unborn";
  const index = gitOutput(cwd, ["write-tree"]) || "no-index";
  const status = gitOutput(cwd, ["status", "--porcelain=v1", "-z"]) || "";
  return createHash("sha256")
    .update(head)
    .update("\0")
    .update(index)
    .update("\0")
    .update(status)
    .digest("hex");
}

export function gitOutput(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function deriveReexecutionRecipe(bytes: Buffer, command: string): RspReexecutionRecipe | null {
  const argv = command.trim().split(/\s+/).filter(Boolean);
  if (!isReExecutableArgv(argv)) return null;
  const current = runReexecutionCommand(process.cwd(), argv, bytes.length);
  if (!current || contentHash(current) !== contentHash(bytes)) return null;
  return {
    kind: "command",
    command,
    cwd: process.cwd(),
    argv,
    original_bytes: bytes.length,
    content_hash: contentHash(bytes),
  };
}


export function contentHash(bytes: Buffer): string {
  return createHash("sha256").update("rsp-reexecutable-content-v1\0").update(bytes).digest("hex");
}

export function storedBytesFor(
  bytes: Buffer,
  derivationRecipe: RspDerivationRecipe | null,
  reexecutionRecipe?: RspReexecutionRecipe | null,
  blob?: StoredBlob | null,
): number {
  if (derivationRecipe) return Buffer.byteLength(JSON.stringify(derivationRecipe), "utf8");
  if (reexecutionRecipe) return Buffer.byteLength(JSON.stringify(reexecutionRecipe), "utf8");
  if (blob) return blob.stored_bytes;
  return bytes.length;
}

export function storedBytesForRecord(record: StoredRecord): number {
  if (typeof record.stored_bytes === "number") return record.stored_bytes;
  if (record.derivation_recipe) return Buffer.byteLength(JSON.stringify(record.derivation_recipe), "utf8");
  if (record.reexecution_recipe) return Buffer.byteLength(JSON.stringify(record.reexecution_recipe), "utf8");
  if (record.blob_key) return typeof record.stored_bytes === "number" ? record.stored_bytes : 0;
  return record.original_bytes;
}

export function compressedBlob(bytes: Buffer, hash: string, createdAt: string): StoredBlob {
  const compressed = gzipSync(bytes);
  return {
    key: blobKey(hash),
    content_hash: hash,
    encoding: "gzip+base64",
    bytes: compressed.toString("base64"),
    original_bytes: bytes.length,
    stored_bytes: compressed.length,
    created_at: createdAt,
  };
}

export function readCompressedBlob(blob: StoredBlob): Buffer | null {
  try {
    const original = gunzipSync(Buffer.from(blob.bytes, "base64"));
    return original.length === blob.original_bytes ? original : null;
  } catch {
    return null;
  }
}

export function readGitBlobRecipe(recipe: RspDerivationRecipe): Buffer | null {
  const objectId = recipe.object_ids[0];
  if (!objectId) return null;
  const result = spawnSync("git", ["cat-file", "-p", objectId], {
    cwd: recipe.cwd,
    encoding: "buffer",
    maxBuffer: Math.max(recipe.original_bytes + 1024, 1024 * 1024),
  });
  if (result.status !== 0) return null;
  if (result.stdout.length !== recipe.original_bytes) return null;
  return result.stdout;
}

export function readReexecutionRecipe(recipe: RspReexecutionRecipe): Buffer | null {
  if (!isReExecutableArgv(recipe.argv)) return null;
  const current = runReexecutionCommand(recipe.cwd, recipe.argv, recipe.original_bytes);
  if (!current) return null;
  if (contentHash(current) === recipe.content_hash) return current;
  return Buffer.concat([
    Buffer.from("reconstructed after state moved - current snapshot follows\n", "utf8"),
    current,
  ]);
}

export function runReexecutionCommand(cwd: string, argv: readonly string[], originalBytes: number): Buffer | null {
  const executable = argv[0];
  if (!executable) return null;
  const result = spawnSync(executable, argv.slice(1), {
    cwd,
    encoding: "buffer",
    maxBuffer: Math.max(originalBytes + 1024, 1024 * 1024),
  });
  if (result.status !== 0 || result.signal) return null;
  return result.stdout;
}

export function emptyStorageClassStats(): RspStorageClassStats {
  return {
    derivable: { records: 0, bytes: 0, raw_bytes: 0 },
    "re-executable": { records: 0, bytes: 0, raw_bytes: 0 },
    ephemeral: { records: 0, bytes: 0, raw_bytes: 0 },
  };
}
