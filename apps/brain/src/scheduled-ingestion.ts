import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { decodeSnapshotDocument, encodeSnapshotToon } from "@reddb-io/shared/toon-migration.js";
import type { ChannelBridge } from "./channel-bridge.js";
import { ingestEvents } from "./ingest-events.js";
import type { BrainStoreLike } from "./store.js";

export interface IngestionState {
  cursor?: number | string;
  lastRunAt?: string;
}

export interface ScheduledIngestInput {
  bridge: ChannelBridge;
  store: BrainStoreLike;
  state: IngestionState;
  sessionKey?: string;
  limit?: number;
  sourceAgent?: string;
}

export interface ScheduledIngestResult {
  polled: number;
  captured: number;
  skipped: number;
  state: IngestionState;
}

export async function scheduledIngest(input: ScheduledIngestInput): Promise<ScheduledIngestResult> {
  const result = await ingestEvents({
    bridge: input.bridge,
    store: input.store,
    afterCursor: input.state.cursor,
    sessionKey: input.sessionKey,
    limit: input.limit,
    sourceAgent: input.sourceAgent,
  });

  const nextState: IngestionState = {
    cursor: result.nextCursor ?? input.state.cursor,
    lastRunAt: new Date().toISOString(),
  };

  return {
    polled: result.polled,
    captured: result.captured,
    skipped: result.skipped,
    state: nextState,
  };
}

export async function loadIngestionState(path: string): Promise<IngestionState> {
  try {
    const text = await readFile(path, "utf8");
    return decodeSnapshotDocument(text) as IngestionState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function saveIngestionState(path: string, state: IngestionState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const snapshot = Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined)) as IngestionState;
  await writeFile(path, `${encodeSnapshotToon(snapshot as Parameters<typeof encodeSnapshotToon>[0])}\n`, "utf8");
}
