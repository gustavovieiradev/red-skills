import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decode, encode, type JsonValue } from "@reddb-io/toon";
import type { StoreDocument } from "./types.js";
import { isStoreDocument } from "./validation.js";

export async function readStoreDocument(path: string): Promise<StoreDocument> {
  try {
    const text = await readFile(path, "utf8");
    const body = text.trim();
    if (body === "") return emptyStoreDocument();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      parsed = decode(body);
    }
    if (isStoreDocument(parsed)) return { ...parsed, blobs: parsed.blobs ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const document = emptyStoreDocument();
      await writeStoreDocument(path, document);
      return document;
    }
    const document = emptyStoreDocument();
    await writeStoreDocument(path, document);
    return document;
  }
  const document = emptyStoreDocument();
  await writeStoreDocument(path, document);
  return document;
}

export async function writableStorePath(path: string): Promise<string> {
  try {
    return path;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return path;
    throw err;
  }
}

export function usesEmbeddedRedDb(path: string): boolean {
  return basename(path) === "red-skills.rdb";
}

export async function writeStoreDocument(path: string, document: StoreDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${encode(toJsonValue(document))}\n`, "utf8");
  await rename(tmp, path);
}

export function toJsonValue(value: unknown): JsonValue {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) out[key] = toJsonValue(child);
    }
    return out;
  }
  return String(value);
}

export function emptyStoreDocument(): StoreDocument {
  return { version: 1, records: {}, blobs: {}, tombstones: {}, index: { version: 1, records: [] } };
}

export function fileStorePath(uri: string): string {
  if (!uri.startsWith("file://")) {
    throw new Error("rsp elision store requires a file:// URI");
  }
  return fileURLToPath(uri);
}
