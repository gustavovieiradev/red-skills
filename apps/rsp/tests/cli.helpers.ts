import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { connect } from "@reddb-io/sdk";
import { decode, parseRecords } from "@reddb-io/toon";
import { afterAll, afterEach, expect } from "vitest";
import { RspElisionStore } from "../src/elision-store.js";
import { resolveResidentPaths } from "../src/resident-client.js";
import { sendResidentRequest } from "../src/resident-protocol.js";
import {
  RSP_ACCOUNTING_EVENTS_COLLECTION,
  RSP_DECISIONS_COLLECTION,
  RSP_TELEMETRY_DEGRADATIONS_COLLECTION,
  RSP_TELEMETRY_INVOCATIONS_COLLECTION,
  telemetrySpoolPath,
} from "../src/telemetry.js";

export {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  dirname,
  join,
  tmpdir,
  spawn,
  spawnSync,
  createRequire,
  createHash,
  randomUUID,
  createServer,
  connect,
  decode,
  parseRecords,
  RspElisionStore,
  resolveResidentPaths,
  sendResidentRequest,
  RSP_ACCOUNTING_EVENTS_COLLECTION,
  RSP_DECISIONS_COLLECTION,
  RSP_TELEMETRY_DEGRADATIONS_COLLECTION,
  RSP_TELEMETRY_INVOCATIONS_COLLECTION,
  telemetrySpoolPath,
};

export const roots: string[] = [];
export const residentDirs: string[] = [];
export const residentPathsBySocket = new Map<string, ReturnType<typeof resolveResidentPaths>>();
export const cli = join(import.meta.dirname, "..", "src", "cli.ts");
export const packageRoot = join(import.meta.dirname, "..");
export const repoRoot = join(packageRoot, "..", "..");
export const bundle = join(repoRoot, "dist", "rsp.bundle.min.mjs");
export const require = createRequire(import.meta.url);
export const tsxLoader = require.resolve("tsx");
export let bundleBuilt = false;

export async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rsp-cli-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  const rootsToRemove = roots.splice(0);
  await stopTrackedResidents(rootsToRemove);
  const residentDirsToRemove = residentDirs.splice(0);
  await Promise.all(rootsToRemove.map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(residentDirsToRemove.map((dir) => rm(dir, { recursive: true, force: true })));
});

afterAll(async () => {
  await stopTrackedResidents([]);
});

export function trackedResidentPaths(root: string) {
  const paths = resolveResidentPaths(root);
  residentPathsBySocket.set(paths.socketPath, paths);
  residentDirs.push(dirname(paths.socketPath));
  return paths;
}

export function runRsp(root: string, args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cli, ...args], {
    cwd: root,
    env: testChildEnv(env),
    encoding: "buffer",
  });
}

export function runRspFromCwd(cwd: string, args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cli, ...args], {
    cwd,
    env: testChildEnv(env),
    encoding: "buffer",
  });
}

export function runGit(args: string[]) {
  return spawnSync("git", args, { encoding: "buffer" });
}

export function runShellFromCwd(cwd: string, command: string) {
  return spawnSync(command, {
    cwd,
    shell: true,
    encoding: "buffer",
  });
}

export function runNodeNoop() {
  return spawnSync(process.execPath, ["-e", ""], { encoding: "buffer" });
}

export function runBundleFromCwd(cwd: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [bundle, ...args], {
    cwd,
    env: testChildEnv(env),
    encoding: "buffer",
  });
}

export function runBundleHookFromCwd(cwd: string, command: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [bundle, "hook", "claude-pre-exec"], {
    cwd,
    env: testChildEnv(env),
    input: Buffer.from(JSON.stringify({ cwd, tool_input: { command } })),
    encoding: "buffer",
  });
}

export function runBundleCodexHookFromCwd(cwd: string, command: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [bundle, "hook", "codex-pre-exec"], {
    cwd,
    env: testChildEnv(env),
    input: Buffer.from(JSON.stringify({ cwd, tool_name: "bash", tool_input: { command } })),
    encoding: "buffer",
  });
}

