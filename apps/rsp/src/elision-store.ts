import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRepoRedDaemon, isRepoRedStorePath } from "@reddb-io/shared/repo-red-daemon.js";
import { connect as connectEmbedded } from "@reddb-io/sdk";

export const RSP_ELISION_COLLECTION = "rsp_elisions_v1";

export const DEFAULT_RSP_TTL_DAYS = 7;
export const DEFAULT_RSP_BYTE_BUDGET = 64 * 1024 * 1024;

export type RspLossLevel = "lossless" | "brief" | "terse" | (string & {});

export interface RspLossMeta {
  level: RspLossLevel;
  bytes_elided: number;
}

export interface RspMintMeta {
  command: string;
  loss: RspLossMeta;
}

export interface RspElisionRecord {
  collection: typeof RSP_ELISION_COLLECTION;
  handle: `el:${string}`;
  original: Buffer;
  command: string;
  created_at: string;
  loss: RspLossMeta;
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
}

export interface RspElisionStoreOptions {
  uri: string;
  ttlDays?: number;
  byteBudget?: number;
  now?: () => Date;
}

interface StoredRecord {
  collection: typeof RSP_ELISION_COLLECTION;
  handle: `el:${string}`;
  original?: string;
  original_encoding: "base64";
  original_bytes: number;
  original_chunks?: number;
  command: string;
  created_at: string;
  expires_at: string;
  loss: RspLossMeta;
}

interface IndexEntry {
  handle: `el:${string}`;
  key: string;
  bytes: number;
  command: string;
  created_at: string;
  expires_at: string;
}

export class RspElisionStore {
  private db?: {
    kv(collection: string): {
      put(key: string, value: unknown): Promise<unknown>;
      get(key: string): Promise<unknown>;
      delete(key: string): Promise<{ affected?: number; deleted?: boolean }>;
      list(opts: { prefix?: string; limit?: number }): Promise<{ items: Array<{ key: string; value: unknown }> }>;
    };
    close(): Promise<void>;
  };
  private remoteBase?: string;

  private constructor(private readonly opts: Required<Omit<RspElisionStoreOptions, "ttlDays" | "byteBudget">> & {
    ttlDays: number;
    byteBudget: number;
  }) {}

