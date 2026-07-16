import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  decode,
  encode,
  encodeLines,
  parseRecords,
  type JsonValue,
  type ToonlLineEmitter,
} from "@reddb-io/toon";
import type {
  CastleHistoryRecord,
  CastleLaneRecord,
  CastleStateSnapshot,
} from "./contracts/index.js";

type CastleLaneWireRecord = {
  at: string;
  kind: string;
  worker_id: string | null;
  supervisor_id: string | null;
  issue: number | null;
  attempt: number | null;
  payload: string | null;
};

export class CastleLaneRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CastleLaneRecordError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireOptionalString(
  record: CastleLaneRecord,
  key: "worker_id" | "supervisor_id",
): void {
  const value = record[key];
  if (value !== undefined && (typeof value !== "string" || value === "")) {
    throw new CastleLaneRecordError(`castle lane: ${key} must be a string`);
  }
}

function requireOptionalNonNegativeInteger(
  record: CastleLaneRecord,
  key: "issue" | "attempt",
): void {
  const value = record[key];
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new CastleLaneRecordError(
      `castle lane: ${key} must be a non-negative integer`,
    );
  }
}

export function validateCastleLaneRecord(
  record: CastleLaneRecord,
): CastleLaneRecord {
  if (!record.at || typeof record.at !== "string") {
    throw new CastleLaneRecordError("castle lane: at must be a string");
  }
  if (!record.kind || typeof record.kind !== "string") {
    throw new CastleLaneRecordError("castle lane: kind must be a string");
  }
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(record.kind)) {
    throw new CastleLaneRecordError(
      "castle lane: kind must be namespaced with dot segments",
    );
  }
  requireOptionalString(record, "worker_id");
  requireOptionalString(record, "supervisor_id");
  requireOptionalNonNegativeInteger(record, "issue");
  requireOptionalNonNegativeInteger(record, "attempt");
  if (record.payload !== undefined && !isObject(record.payload)) {
    throw new CastleLaneRecordError("castle lane: payload must be an object");
  }
  return record;
}

function toWireRecord(record: CastleLaneRecord): CastleLaneWireRecord {
  validateCastleLaneRecord(record);
  return {
    at: record.at,
    kind: record.kind,
    worker_id: record.worker_id ?? null,
    supervisor_id: record.supervisor_id ?? null,
    issue: record.issue ?? null,
    attempt: record.attempt ?? null,
    payload:
      record.payload === undefined ? null : JSON.stringify(record.payload),
  };
}

function fromWireRecord(raw: unknown): CastleLaneRecord | null {
  if (!isObject(raw)) return null;
  const at = raw.at;
  const kind = raw.kind;
  if (typeof at !== "string" || typeof kind !== "string") return null;
  const record: CastleLaneRecord = { at, kind };
  if (typeof raw.worker_id === "string") record.worker_id = raw.worker_id;
  if (typeof raw.supervisor_id === "string")
    record.supervisor_id = raw.supervisor_id;
  if (typeof raw.issue === "number") record.issue = raw.issue;
  if (typeof raw.attempt === "number") record.attempt = raw.attempt;
  if (typeof raw.payload === "string" && raw.payload.length > 0) {
    try {
      const payload = JSON.parse(raw.payload) as unknown;
      if (isObject(payload)) record.payload = payload;
    } catch {
      return null;
    }
  }
  try {
    return validateCastleLaneRecord(record);
  } catch {
    return null;
  }
}

export interface CastleLaneWriterOptions {
  readonly path: string;
}

export class CastleLaneWriter {
  readonly path: string;
  private readonly emitter: ToonlLineEmitter = encodeLines();
  private ensuredDir = false;

  constructor(options: CastleLaneWriterOptions) {
    this.path = options.path;
  }

  async append(record: CastleLaneRecord): Promise<CastleLaneRecord> {
    if (!this.path) {
      throw new CastleLaneRecordError("castle lane: need <path>");
    }
    const wire = toWireRecord(record);
    if (!this.ensuredDir) {
      await mkdir(dirname(this.path), { recursive: true });
      this.ensuredDir = true;
    }
    await appendFile(this.path, this.emitter.push(wire), "utf8");
    return record;
  }
}

export async function readCastleLaneRecords(
  path: string,
): Promise<CastleLaneRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const records: CastleLaneRecord[] = [];
  try {
    for (const record of parseRecords(raw)) {
      const parsed = fromWireRecord(record);
      if (parsed) records.push(parsed);
    }
  } catch {
    return records;
  }
  return records;
}

export async function writeCastleStateSnapshot(
  path: string,
  snapshot: CastleStateSnapshot,
): Promise<CastleStateSnapshot> {
  if (!path) throw new CastleLaneRecordError("castle state: need <path>");
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, encode(snapshot as unknown as JsonValue), "utf8");
  await rename(tmp, path);
  return snapshot;
}

function historyPayload(record: CastleHistoryRecord): Record<string, unknown> {
  return {
    epoch: record.epoch,
    event: record.event,
    duration_s: record.duration_s,
    runner: record.runner,
    ...(record.merge_sha ? { merge_sha: record.merge_sha } : {}),
    ...(record.reason ? { reason: record.reason } : {}),
  };
}

export async function appendCastleHistoryEvent(
  path: string,
  record: CastleHistoryRecord,
): Promise<CastleLaneRecord> {
  const laneRecord: CastleLaneRecord = {
    at: record.ts,
    kind: `history.${record.event}`,
    worker_id: record.worker,
    issue: record.issue,
    payload: historyPayload(record),
  };
  await new CastleLaneWriter({ path }).append(laneRecord);
  return laneRecord;
}