export function runBundleFromCwdAsync(cwd: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<{ status: number | null; stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
    const child = spawn(process.execPath, [bundle, ...args], {
      cwd,
      env: testChildEnv(env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

export function timedStatus(command: () => ReturnType<typeof spawnSync>): {
  status: number | null;
  elapsedMs: number;
  stdout: Buffer;
  stderr: Buffer;
} {
  const started = process.hrtime.bigint();
  const result = command();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return { status: result.status, elapsedMs, stdout: result.stdout as Buffer, stderr: result.stderr as Buffer };
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export type LatencyBudgetSample = { valueMs: number; baselineMs: number; details: string };

export function budgetSample(valueMs: number, baselineMs: number, details: string): LatencyBudgetSample {
  return { valueMs, baselineMs, details };
}

export function latencyRatio(sample: LatencyBudgetSample): number {
  return sample.valueMs / Math.max(1, sample.baselineMs);
}

export function latencyBudgetDetails(sample: LatencyBudgetSample): string {
  return `${sample.details}; ratio=${latencyRatio(sample).toFixed(2)}x baseline=${sample.baselineMs.toFixed(1)}ms`;
}

export function normalizedTimeoutMs(baselineMs: number, multiplier: number, minMs: number): number {
  return Math.max(normalizedDurationMs(minMs, baselineMs), Math.ceil(Math.max(1, baselineMs) * multiplier));
}

export const REFERENCE_NODE_NOOP_MS = 25;
export const TEST_NODE_NOOP_BASELINE_MS = timedStatus(runNodeNoop).elapsedMs;

export function localBaselineRatio(baselineMs = TEST_NODE_NOOP_BASELINE_MS): number {
  return Math.max(1, Math.max(1, baselineMs) / REFERENCE_NODE_NOOP_MS);
}

export function normalizedDurationMs(durationMs: number, baselineMs = TEST_NODE_NOOP_BASELINE_MS): number {
  return Math.ceil(durationMs * localBaselineRatio(baselineMs));
}

export function normalizedLatencyRatio(maxRatio: number): number {
  return maxRatio * localBaselineRatio();
}

export function normalizedDeadlineMs(durationMs = 5_000): number {
  return Date.now() + normalizedDurationMs(durationMs);
}

export const TEST_TELEMETRY_DRAIN_TIMEOUT_MS = normalizedTimeoutMs(TEST_NODE_NOOP_BASELINE_MS, 250, 2_000);
export const TEST_RESIDENT_READY_TIMEOUT_MS = normalizedDurationMs(10_000);

export function testChildEnv(env: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RSP_TELEMETRY_DRAIN_TIMEOUT_MS: String(TEST_TELEMETRY_DRAIN_TIMEOUT_MS),
    RSP_RESIDENT_READY_TIMEOUT_MS: String(TEST_RESIDENT_READY_TIMEOUT_MS),
    ...env,
  };
}

export async function idleBeat(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

export async function expectLatencyBudget(
  label: string,
  first: LatencyBudgetSample,
  maxRatio: number,
  retry: () => LatencyBudgetSample | Promise<LatencyBudgetSample>,
): Promise<void> {
  if (latencyRatio(first) <= maxRatio) return;

  await idleBeat();
  const second = await retry();
  expect(
    latencyRatio(second),
    `${label} exceeded ${maxRatio.toFixed(2)}x baseline twice; ` +
      `first ${latencyBudgetDetails(first)}; retry ${latencyBudgetDetails(second)}`,
  ).toBeLessThanOrEqual(maxRatio);
}

export function buildBundleOnce() {
  if (bundleBuilt) return;
  const res = spawnSync("pnpm", ["-C", "apps/rsp", "build"], {
    cwd: repoRoot,
    encoding: "buffer",
  });
  expect(res.status, `${res.stdout.toString("utf8")}${res.stderr.toString("utf8")}`).toBe(0);
  bundleBuilt = true;
}

export async function initGitRepo(): Promise<string> {
  const root = await tempRoot();
  const init = runGit(["-C", root, "init"]);
  expect(init.status).toBe(0);
  expect(runGit(["-C", root, "config", "user.email", "rsp-test@example.invalid"]).status).toBe(0);
  expect(runGit(["-C", root, "config", "user.name", "Rsp Test"]).status).toBe(0);
  return root;
}

export async function enableRsp(root: string): Promise<void> {
  await mkdir(join(root, ".red"), { recursive: true });
  await writeFile(join(root, ".red", "config.yaml"), "rsp:\n  enabled: true\n", "utf8");
}

export async function commitMany(root: string, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await writeFile(join(root, `file-${i}.txt`), `line ${i}\n`, "utf8");
    expect(runGit(["-C", root, "add", `file-${i}.txt`]).status).toBe(0);
    expect(runGit(["-C", root, "commit", "-m", `commit ${i}`]).status).toBe(0);
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function fakeGhPath(root: string, responses: Array<Record<string, unknown>>): Promise<{ path: string; responsesDir: string; countFile: string }> {
  const bin = join(root, "bin");
  const responsesDir = join(root, "gh-responses");
  await mkdir(bin, { recursive: true });
  await mkdir(responsesDir, { recursive: true });
  for (let i = 0; i < responses.length; i++) {
    await writeFile(join(responsesDir, `${i + 1}.json`), JSON.stringify(responses[i]), "utf8");
  }
  await writeFile(join(responsesDir, "default.json"), JSON.stringify(responses.at(-1) ?? {}), "utf8");
  const gh = join(bin, "gh");
  await writeFile(
    gh,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'count_file="$GH_FAKE_RESPONSES/count"',
      "count=0",
      'if [ -f "$count_file" ]; then count="$(cat "$count_file")"; fi',
      'next="$((count + 1))"',
      'printf "%s" "$next" > "$count_file"',
      'response="$GH_FAKE_RESPONSES/$next.json"',
      'if [ ! -f "$response" ]; then response="$GH_FAKE_RESPONSES/default.json"; fi',
      'cat "$response"',
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(gh, 0o755);
  return { path: `${bin}:${process.env.PATH ?? ""}`, responsesDir, countFile: join(responsesDir, "count") };
}

export async function runMcpRequests(
  cwd: string,
  requests: Array<Record<string, unknown>>,
  entry: "source" | "bundle" = "source",
): Promise<Array<Record<string, unknown>>> {
  return await new Promise((resolve, reject) => {
    const timeoutMs = normalizedTimeoutMs(timedStatus(runNodeNoop).elapsedMs, 250, 10_000);
    const expectedResponses = requests.filter((request) => "id" in request).length;
    if (entry === "bundle") buildBundleOnce();
    const childArgs = entry === "bundle" ? [bundle, "mcp"] : ["--import", tsxLoader, cli, "mcp"];
    const child = spawn(process.execPath, childArgs, {
      cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const responses: Array<Record<string, unknown>> = [];
    let stdout = "";
    let stderr = "";
    let buffer = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out waiting for rsp mcp responses; stderr=${stderr}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        responses.push(JSON.parse(line) as Record<string, unknown>);
        if (responses.filter((response) => response.id != null).length >= expectedResponses) {
          clearTimeout(timeout);
          child.kill();
          resolve(responses);
        }
      }
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (status) => {
      if (responses.filter((response) => response.id != null).length < expectedResponses) {
        clearTimeout(timeout);
        reject(new Error(`rsp mcp exited early with ${status}; stdout=${stdout}; stderr=${stderr}`));
      }
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

export async function seedWarmRedCache(): Promise<string> {
  const root = await tempRoot();
  const cacheDir = join(root, "bundles");
  const runtimeDir = join(cacheDir, "reddb", "1.7.0");
  await mkdir(runtimeDir, { recursive: true });
  const redPath = join(packageRoot, "node_modules", "@reddb-io", "sdk", "bin", process.platform === "win32" ? "red.exe" : "red");
  const redBytes = await readFile(redPath);
  await copyFile(redPath, join(runtimeDir, process.platform === "win32" ? "red.exe" : "red"));
  const checksum = createHash("sha256").update(redBytes).digest("hex");
  await writeFile(join(runtimeDir, `${process.platform === "win32" ? "red.exe" : "red"}.sha256`), `${checksum}  red\n`, "utf8");
  return cacheDir;
}

export async function waitForGone(path: string, timeoutMs = normalizedDurationMs(5_000)): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`still present after ${timeoutMs}ms: ${path}`);
}

export async function waitForActiveWait(root: string, reason: string): Promise<Record<string, unknown>> {
  const deadline = normalizedDeadlineMs();
  let last: unknown[] = [];
  while (Date.now() < deadline) {
    const listed = runRsp(root, ["wait", "ls"], {});
    expect(listed.status).toBe(0);
    last = (decode(listed.stdout.toString("utf8")) as { waits: unknown[] }).waits;
    const match = last.find((entry) => isRecord(entry) && entry.reason === reason);
    if (isRecord(match)) return match;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`active wait not found for ${reason}; last=${JSON.stringify(last)}`);
}

export async function closeWithTimeout(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number | null> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
}

export async function waitForResidentSocket(root: string): Promise<void> {
  const paths = trackedResidentPaths(root);
  const deadline = normalizedDeadlineMs();
  while (Date.now() < deadline) {
    try {
      await stat(paths.socketPath);
      return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stat(paths.socketPath);
}

export async function waitForResidentReady(root: string): Promise<void> {
  const socketPath = trackedResidentPaths(root).socketPath;
  const deadline = normalizedDeadlineMs();
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await sendResidentRequest(
        { socketPath, timeoutMs: 500 },
        {
          id: randomUUID(),
          op: "mint",
          original: Buffer.from("resident-ready").toString("base64"),
          meta: {
            command: "resident-ready",
            loss: { level: "terse", bytes_elided: Buffer.byteLength("resident-ready") },
          },
        },
      );
      if (response.ok) return;
      last = new Error(response.error);
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw last instanceof Error ? last : new Error("resident ready probe failed");
}

export async function expectWarmResident(root: string, env: Record<string, string> = {}): Promise<void> {
  const warm = runBundleFromCwd(root, ["warm-resident"], env);
  expect(warm.status, `${warm.stdout.toString("utf8")}${warm.stderr.toString("utf8")}`).toBe(0);
  expect(warm.stdout).toEqual(Buffer.alloc(0));
  expect(warm.stderr).toEqual(Buffer.alloc(0));
  await waitForResidentReady(root);
}

export async function waitForSummaryTokens(root: string, minTokens: number): Promise<number> {
  const summaryPath = resolveResidentPaths(root).summaryPath;
  const deadline = normalizedDeadlineMs();
  let last = 0;
  while (Date.now() < deadline) {
    try {
      const summary = parseStructured(await readFile(summaryPath, "utf8")) as { tokens_saved_today?: unknown };
      last = typeof summary.tokens_saved_today === "number" ? summary.tokens_saved_today : 0;
      if (last > minTokens) return last;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(last).toBeGreaterThan(minTokens);
  return last;
}

export function parseStructured(raw: string): unknown {
  const body = raw.trim();
  if (!body) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return decode(body);
  }
}

export async function readResidentVersion(root: string): Promise<string | undefined> {
  const socketPath = trackedResidentPaths(root).socketPath;
  const deadline = normalizedDeadlineMs();
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await sendResidentRequest(
        { socketPath, timeoutMs: 500 },
        { id: "version", op: "ping" },
      );
      const value = response.ok && isRecord(response.value) ? response.value : {};
      const version = typeof value.version === "string" ? value.version : undefined;
      if (version) return version;
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw last instanceof Error ? last : new Error("resident version probe failed");
}

export async function startHungOldResident(socketPath: string, version: string): Promise<Server> {
  await mkdir(dirname(socketPath), { recursive: true });
  const server = createServer((socket) => handleHungOldResidentSocket(socket, version));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

export function handleHungOldResidentSocket(socket: Socket, version: string): void {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const request = JSON.parse(buffer.slice(0, newline)) as { id?: string; op?: string };
    if (request.op === "ping") {
      socket.write(`${JSON.stringify({ id: request.id, ok: true, value: { pong: true, version } })}\n`, () => {});
      socket.end();
    }
  });
}

export async function readTelemetryRecords(storeUri: string, collection: string): Promise<unknown[]> {
  const db = await connect(storeUri);
  try {
    const raw = await db.kv(collection).list({ limit: 1000 }).catch((err) => {
      if (err instanceof Error && /\bnot found\b/i.test(err.message)) return { items: [] };
      throw err;
    });
    return raw.items.map((entry) => typeof entry.value === "string" ? JSON.parse(entry.value) as unknown : entry.value);
  } finally {
    await db.close();
  }
}

export async function readSpoolEvents(root: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(telemetrySpoolPath(root), "utf8").catch(() => "");
  return parseSpoolRows(raw).flatMap((row) => {
    if (typeof row.event_json !== "string") {
      const { spool_id: _spoolId, ...event } = row;
      return typeof event.collection === "string" ? [event] : [];
    }
    try {
      const event = JSON.parse(row.event_json) as unknown;
      return isRecord(event) ? [event] : [];
    } catch {
      return [];
    }
  });
}

export function parseSpoolRows(raw: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  let header = "";
  for (const line of raw.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    if (/^\[(?:\d*)\]\{[^}]+\}:$/.test(line)) {
      header = line;
      continue;
    }
    if (!header) continue;
    for (const row of parseRecords(`${header}\n${line}\n`)) {
      if (isRecord(row)) rows.push(row);
    }
  }
  return rows;
}

export async function waitForTelemetryInvocations(storeUri: string, command: string, minCount: number): Promise<unknown[]> {
  const deadline = normalizedDeadlineMs();
  let records: unknown[] = [];
  while (Date.now() < deadline) {
    records = await readTelemetryRecords(storeUri, RSP_ACCOUNTING_EVENTS_COLLECTION);
    if (records.filter((entry) => isRecord(entry) && entry.command === command).length >= minCount) return records;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(records.filter((entry) => isRecord(entry) && entry.command === command).length).toBeGreaterThanOrEqual(minCount);
  return records;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractHandle(output: Buffer): string {
  const match = /rsp show (el:[a-f0-9]{12})/.exec(output.toString("utf8"));
  expect(match?.[1]).toBeTruthy();
  return match![1];
}

export async function stopTrackedResidents(extraRoots: string[]): Promise<void> {
  const paths = uniqueResidentPaths(extraRoots);
  residentPathsBySocket.clear();
  await Promise.all(paths.map((path) => stopResident(path)));
}

export function uniqueResidentPaths(extraRoots: string[]): Array<ReturnType<typeof resolveResidentPaths>> {
  const paths = new Map(residentPathsBySocket);
  for (const root of extraRoots) {
    const resolved = resolveResidentPaths(root);
    paths.set(resolved.socketPath, resolved);
  }
  return [...paths.values()];
}

export async function countTrackedResidentProcesses(extraRoots: string[] = []): Promise<number> {
  let count = 0;
  for (const paths of uniqueResidentPaths(extraRoots)) {
    const pid = await readPid(paths.pidPath);
    if (pid != null && isPidAlive(pid)) count++;
  }
  return count;
}

export async function stopResident(paths: ReturnType<typeof resolveResidentPaths>): Promise<void> {
  const pid = await readPid(paths.pidPath);
  if (await pathExists(paths.socketPath)) {
    await sendResidentRequest(
      { socketPath: paths.socketPath, timeoutMs: 500 },
      { id: randomUUID(), op: "handover", clientVersion: "9999.0.0" },
    ).catch(() => undefined);
    await waitForGone(paths.socketPath, normalizedDurationMs(2_000)).catch(() => undefined);
  }
  if (pid != null && pid !== process.pid && isPidAlive(pid)) {
    killResidentPid(pid, "SIGTERM");
    await waitForPidGone(pid, normalizedDurationMs(1_000)).catch(() => {
      killResidentPid(pid, "SIGKILL");
    });
    await waitForPidGone(pid, normalizedDurationMs(1_000)).catch(() => undefined);
  }
  await rm(paths.socketPath, { force: true });
  await rm(paths.pidPath, { force: true });
}

export async function readPid(path: string): Promise<number | null> {
  const text = await readFile(path, "utf8").catch(() => "");
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killResidentPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

export async function waitForPidGone(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (isPidAlive(pid)) throw new Error(`process ${pid} still alive after ${timeoutMs}ms`);
}