  static async open(opts: RspElisionStoreOptions): Promise<RspElisionStore> {
    if (process.env.RSP_FAIL_IF_STORE_OPEN === "1") {
      throw new Error("RSP_FAIL_IF_STORE_OPEN blocked store open");
    }
    const requestedPath = fileStorePath(opts.uri);
    await rejectLegacyRspPath(requestedPath);
    const uri = isRepoRedStorePath(requestedPath)
      ? (await ensureRepoRedDaemon(requestedPath)).uri
      : opts.uri;
    const store = new RspElisionStore({
      uri: opts.uri,
      ttlDays: positiveNumber(opts.ttlDays, DEFAULT_RSP_TTL_DAYS),
      byteBudget: positiveNumber(opts.byteBudget, DEFAULT_RSP_BYTE_BUDGET),
      now: opts.now ?? (() => new Date()),
    });
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      store.remoteBase = uri.replace(/\/+$/, "");
    } else {
      store.db = await connectEmbedded(uri) as typeof store.db;
    }
    return store;
  }

  async close(): Promise<void> {
    await this.db?.close();
  }

  async mint(original: Uint8Array | Buffer, meta: RspMintMeta): Promise<`el:${string}`> {
    const bytes = Buffer.from(original);
    const now = this.opts.now();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.opts.ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const handle = contentHandle(bytes, meta);
    const key = recordKey(handle);
    const chunks = chunkBase64(bytes);

    const record: StoredRecord = {
      collection: RSP_ELISION_COLLECTION,
      handle,
      original_encoding: "base64",
      original_bytes: bytes.length,
      command: meta.command,
      created_at: createdAt,
      expires_at: expiresAt,
      loss: meta.loss,
      ...(chunks.length === 1 ? { original: chunks[0] } : { original_chunks: chunks.length }),
    };

    await this.deleteKey(tombstoneKey(handle));
    await this.deleteChunks(handle);
    if (chunks.length > 1) {
      for (let i = 0; i < chunks.length; i++) await this.putValue(chunkKey(handle, i), chunks[i]!);
    }
    await this.putJson(key, record);
    await this.prune();
    return handle;
  }

  async get(handle: string): Promise<RspElisionRecord | RspExpiredHandle | null> {
    if (!isHandle(handle)) return null;
    const tombstone = await this.tombstone(handle);
    if (tombstone) return tombstone;

    const raw = await this.getJson(recordKey(handle));
    if (!isStoredRecord(raw)) return null;

    if (Date.parse(raw.expires_at) <= this.opts.now().getTime()) {
      const expired = { status: "expired" as const, expired_at: raw.expires_at, command: raw.command };
      await this.expireEntry(indexEntry(raw), raw.expires_at);
      return expired;
    }

    const original = await this.readOriginal(raw);
    if (!original) return null;

    return {
      collection: RSP_ELISION_COLLECTION,
      handle: raw.handle,
      original,
      command: raw.command,
      created_at: raw.created_at,
      loss: raw.loss,
    };
  }

  async stats(): Promise<RspStoreStats> {
    await this.prune();
    const records = await this.readIndex();
    return {
      records: records.length,
      bytes: records.reduce((sum, entry) => sum + entry.bytes, 0),
      oldest: records.reduce<string | null>((oldest, entry) => {
        if (oldest == null) return entry.created_at;
        return entry.created_at < oldest ? entry.created_at : oldest;
      }, null),
      budget: this.opts.byteBudget,
    };
  }

  private async readIndex(): Promise<IndexEntry[]> {
    const listed = await this.listValues("record:");
    const records: IndexEntry[] = [];
    for (const item of listed) {
      const value = parseJson(item.value);
      if (isStoredRecord(value)) records.push(indexEntry(value));
    }
    return records;
  }

  private async prune(): Promise<void> {
    const nowMs = this.opts.now().getTime();
    const nowIso = new Date(nowMs).toISOString();
    const live: IndexEntry[] = [];

    for (const entry of await this.readIndex()) {
      if (Date.parse(entry.expires_at) <= nowMs) await this.expireEntry(entry, entry.expires_at);
      else live.push(entry);
    }

    let bytes = live.reduce((sum, entry) => sum + entry.bytes, 0);
    live.sort((a, b) => a.created_at.localeCompare(b.created_at));
    while (bytes > this.opts.byteBudget && live.length > 0) {
      const evicted = live.shift()!;
      bytes -= evicted.bytes;
      await this.expireEntry(evicted, nowIso);
    }
  }

  private async expireEntry(entry: IndexEntry, expiredAt: string): Promise<void> {
    await this.deleteKey(entry.key);
    await this.deleteChunks(entry.handle);
    await this.putJson(tombstoneKey(entry.handle), {
      status: "expired",
      expired_at: expiredAt,
      command: entry.command,
    });
  }

  private async tombstone(handle: `el:${string}`): Promise<RspExpiredHandle | null> {
    const raw = await this.getJson(tombstoneKey(handle));
    return isExpiredHandle(raw) ? raw : null;
  }

  private async readOriginal(record: StoredRecord): Promise<Buffer | null> {
    if (record.original != null) return Buffer.from(record.original, "base64");
    if (record.original_chunks == null) return null;
    const chunks: string[] = [];
    for (let i = 0; i < record.original_chunks; i++) {
      const chunk = await this.getValue(chunkKey(record.handle, i));
      if (typeof chunk !== "string") return null;
      chunks.push(chunk);
    }
    return Buffer.from(chunks.join(""), "base64");
  }

  private async deleteChunks(handle: `el:${string}`): Promise<void> {
    for (let i = 0; i < 100_000; i++) {
      const res = await this.deleteKey(chunkKey(handle, i));
      if (!res.deleted && !res.affected) return;
    }
  }

  private async putJson(key: string, value: unknown): Promise<void> {
    await this.putValue(key, JSON.stringify(value));
  }

  private async getJson(key: string): Promise<unknown> {
    return parseJson(await this.getValue(key));
  }

  private async putValue(key: string, value: string): Promise<void> {
    if (this.remoteBase) {
      await this.deleteKey(key);
      const res = await fetch(`${this.remoteBase}/collections/${encodeURIComponent(RSP_ELISION_COLLECTION)}/rows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: { key, value } }),
      });
      if (!res.ok) throw new Error(await res.text());
      return;
    }
    await this.db!.kv(RSP_ELISION_COLLECTION).put(key, value);
  }

  private async getValue(key: string): Promise<unknown> {
    if (this.remoteBase) {
      const found = (await this.listValues()).find((item) => item.key === key);
      return found?.value ?? null;
    }
    return await this.db!.kv(RSP_ELISION_COLLECTION).get(key);
  }

  private async deleteKey(key: string): Promise<{ affected?: number; deleted?: boolean }> {
    if (this.remoteBase) {
      let body: Record<string, unknown>;
      try {
        body = await this.remoteQuery(`DELETE FROM ${RSP_ELISION_COLLECTION} WHERE key = ${sqlString(key)}`);
      } catch (err) {
        if (String((err as Error).message).includes("not found")) return { affected: 0, deleted: false };
        throw err;
      }
      const affected = typeof body.affected_rows === "number" ? body.affected_rows : 0;
      return { affected, deleted: affected > 0 };
    }
    return await this.db!.kv(RSP_ELISION_COLLECTION).delete(key);
  }

  private async listValues(prefix = ""): Promise<Array<{ key: string; value: unknown }>> {
    if (this.remoteBase) {
      try {
        const body = await this.remoteQuery(`SELECT * FROM ${RSP_ELISION_COLLECTION}`);
        const result = isRecord(body.result) ? body.result : {};
        const records = result.records;
        if (!Array.isArray(records)) return [];
        return records
          .map((record) => isRecord(record) && isRecord(record.values)
            ? { key: String(record.values.key), value: record.values.value }
            : null)
          .filter((item): item is { key: string; value: unknown } => item != null && item.key.startsWith(prefix));
      } catch (err) {
        if (String((err as Error).message).includes("not found")) return [];
        throw err;
      }
    }
    try {
      return (await this.db!.kv(RSP_ELISION_COLLECTION).list({ prefix, limit: 100_000 })).items;
    } catch (err) {
      if (String((err as Error).message).includes("not found")) return [];
      throw err;
    }
  }

  private async remoteQuery(query: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.remoteBase}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
    if (!res.ok) throw new Error(typeof parsed.error === "string" ? parsed.error : text);
    return parsed;
  }
}

function contentHandle(original: Buffer, meta: RspMintMeta): `el:${string}` {
  const hash = createHash("sha256")
    .update("rsp-elision-v1\0")
    .update(original)
    .update("\0")
    .update(JSON.stringify({ command: meta.command, loss: meta.loss }))
    .digest("hex")
    .slice(0, 12);
  return `el:${hash}`;
}

function recordKey(handle: `el:${string}`): string {
  return `record:${handle.slice(3)}`;
}

function tombstoneKey(handle: `el:${string}`): string {
  return `expired:${handle.slice(3)}`;
}

function chunkKey(handle: `el:${string}`, index: number): string {
  return `chunk:${handle.slice(3)}:${index}`;
}

function isHandle(value: string): value is `el:${string}` {
  return /^el:[a-f0-9]{12}$/.test(value);
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isStoredRecord(value: unknown): value is StoredRecord {
  return isRecord(value) &&
    value.collection === RSP_ELISION_COLLECTION &&
    typeof value.handle === "string" &&
    isHandle(value.handle) &&
    (typeof value.original === "string" || typeof value.original_chunks === "number") &&
    value.original_encoding === "base64" &&
    typeof value.original_bytes === "number" &&
    typeof value.command === "string" &&
    typeof value.created_at === "string" &&
    typeof value.expires_at === "string" &&
    isLossMeta(value.loss);
}

function indexEntry(record: StoredRecord): IndexEntry {
  return {
    handle: record.handle,
    key: recordKey(record.handle),
    bytes: record.original_bytes,
    command: record.command,
    created_at: record.created_at,
    expires_at: record.expires_at,
  };
}

function isExpiredHandle(value: unknown): value is RspExpiredHandle {
  return isRecord(value) &&
    value.status === "expired" &&
    typeof value.expired_at === "string" &&
    typeof value.command === "string";
}

function isLossMeta(value: unknown): value is RspLossMeta {
  return isRecord(value) &&
    typeof value.level === "string" &&
    typeof value.bytes_elided === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

async function rejectLegacyRspPath(path: string): Promise<void> {
  try {
    const bytes = await readFile(path);
    if (isLegacyRedDbStore(bytes) && basename(path) === "red.rdb") {
      throw new Error("refusing to open legacy .red/red.rdb for rsp elisions");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

function isLegacyRedDbStore(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).toString("ascii") === "RDBSBLK1";
}

function fileStorePath(uri: string): string {
  if (!uri.startsWith("file://")) {
    throw new Error("rsp elision store requires a file:// URI");
  }
  return fileURLToPath(uri);
}

function chunkBase64(bytes: Buffer): string[] {
  const base64 = bytes.toString("base64");
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += 900) chunks.push(base64.slice(i, i + 900));
  return chunks.length > 0 ? chunks : [""];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
