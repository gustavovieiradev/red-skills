// runtime/red-path-migration.ts — the real-fs executor behind the one-time boot
// migration (core/red-path-migration.ts owns the pure legacy → canonical plan).
// Best-effort throughout: a boot must never fail because a legacy artifact could
// not be relocated, so every fs error is swallowed and the artifact is simply
// left where it is (a later reader's legacy fallback still finds it).
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JsonValue } from "@reddb-io/toon";
import { appendCastleHistoryRecord } from "@reddb-io/red-castle/engine";
import {
  legacyMonitorCursorMigrations,
  legacySupervisorRestartMigrations,
  legacySupervisorStateMigrations,
  migrationActionFor,
  planDevDurablePathMigration,
  supervisorLogMigration,
  type DevPathMigrationEntry,
} from "../core/red-path-migration.js";
import { parseHistoryLines } from "../core/history.js";
import { decodeDevSnapshotSniff, encodeDevSnapshotToon } from "../core/toon-snapshot.js";
import { afkStateDir, legacyAfkStateDir, stateDir, tmpDir } from "@reddb-io/shared/red-paths.js";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Move `legacy` → `current` iff only the legacy copy exists. Returns true when
 * the move happened. Ambiguous (both present) and absent states are no-ops and
 * NEVER delete the legacy copy. */
async function moveIfSafe(legacy: string, current: string): Promise<boolean> {
  const [legacyExists, currentExists] = await Promise.all([pathExists(legacy), pathExists(current)]);
  if (migrationActionFor(legacyExists, currentExists) !== "move") return false;
  try {
    await mkdir(dirname(current), { recursive: true });
    await rename(legacy, current);
    return true;
  } catch {
    // Cross-device rename, a racing peer, or a permissions hiccup — leave the
    // legacy copy untouched so nothing is lost.
    return false;
  }
}

async function transformIfSafe(
  entry: DevPathMigrationEntry,
  transform: (bytes: string) => string,
): Promise<boolean> {
  const [legacyExists, currentExists] = await Promise.all([pathExists(entry.legacy), pathExists(entry.current)]);
  if (migrationActionFor(legacyExists, currentExists) !== "move") return false;
  try {
    const bytes = await readFile(entry.legacy, "utf8");
    const out = transform(bytes);
    await mkdir(dirname(entry.current), { recursive: true });
    const tmp = `${entry.current}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, out, "utf8");
    await rename(tmp, entry.current);
    await rm(entry.legacy, { force: true });
    return true;
  } catch {
    return false;
  }
}

export interface DevPathMigrationResult {
  /** Ids/basenames of the artifacts actually relocated this boot. */
  moved: string[];
}

async function convertLegacyJsonlHistoryIfSafe(root: string): Promise<boolean> {
  const legacy = join(stateDir(root), "afk-history.jsonl");
  const current = join(afkStateDir(root), "history.toonl");
  const [legacyExists, currentExists] = await Promise.all([pathExists(legacy), pathExists(current)]);
  if (migrationActionFor(legacyExists, currentExists) !== "move") return false;
  try {
    const records = parseHistoryLines(await readFile(legacy, "utf8"));
    await mkdir(dirname(current), { recursive: true });
    const tmp = `${current}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, "", "utf8");
    for (const record of records) await appendCastleHistoryRecord(tmp, record);
    await rename(tmp, current);
    await rm(legacy, { force: true });
    return true;
  } catch {
    return false;
  }
}

function convertLegacySupervisorState(bytes: string): string {
  const decoded = decodeDevSnapshotSniff(bytes) as Record<string, unknown>;
  if (decoded.kind === "supervisor") {
    return encodeDevSnapshotToon({
      ...decoded,
      id: "fleet",
      supervisor_id: "fleet",
      kind: "supervisor",
      version: typeof decoded.version === "number" ? decoded.version : 1,
    });
  }
  const slots = decoded.slots && typeof decoded.slots === "object" && !Array.isArray(decoded.slots)
    ? decoded.slots as Record<string, unknown>
    : {};
  const epoch = Number(decoded.epoch ?? 0);
  return encodeDevSnapshotToon({
    kind: "supervisor",
    id: "fleet",
    supervisor_id: "fleet",
    version: 1,
    updated_at: typeof decoded.ts === "string" ? decoded.ts : new Date((Number.isFinite(epoch) ? epoch : 0) * 1000).toISOString(),
    runner: typeof decoded.runner === "string" ? decoded.runner : "",
    ...(typeof decoded.bundle_version === "string" ? { bundle_version: decoded.bundle_version } : {}),
    current: {
      epoch: Number.isFinite(epoch) && epoch > 0 ? epoch : Math.floor(Date.now() / 1000),
      ...(decoded.last_progress_epoch !== undefined ? { last_progress_epoch: Number(decoded.last_progress_epoch) || 0 } : {}),
      ready_for_agent: Number(decoded.ready_for_agent ?? 0) || 0,
      slots: {
        busy: Number(slots.busy ?? 0) || 0,
        free: Number(slots.free ?? 0) || 0,
        total: Number(slots.total ?? 0) || 0,
        parked: Number(slots.parked ?? 0) || 0,
      },
      spawns_this_tick: Number(decoded.spawns_this_tick ?? 0) || 0,
    },
    queue: [],
    completed: [],
  });
}

function convertSnapshotToToon(bytes: string): string {
  return encodeDevSnapshotToon(decodeDevSnapshotSniff(bytes) as JsonValue);
}

/**
 * Relocate every dev-owned durable artifact from its legacy `.red/tmp` home to
 * the state tier, once and idempotently. A second boot (legacy already gone) is a
 * pure no-op. Safe to call on every boot.
 */
export async function migrateLegacyDevPaths(root: string): Promise<DevPathMigrationResult> {
  const moved: string[] = [];
  for (const entry of planDevDurablePathMigration(root)) {
    if (await moveIfSafe(entry.legacy, entry.current)) moved.push(entry.id);
  }
  for (const entry of legacySupervisorStateMigrations(root)) {
    if (await transformIfSafe(entry, convertLegacySupervisorState)) moved.push(entry.id);
  }
  for (const entry of legacyMonitorCursorMigrations(root)) {
    if (await transformIfSafe(entry, convertSnapshotToToon)) moved.push(entry.id);
  }
  for (const entry of legacySupervisorRestartMigrations(root)) {
    if (await transformIfSafe(entry, convertSnapshotToToon)) moved.push(entry.id);
  }
  if (await convertLegacyJsonlHistoryIfSafe(root)) moved.push("afk-history.jsonl");
  // Rotated supervisor launch logs (afk-supervisor.log, .log.N) plus the old
  // TOONL firehose name (afk-supervisor.log.jsonl -> afk-supervisor.log.toonl).
  const { currentDir, logPrefix } = supervisorLogMigration(root);
  for (const legacyDir of [tmpDir(root), legacyAfkStateDir(root), afkStateDir(root)]) {
    let entries: string[] = [];
    try {
      entries = await readdir(legacyDir);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      if (!name.startsWith(logPrefix)) continue;
      const legacy = join(legacyDir, name);
      if (name === "afk-supervisor.log") {
        await rm(legacy, { force: true }).catch(() => undefined);
        moved.push(name);
        continue;
      }
      const currentName = "supervisor.log.toonl";
      if (await moveIfSafe(legacy, join(currentDir, currentName))) moved.push(name);
    }
  }
  return { moved };
}
