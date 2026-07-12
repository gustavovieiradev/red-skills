import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";

export const REPO_REDB_STORE_PATH = ".red/tmp/red-skills.rdb";
export const REPO_REDB_DAEMON_STATE = ".red/tmp/red-skills-daemon.json";
export const REPO_REDB_DAEMON_LOCK = ".red/tmp/red-skills-daemon.lock";

export interface RepoRedDaemonInfo {
  uri: `http://127.0.0.1:${number}`;
  bind: `127.0.0.1:${number}`;
  pid: number;
  storePath: string;
}

interface StateFile {
  version: 1;
  pid: number;
  port: number;
  storePath: string;
  startedAt: string;
}

export function resolveRepoRedStorePath(rootDir: string): string {
  return join(resolve(rootDir), REPO_REDB_STORE_PATH);
}

export function isRepoRedStorePath(path: string): boolean {
  return path.endsWith(`/${REPO_REDB_STORE_PATH}`) || path.endsWith(`\\${REPO_REDB_STORE_PATH.replaceAll("/", "\\")}`);
}

export async function ensureRepoRedDaemon(storePath: string): Promise<RepoRedDaemonInfo> {
  const absStorePath = resolve(storePath);
  const tmpDir = dirname(absStorePath);
  const statePath = join(tmpDir, "red-skills-daemon.json");
  const lockPath = join(tmpDir, "red-skills-daemon.lock");
  await mkdir(tmpDir, { recursive: true });

  const warm = await readHealthyState(statePath, absStorePath);
  if (warm) return warm;

  const release = await acquireLock(lockPath);
  try {
    const rechecked = await readHealthyState(statePath, absStorePath);
    if (rechecked) return rechecked;

    const port = await reservePort();
    const bind = `127.0.0.1:${port}` as const;
    const red = process.env.REDDB_BIN || "red";
    const child = spawn(red, ["server", "--http", "--http-bind", bind, "--path", absStorePath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    const pid = child.pid;
    if (!pid) throw new Error("red server did not expose a pid");
    await waitForHealth(bind, 5000);

    const state: StateFile = {
      version: 1,
      pid,
      port,
      storePath: absStorePath,
      startedAt: new Date().toISOString(),
    };
    await writeFile(statePath, `${JSON.stringify(state)}\n`, "utf8");
    return { uri: `http://127.0.0.1:${port}`, bind, pid, storePath: absStorePath };
  } finally {
    await release();
  }
}

async function readHealthyState(statePath: string, storePath: string): Promise<RepoRedDaemonInfo | null> {
  let state: StateFile;
  try {
    state = JSON.parse(await readFile(statePath, "utf8")) as StateFile;
  } catch {
    return null;
  }
  if (state.version !== 1 || state.storePath !== storePath || !Number.isInteger(state.pid) || !Number.isInteger(state.port)) {
    return null;
  }
  if (!pidAlive(state.pid)) return null;
  const bind = `127.0.0.1:${state.port}` as const;
  if (!(await redHealth(bind, 1000))) return null;
  return { uri: `http://127.0.0.1:${state.port}`, bind, pid: state.pid, storePath };
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() - started > 10_000) await rm(lockPath, { force: true });
      await sleep(50);
    }
  }
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(bind: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await redHealth(bind, 1000)) return;
    await sleep(50);
  }
  throw new Error(`red daemon did not become healthy on ${bind}`);
}

async function redHealth(bind: string, timeoutMs: number): Promise<boolean> {
  const red = process.env.REDDB_BIN || "red";
  return await new Promise((resolve) => {
    const child = spawn(red, ["health", "--http", "--bind", bind], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(false);
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
