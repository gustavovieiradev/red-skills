import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decode, encode, type JsonValue } from "@reddb-io/toon";

export type RegisteredSurfaceKind = "toon" | "toonl";

export interface RegisteredToonSurface {
  id: string;
  legacyPath: string;
  toonPath: string;
  kind: RegisteredSurfaceKind;
}

export interface ToonMigrationReport {
  status: "converted" | "noop" | "refused";
  converted: string[];
  skipped: string[];
  missing: string[];
  reasons: string[];
}

export interface SurfaceReadResult {
  surface: RegisteredToonSurface;
  path: string;
  format: "json" | "jsonl" | "toon" | "toonl";
  value: unknown;
}

export const MEMORY_TOON_SURFACES: readonly RegisteredToonSurface[] = [
  {
    id: "dev.statusline-cache",
    legacyPath: ".red/tmp/statusline-cache.json",
    toonPath: ".red/tmp/statusline-cache.toon",
    kind: "toon",
  },
];

export async function convertRegisteredToonSurfaces(opts: {
  rootDir: string;
  surfaces?: readonly RegisteredToonSurface[];
}): Promise<ToonMigrationReport> {
  const surfaces = opts.surfaces ?? MEMORY_TOON_SURFACES;
  const reasons = await quiescenceReasons(opts.rootDir);
  if (reasons.length > 0) {
    return { status: "refused", converted: [], skipped: [], missing: [], reasons };
  }

  const converted: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];

  for (const surface of surfaces) {
    const target = join(opts.rootDir, surface.toonPath);
    if (await pathExists(target)) {
      skipped.push(surface.id);
      continue;
    }

    const legacy = join(opts.rootDir, surface.legacyPath);
    if (!(await pathExists(legacy))) {
      missing.push(surface.id);
      continue;
    }

    const value = await readLegacyFile(legacy, surface.kind);
    const body = renderSurface(value, surface.kind);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, "utf8");
    converted.push(surface.id);
  }

  return {
    status: converted.length > 0 ? "converted" : "noop",
    converted,
    skipped,
    missing,
    reasons: [],
  };
}

export async function readRegisteredSurface(
  rootDir: string,
  surfaceId: string,
  surfaces: readonly RegisteredToonSurface[] = MEMORY_TOON_SURFACES,
): Promise<SurfaceReadResult> {
  const surface = surfaces.find((candidate) => candidate.id === surfaceId);
  if (!surface) throw new Error(`unknown registered TOON surface: ${surfaceId}`);

  const converted = join(rootDir, surface.toonPath);
  if (await pathExists(converted)) {
    const value = await readConvertedFile(converted, surface.kind);
    return { surface, path: converted, format: surface.kind, value };
  }

  const legacy = join(rootDir, surface.legacyPath);
  const value = await readLegacyFile(legacy, surface.kind);
  return { surface, path: legacy, format: surface.kind === "toonl" ? "jsonl" : "json", value };
}

async function quiescenceReasons(rootDir: string): Promise<string[]> {
  const reasons: string[] = [];
  const tmpDir = join(rootDir, ".red", "tmp");
  const fleetPid = await readPid(join(tmpDir, "afk-supervisor.pid"));
  if (fleetPid !== null && isLivePid(fleetPid)) reasons.push("active fleet supervisor is running");

  const residentPid = await readPid(join(tmpDir, "resident-memory.pid"));
  if (residentPid !== null && isLivePid(residentPid)) reasons.push("resident memory process is running");

  return reasons;
}

async function readLegacyFile(path: string, kind: RegisteredSurfaceKind): Promise<unknown> {
  const body = await readFile(path, "utf8");
  if (kind === "toonl") {
    return body
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }
  return JSON.parse(body);
}

async function readConvertedFile(path: string, kind: RegisteredSurfaceKind): Promise<unknown> {
  const body = await readFile(path, "utf8");
  if (kind === "toonl") {
    return body
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => decode(line));
  }
  return decode(body);
}

function renderSurface(value: unknown, kind: RegisteredSurfaceKind): string {
  if (kind === "toonl") {
    const rows = Array.isArray(value) ? value : [value];
    return `${rows.map((row) => encode(row as JsonValue)).join("\n")}\n`;
  }
  return encode(value as JsonValue);
}

async function readPid(path: string): Promise<number | null> {
  try {
    const raw = (await readFile(path, "utf8")).trim();
    if (!/^\d+$/.test(raw)) return null;
    const pid = Number(raw);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isLivePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
