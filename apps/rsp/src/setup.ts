import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ensureRepoRedDaemon, REPO_REDB_STORE_PATH } from "@reddb-io/shared/repo-red-daemon.js";
import { DEFAULT_RSP_HEAVY_GIT_BYTE_THRESHOLD } from "./config.js";
import { DEFAULT_RSP_BYTE_BUDGET, DEFAULT_RSP_TTL_DAYS } from "./elision-store.js";

export const REPO_STORE_PATH = REPO_REDB_STORE_PATH;

export interface RspProvisionOptions {
  ttlDays?: number;
  byteBudget?: number;
  heavyGitByteThreshold?: number;
}

export interface RspProvisionResult {
  configPath: string;
  storePath: string;
  configChanged: boolean;
  storeCreated: boolean;
  memoryStoreMigrated: boolean;
}

export async function provisionRspRepoStore(rootDir: string, opts: RspProvisionOptions = {}): Promise<RspProvisionResult> {
  const root = resolve(rootDir);
  const redDir = join(root, ".red");
  const configPath = join(redDir, "config.yaml");
  const storePath = join(root, REPO_STORE_PATH);
  await mkdir(redDir, { recursive: true });
  // The store lives under .red/tmp/, which need not exist yet.
  await mkdir(dirname(storePath), { recursive: true });

  let existing = "";
  try {
    existing = await readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const migrated = await migrateMemoryStoreBlock(root, existing);
  const next = mergeRspBlock(migrated.text, {
    enabled: true,
    ttlDays: opts.ttlDays ?? DEFAULT_RSP_TTL_DAYS,
    byteBudget: opts.byteBudget ?? DEFAULT_RSP_BYTE_BUDGET,
    heavyGitByteThreshold: opts.heavyGitByteThreshold ?? DEFAULT_RSP_HEAVY_GIT_BYTE_THRESHOLD,
  });
  const configChanged = next !== existing;
  if (configChanged) await writeFile(configPath, next, "utf8");

  const storeCreated = !(await exists(storePath));
  if (storeCreated && migrated.legacyStorePath && await exists(migrated.legacyStorePath)) {
    await copyFile(migrated.legacyStorePath, storePath);
  } else if (storeCreated) {
    await ensureRepoRedDaemon(storePath);
  }

  return {
    configPath,
    storePath,
    configChanged,
    storeCreated,
    memoryStoreMigrated: migrated.changed,
  };
}

export interface RspConfigBlock {
  enabled: boolean;
  ttlDays: number;
  byteBudget: number;
  heavyGitByteThreshold: number;
}

export function mergeRspBlock(existingText: string, block: RspConfigBlock): string {
  const rspLines = [
    "rsp:",
    `  enabled: ${block.enabled ? "true" : "false"}`,
    `  ttlDays: ${positiveNumber(block.ttlDays, DEFAULT_RSP_TTL_DAYS)}`,
    `  byteBudget: ${positiveNumber(block.byteBudget, DEFAULT_RSP_BYTE_BUDGET)}`,
    `  heavyGitByteThreshold: ${positiveNumber(block.heavyGitByteThreshold, DEFAULT_RSP_HEAVY_GIT_BYTE_THRESHOLD)}`,
  ];
  const lines = existingText === "" ? [] : existingText.replace(/\n+$/, "").split("\n");
  const start = findTopLevelBlock(lines, "rsp");

  if (start === -1) {
    const out = [...lines];
    if (out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
    out.push(...rspLines);
    return `${out.join("\n")}\n`;
  }

  const end = findBlockEnd(lines, start, 0);
  const out = [...lines.slice(0, start), ...rspLines, ...lines.slice(end)];
  return `${out.join("\n")}\n`;
}

function findTopLevelBlock(lines: string[], key: string): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isStructural(line) && lineIndent(line) === 0 && topKey(line) === key) return i;
  }
  return -1;
}

function findBlockEnd(lines: string[], start: number, indent: number): number {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isStructural(lines[i]!) && lineIndent(lines[i]!) <= indent) {
      end = i;
      break;
    }
  }
  while (end - 1 > start && lines[end - 1]!.trim() === "") end--;
  return end;
}

function lineIndent(line: string): number {
  return (line.match(/^ */)?.[0] ?? "").length;
}

function isStructural(line: string): boolean {
  const t = line.trim();
  return t !== "" && !t.startsWith("#");
}

function topKey(line: string): string {
  return line.replace(/^ */, "").replace(/:.*$/, "").trim();
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function migrateMemoryStoreBlock(
  root: string,
  existing: string,
): Promise<{ text: string; changed: boolean; legacyStorePath: string | null }> {
  const flat = parseYamlFlat(existing);
  const mode = flat["plugins.memory.mode"];
  if (!mode || mode === "markdown-only") return { text: existing, changed: false, legacyStorePath: null };
  const current = flat["plugins.memory.storePath"] ?? ".red/memory/graph.rdb";
  if (current === REPO_STORE_PATH) return { text: existing, changed: false, legacyStorePath: null };

  const legacyStorePath = current.startsWith("/") ? current : join(root, current);
  const lines = existing === "" ? [] : existing.replace(/\n+$/, "").split("\n");
  const storeLine = findYamlPathLine(lines, ["plugins", "memory", "storePath"]);
  if (storeLine >= 0) {
    lines[storeLine] = `    storePath: ${REPO_STORE_PATH}`;
    return { text: `${lines.join("\n")}\n`, changed: true, legacyStorePath };
  }
  const memoryLine = findYamlPathLine(lines, ["plugins", "memory"]);
  if (memoryLine >= 0) {
    lines.splice(memoryLine + 1, 0, `    storePath: ${REPO_STORE_PATH}`);
    return { text: `${lines.join("\n")}\n`, changed: true, legacyStorePath };
  }
  return { text: existing, changed: false, legacyStorePath: null };
}

function parseYamlFlat(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const stack: Array<{ indent: number; key: string }> = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const indent = line.length - line.trimStart().length;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    stack.push({ indent, key });
    if (value !== "") out[stack.map((entry) => entry.key).join(".")] = value;
  }
  return out;
}

function findYamlPathLine(lines: string[], path: string[]): number {
  const stack: Array<{ indent: number; key: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isStructural(line)) continue;
    const indent = lineIndent(line);
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    stack.push({ indent, key: topKey(line) });
    if (stack.map((entry) => entry.key).join(".") === path.join(".")) return i;
  }
  return -1;
}
