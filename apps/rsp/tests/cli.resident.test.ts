import { describe, expect, it } from "vitest";
import {
  budgetSample,
  buildBundleOnce,
  bundle,
  chmod,
  cli,
  closeWithTimeout,
  commitMany,
  connect,
  copyFile,
  countTrackedResidentProcesses,
  createHash,
  createRequire,
  createServer,
  decode,
  dirname,
  enableRsp,
  expectLatencyBudget,
  expectWarmResident,
  extractHandle,
  fakeGhPath,
  idleBeat,
  initGitRepo,
  isPidAlive,
  isRecord,
  join,
  killResidentPid,
  latencyBudgetDetails,
  latencyRatio,
  localBaselineRatio,
  median,
  mkdir,
  mkdtemp,
  normalizedDeadlineMs,
  normalizedDurationMs,
  normalizedLatencyRatio,
  normalizedTimeoutMs,
  packageRoot,
  parseRecords,
  parseSpoolRows,
  parseStructured,
  pathExists,
  randomUUID,
  readdir,
  readFile,
  readPid,
  readResidentVersion,
  readSpoolEvents,
  readTelemetryRecords,
  REFERENCE_NODE_NOOP_MS,
  repoRoot,
  resolveResidentPaths,
  rm,
  RSP_ACCOUNTING_EVENTS_COLLECTION,
  RSP_DECISIONS_COLLECTION,
  RSP_TELEMETRY_DEGRADATIONS_COLLECTION,
  RSP_TELEMETRY_INVOCATIONS_COLLECTION,
  RspElisionStore,
  runBundleCodexHookFromCwd,
  runBundleFromCwd,
  runBundleFromCwdAsync,
  runBundleHookFromCwd,
  runGit,
  runMcpRequests,
  runNodeNoop,
  runRsp,
  runRspFromCwd,
  runShellFromCwd,
  seedWarmRedCache,
  sendResidentRequest,
  shellQuote,
  spawn,
  spawnSync,
  startHungOldResident,
  stat,
  stopResident,
  stopTrackedResidents,
  telemetrySpoolPath,
  tempRoot,
  TEST_NODE_NOOP_BASELINE_MS,
  TEST_RESIDENT_READY_TIMEOUT_MS,
  TEST_TELEMETRY_DRAIN_TIMEOUT_MS,
  testChildEnv,
  tsxLoader,
  timedStatus,
  tmpdir,
  trackedResidentPaths,
  uniqueResidentPaths,
  waitForActiveWait,
  waitForGone,
  waitForPidGone,
  waitForResidentReady,
  waitForResidentSocket,
  waitForSummaryTokens,
  waitForTelemetryInvocations,
  writeFile,
} from "./cli.helpers.js";

describe("rsp cli", () => {
  it("built bundle starts the resident for a repo root longer than the Unix socket path limit", async () => {
    buildBundleOnce();
    const base = await tempRoot();
    let root = base;
    let segment = 0;
    while (root.length <= 120) {
      root = join(root, `deep-segment-${segment++}`);
    }
    await mkdir(root, { recursive: true });
    const init = runGit(["-C", root, "init"]);
    expect(init.status).toBe(0);
    expect(runGit(["-C", root, "config", "user.email", "rsp-test@example.invalid"]).status).toBe(0);
    expect(runGit(["-C", root, "config", "user.name", "Rsp Test"]).status).toBe(0);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);

    const paths = trackedResidentPaths(root);
    expect(join(root, ".red", "tmp", "rsp.sock").length).toBeGreaterThan(108);
    expect(paths.socketPath.length).toBeLessThan(108);
    expect(paths.socketPath).not.toBe(join(root, ".red", "tmp", "rsp.sock"));

    const res = runBundleFromCwd(root, ["warm-resident"], {
      RED_SKILLS_CACHE_DIR: cacheDir,
    });

    expect(res.status, `${res.stdout.toString("utf8")}${res.stderr.toString("utf8")}`).toBe(0);
    expect(res.stdout).toEqual(Buffer.alloc(0));
    expect(res.stderr).toEqual(Buffer.alloc(0));
    await expect(stat(paths.socketPath)).resolves.toMatchObject({ size: expect.any(Number) });
    expect(((await stat(dirname(paths.socketPath))).mode & 0o777)).toBe(0o700);
    await expect(stat(join(root, ".red", "tmp", "rsp.sock"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(root, ".red", "state", "red-skills.rdb"))).resolves.toMatchObject({ size: expect.any(Number) });
  }, 120_000);

  it("built bundle uses the primary resident and store from linked worktrees", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await enableRsp(root);
    await writeFile(join(root, ".gitignore"), ".red/tmp/\n", "utf8");
    expect(runGit(["-C", root, "add", ".red/config.yaml", ".gitignore"]).status).toBe(0);
    expect(runGit(["-C", root, "commit", "-m", "baseline"]).status).toBe(0);
    await commitMany(root, 12);
    const cacheDir = await seedWarmRedCache();
    const env = {
      RED_SKILLS_CACHE_DIR: cacheDir,
      RSP_HEAVY_GIT_BYTE_THRESHOLD: "1",
      RSP_TELEMETRY_DRAIN_INTERVAL_MS: "50",
    };
    const setup = runBundleFromCwd(root, ["setup"], env);
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    await expectWarmResident(root, env);

    const worktreeA = join(root, ".red", "tmp", "linked-a");
    const worktreeB = join(root, ".red", "tmp", "linked-b");
    expect(runGit(["-C", root, "worktree", "add", worktreeA, "-b", `rsp-linked-a-${randomUUID()}`, "HEAD"]).status).toBe(0);
    expect(runGit(["-C", root, "worktree", "add", worktreeB, "-b", `rsp-linked-b-${randomUUID()}`, "HEAD"]).status).toBe(0);

    const primaryPaths = trackedResidentPaths(root);
    const worktreePaths = resolveResidentPaths(worktreeA);
    expect(worktreePaths.rootDir).toBe(primaryPaths.rootDir);
    expect(worktreePaths.socketPath).toBe(primaryPaths.socketPath);
    expect(worktreePaths.summaryPath).toBe(primaryPaths.summaryPath);

    const primaryWarm = runBundleFromCwd(root, ["git", "log", "--terse"], env);
    expect(primaryWarm.status, `${primaryWarm.stdout.toString("utf8")}${primaryWarm.stderr.toString("utf8")}`).toBe(0);
    extractHandle(primaryWarm.stdout);
    const beforeWorktree = await waitForSummaryTokens(root, 0);

    const fromWorktree = runBundleFromCwd(worktreeA, ["git", "log", "--terse"], env);
    expect(fromWorktree.status, `${fromWorktree.stdout.toString("utf8")}${fromWorktree.stderr.toString("utf8")}`).toBe(0);
    const handle = extractHandle(fromWorktree.stdout);
    await expect(stat(primaryPaths.socketPath)).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(join(root, ".red", "state", "red-skills.rdb"))).resolves.toMatchObject({ size: expect.any(Number) });
    await waitForSummaryTokens(root, beforeWorktree);

    const concurrent = await Promise.all([
      runBundleFromCwdAsync(root, ["git", "status"], env),
      runBundleFromCwdAsync(worktreeA, ["git", "status"], env),
      runBundleFromCwdAsync(worktreeB, ["git", "status"], env),
    ]);
    for (const res of concurrent) {
      expect(res.status, `${res.stdout.toString("utf8")}${res.stderr.toString("utf8")}`).toBe(0);
      expect(res.stderr).toEqual(Buffer.alloc(0));
    }

    expect(runGit(["-C", root, "worktree", "remove", "--force", worktreeA]).status).toBe(0);
    await rm(worktreeA, { recursive: true, force: true });
    const shown = runBundleFromCwd(root, ["show", handle], env);
    expect(shown.status, `${shown.stdout.toString("utf8")}${shown.stderr.toString("utf8")}`).toBe(0);
    expect(shown.stdout.toString("utf8")).toContain("commit ");

    const storeUri = `file://${join(root, ".red", "state", "red-skills.rdb")}`;
    await waitForTelemetryInvocations(storeUri, "git log", 2);
    const invocations = await waitForTelemetryInvocations(storeUri, "git status", 3);
    const stats = runBundleFromCwd(root, ["stats", "--since", "7d"], env);
    const statsText = stats.stdout.toString("utf8");
    const statsPayload = decode(statsText) as { savings: { top_commands: Array<{ command: string; invocations: number }> } };
    expect(stats.status, `${statsText}${stats.stderr.toString("utf8")}`).toBe(0);
    expect(statsPayload.savings.top_commands).toContainEqual(expect.objectContaining({ command: "git log", invocations: expect.any(Number) }));

    expect(invocations.filter((entry) => isRecord(entry) && entry.command === "git status").length)
      .toBeGreaterThanOrEqual(3);
  }, 120_000);

  it("built bundle keeps small git status wrapper work under 100ms", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await enableRsp(root);
    await writeFile(join(root, ".gitignore"), ".red/\n", "utf8");
    expect(runGit(["-C", root, "add", ".gitignore"]).status).toBe(0);
    expect(runGit(["-C", root, "commit", "-m", "baseline"]).status).toBe(0);
    const cacheDir = await seedWarmRedCache();
    const storeUri = `file://${join(await tempRoot(), "rsp-elisions.json")}`;
    const store = await RspElisionStore.open({ uri: storeUri });
    await store.close();
    const env = { RED_SKILLS_CACHE_DIR: cacheDir };

    expect(runBundleFromCwd(root, ["--store-uri", storeUri, "git", "status"], env).status).toBe(0);
    expect(runGit(["-C", root, "status"]).status).toBe(0);

    const measureWrapperWork = () => {
      const rawSamples: number[] = [];
      const nodeSamples: number[] = [];
      const wrappedSamples: number[] = [];
      for (let i = 0; i < 7; i++) {
        const raw = timedStatus(() => runGit(["-C", root, "status"]));
        const node = timedStatus(() => runNodeNoop());
        const wrapped = timedStatus(() => runBundleFromCwd(root, ["--store-uri", storeUri, "git", "status"], env));
        expect(raw.status).toBe(0);
        expect(node.status).toBe(0);
        expect(wrapped.status).toBe(0);
        expect(wrapped.stderr).toEqual(Buffer.alloc(0));
        rawSamples.push(raw.elapsedMs);
        nodeSamples.push(node.elapsedMs);
        wrappedSamples.push(wrapped.elapsedMs);
      }

      const rawMedian = median(rawSamples);
      const nodeMedian = median(nodeSamples);
      const wrappedMedian = median(wrappedSamples);
      return {
        rawMedian,
        nodeMedian,
        wrappedMedian,
        wrapperWorkMs: wrappedMedian - nodeMedian,
      };
    };

    const measured = measureWrapperWork();
    const measuredDetails =
      `raw=${measured.rawMedian.toFixed(1)}ms node=${measured.nodeMedian.toFixed(1)}ms ` +
      `wrapped=${measured.wrappedMedian.toFixed(1)}ms wrapperWork=${measured.wrapperWorkMs.toFixed(1)}ms`;
    await expectLatencyBudget(
      "small git status wrapper work",
      budgetSample(measured.wrapperWorkMs, measured.nodeMedian + measured.rawMedian, measuredDetails),
      normalizedLatencyRatio(8),
      () => {
        const retry = measureWrapperWork();
        return budgetSample(
          retry.wrapperWorkMs,
          retry.nodeMedian + retry.rawMedian,
          `raw=${retry.rawMedian.toFixed(1)}ms node=${retry.nodeMedian.toFixed(1)}ms ` +
            `wrapped=${retry.wrappedMedian.toFixed(1)}ms wrapperWork=${retry.wrapperWorkMs.toFixed(1)}ms`,
        );
      },
    );
  }, 120_000);

  it("built bundle resolves rsp server store from repo config and idles out", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);

    const res = runBundleFromCwd(root, ["server", "--idle-ms", "100"], { RED_SKILLS_CACHE_DIR: cacheDir });

    expect(res.status, `${res.stdout.toString("utf8")}${res.stderr.toString("utf8")}`).toBe(0);
    expect(res.stdout).toEqual(Buffer.alloc(0));
    expect(res.stderr).toEqual(Buffer.alloc(0));
    await expect(stat(trackedResidentPaths(root).socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 120_000);

  it("built bundle handles concurrent cold status locally and keeps the resident store usable", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 12);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const env = { RED_SKILLS_CACHE_DIR: cacheDir };

    const results = await Promise.all(Array.from({ length: 8 }, () => runBundleFromCwdAsync(root, ["git", "status"], env)));

    for (const res of results) {
      expect(res.status).toBe(0);
      expect(decode(res.stdout.toString("utf8"))).toMatchObject({
        category: "no-op",
        scope: "git status",
        empty: true,
      });
      expect(res.stderr).toEqual(Buffer.alloc(0));
    }
    const paths = trackedResidentPaths(root);
    await expect(stat(paths.socketPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(paths.lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expectWarmResident(root, env);
    const compressed = runBundleFromCwd(root, ["git", "log", "--terse"], env);
    expect(compressed.status).toBe(0);
    expect(compressed.stderr).toEqual(Buffer.alloc(0));
    expect(compressed.stdout.toString("utf8")).toMatch(/rsp show el:[a-f0-9]{12}/);
    await expect(stat(paths.socketPath)).resolves.toMatchObject({ size: expect.any(Number) });
  }, 120_000);

  it("built bundle recovers an orphaned resident socket before spawning", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 12);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const paths = trackedResidentPaths(root);
    await mkdir(dirname(paths.socketPath), { recursive: true });
    await writeFile(paths.socketPath, "orphaned resident socket\n", "utf8");
    await expectWarmResident(root, {
      RED_SKILLS_CACHE_DIR: cacheDir,
      RSP_FAIL_IF_STORE_OPEN: "1",
    });

    const compressed = runBundleFromCwd(root, ["git", "log", "--terse"], {
      RED_SKILLS_CACHE_DIR: cacheDir,
      RSP_FAIL_IF_STORE_OPEN: "1",
    });

    expect(compressed.status, `${compressed.stdout.toString("utf8")}${compressed.stderr.toString("utf8")}`).toBe(0);
    expect(compressed.stderr).toEqual(Buffer.alloc(0));
    expect(compressed.stdout.toString("utf8")).toMatch(/rsp show el:[a-f0-9]{12}/);
    await expect(stat(paths.socketPath)).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(paths.lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 120_000);

  it("built bundle hands over from an older live resident and keeps serving requests", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 12);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const oldVersion = "2.23.0";
    const oldResident = runBundleFromCwdAsync(
      root,
      ["server", "--idle-ms", "10000", "--resident-version", oldVersion],
      { RED_SKILLS_CACHE_DIR: cacheDir },
    );
    await waitForResidentSocket(root);
    expect(await readResidentVersion(root)).toBe(oldVersion);
    const oldRegistryRaw = await readFile(trackedResidentPaths(root).registryPath, "utf8");
    const oldRegistry = parseStructured(oldRegistryRaw) as {
      pid: number;
      resident_version: string;
    };
    expect(oldRegistry.resident_version).toBe(oldVersion);
    expect(oldRegistryRaw.trimStart().startsWith("{")).toBe(false);
    await expectWarmResident(root, { RED_SKILLS_CACHE_DIR: cacheDir });

    const compressed = runBundleFromCwd(root, ["git", "log", "--terse"], { RED_SKILLS_CACHE_DIR: cacheDir });

    expect(compressed.status, `${compressed.stdout.toString("utf8")}${compressed.stderr.toString("utf8")}`).toBe(0);
    expect(compressed.stderr).toEqual(Buffer.alloc(0));
    const handle = /rsp show (el:[a-f0-9]{12})/.exec(compressed.stdout.toString("utf8"))?.[1];
    expect(handle).toBeTruthy();
    const shown = runBundleFromCwd(root, ["show", handle!], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(shown.status, `${shown.stdout.toString("utf8")}${shown.stderr.toString("utf8")}`).toBe(0);
    expect(shown.stdout.length).toBeGreaterThan(compressed.stdout.length);
    expect(await readResidentVersion(root)).not.toBe(oldVersion);
    const nextRegistry = parseStructured(await readFile(trackedResidentPaths(root).registryPath, "utf8")) as {
      pid: number;
      resident_version: string;
    };
    expect(nextRegistry.pid).not.toBe(oldRegistry.pid);
    expect(nextRegistry.resident_version).not.toBe(oldVersion);
    expect(await oldResident).toMatchObject({ status: 0 });
  }, 120_000);

  it("built bundle removes a hung old resident socket after handover timeout", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 12);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const paths = trackedResidentPaths(root);
    const oldVersion = "2.23.0";
    const hung = await startHungOldResident(paths.socketPath, oldVersion);
    try {
      expect(await readResidentVersion(root)).toBe(oldVersion);
      await expectWarmResident(root, { RED_SKILLS_CACHE_DIR: cacheDir });

      const compressed = runBundleFromCwd(root, ["git", "log", "--terse"], { RED_SKILLS_CACHE_DIR: cacheDir });

      expect(compressed.status, `${compressed.stdout.toString("utf8")}${compressed.stderr.toString("utf8")}`).toBe(0);
      expect(compressed.stderr).toEqual(Buffer.alloc(0));
      expect(compressed.stdout.toString("utf8")).toMatch(/rsp show el:[a-f0-9]{12}/);
      expect(await readResidentVersion(root)).not.toBe(oldVersion);
      await expect(stat(paths.lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      hung.close();
    }
  }, 120_000);

  it("built bundle compresses git log warm and cold, with recovery only for warm handles", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 12);
    const cacheDir = await seedWarmRedCache();
    const raw = runGit(["-C", root, "log"]);
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    await expectWarmResident(root, { RED_SKILLS_CACHE_DIR: cacheDir });

    const compressed = runBundleFromCwd(root, ["git", "log", "--terse"], { RED_SKILLS_CACHE_DIR: cacheDir });

    expect(compressed.status).toBe(raw.status);
    expect(compressed.stderr).toEqual(Buffer.alloc(0));
    expect(compressed.stdout.length).toBeLessThan(raw.stdout.length);
    const text = compressed.stdout.toString("utf8");
    const handle = /rsp show (el:[a-f0-9]{12})/.exec(text)?.[1];
    expect(handle).toBeTruthy();

    const stats = runBundleFromCwd(root, [], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(stats.status).toBe(0);
    expect(decode(stats.stdout.toString("utf8"))).toMatchObject({
      savings: expect.objectContaining({ invocations: expect.any(Number) }),
    });

    const shown = runBundleFromCwd(root, ["show", handle!], { RED_SKILLS_CACHE_DIR: cacheDir });

    expect(shown.status).toBe(0);
    expect(shown.stdout.length).toBeGreaterThan(compressed.stdout.length);
    expect(shown.stderr).toEqual(Buffer.alloc(0));

    await expect(stat(join(root, ".red", "red.rdb"))).rejects.toMatchObject({ code: "ENOENT" });
    await rm(join(root, ".red", "state", "red-skills.rdb"));
    const cold = runBundleFromCwd(root, ["git", "log", "--terse"], { RED_SKILLS_CACHE_DIR: cacheDir });

    expect(cold.status).toBe(raw.status);
    expect(cold.stderr).toEqual(Buffer.alloc(0));
    expect(cold.stdout.length).toBeLessThan(raw.stdout.length);
    const coldText = cold.stdout.toString("utf8");
    expect(coldText).toContain("summary: 12 commits");
    expect(coldText).toContain("recovery unavailable (cold store) — re-run: git log");
    expect(coldText).not.toMatch(/rsp show el:[a-f0-9]{12}/);
    await expect(readSpoolEvents(root)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "git log" }),
    ]));
  }, 120_000);

  it("built bundle elides final stdout from rsp exec pipelines and recovers original bytes", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 80);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    await expectWarmResident(root, { RED_SKILLS_CACHE_DIR: cacheDir });
    const command = "git log | head -c 400000";
    const direct = runShellFromCwd(root, command);

    const compressed = runBundleFromCwd(root, ["exec", "--", command], { RED_SKILLS_CACHE_DIR: cacheDir });

    expect(compressed.status).toBe(direct.status);
    expect(compressed.stderr).toEqual(direct.stderr);
    expect(compressed.stdout.length).toBeLessThan(direct.stdout.length);
    const text = compressed.stdout.toString("utf8");
    expect(text).toContain("summary:");
    expect(text).toContain("rsp show el:");
    const handle = /rsp show (el:[a-f0-9]{12})/.exec(text)?.[1];
    expect(handle).toBeTruthy();

    const shown = runBundleFromCwd(root, ["show", handle!], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(shown.status).toBe(0);
    expect(shown.stdout).toEqual(direct.stdout);
    expect(shown.stderr).toEqual(Buffer.alloc(0));
    await expect(readSpoolEvents(root)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ command }),
    ]));
  }, 120_000);

  it("built bundle renders rsp cat code outlines and recovers original file bytes", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    await expectWarmResident(root, { RED_SKILLS_CACHE_DIR: cacheDir });
    const source = [
      "export function greet(name: string): string {",
      "  return `hello ${name}`;",
      "}",
      "",
      "class Greeter {",
      "  run(name: string): string {",
      "    return greet(name);",
      "  }",
      "}",
      "",
    ].join("\n");
    await writeFile(join(root, "sample.ts"), source, "utf8");

    const rendered = runBundleFromCwd(root, ["cat", "--terse", "sample.ts"], { RED_SKILLS_CACHE_DIR: cacheDir });

    expect(rendered.status, `${rendered.stdout.toString("utf8")}${rendered.stderr.toString("utf8")}`).toBe(0);
    expect(rendered.stderr).toEqual(Buffer.alloc(0));
    const text = rendered.stdout.toString("utf8");
    expect(text).toContain("kind: code");
    expect(text).toContain("greet");
    expect(text).toContain("Greeter");
    expect(text).toMatch(/rsp show el:[a-f0-9]{12}/);
    const handle = /rsp show (el:[a-f0-9]{12})/.exec(text)?.[1];
    expect(handle).toBeTruthy();

    const shown = runBundleFromCwd(root, ["show", handle!], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(shown.status).toBe(0);
    expect(shown.stdout.toString("utf8")).toBe(source);
    expect(shown.stderr).toEqual(Buffer.alloc(0));
  }, 120_000);

  it("built bundle preserves rsp exec redirects and structures failing command errors", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    await expectWarmResident(root, { RED_SKILLS_CACHE_DIR: cacheDir });

    const redirected = runBundleFromCwd(root, ["exec", "--", "printf 'redirected\\n' > out.txt"], {
      RED_SKILLS_CACHE_DIR: cacheDir,
    });

    expect(redirected.status).toBe(0);
    expect(redirected.stdout).toEqual(Buffer.alloc(0));
    expect(redirected.stderr).toEqual(Buffer.alloc(0));
    await expect(readFile(join(root, "out.txt"), "utf8")).resolves.toBe("redirected\n");

    const failingCommand = `${shellQuote(process.execPath)} -e "process.stderr.write('bad\\\\n'); process.exit(7)"`;
    const direct = runShellFromCwd(root, failingCommand);
    const failing = runBundleFromCwd(root, ["exec", "--", failingCommand], { RED_SKILLS_CACHE_DIR: cacheDir });
    const decoded = decode(failing.stdout.toString("utf8")) as { category: string; error: string; help: string[] };

    expect(failing.status).toBe(1);
    expect(direct.status).toBe(7);
    expect(failing.stderr).toEqual(direct.stderr);
    expect(decoded).toMatchObject({ category: "real-error", error: "bad", help: [`${failingCommand} --help`] });
  }, 120_000);

  it("built bundle records invocation and degradation telemetry through the resident", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 12);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const storeUri = `file://${join(root, ".red", "state", "red-skills.rdb")}`;
    const resident = runBundleFromCwdAsync(root, ["server", "--idle-ms", "1000"], { RED_SKILLS_CACHE_DIR: cacheDir });
    await waitForResidentSocket(root);
    await waitForResidentReady(root);

    const compressed = runBundleFromCwd(root, ["git", "log", "--terse"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(compressed.status).toBe(0);
    expect(compressed.stderr).toEqual(Buffer.alloc(0));
    expect(compressed.stdout.toString("utf8")).toMatch(/rsp show el:[a-f0-9]{12}/);
    const fastStatus = runBundleFromCwd(root, ["git", "status"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(fastStatus.status).toBe(0);
    expect(fastStatus.stderr).toEqual(Buffer.alloc(0));
    const residentResult = await resident;
    expect(residentResult.status, `${residentResult.stdout.toString("utf8")}${residentResult.stderr.toString("utf8")}`).toBe(0);

    const degradedResident = runBundleFromCwdAsync(root, ["server", "--idle-ms", "1000"], { RED_SKILLS_CACHE_DIR: cacheDir });
    await waitForResidentSocket(root);
    await waitForResidentReady(root);
    const degradedArgs: string[] = [];
    const degraded = runBundleFromCwd(root, ["git", ...degradedArgs], { RED_SKILLS_CACHE_DIR: cacheDir });
    const direct = runGit(degradedArgs);
    expect(degraded.status).toBe(direct.status);
    expect(degraded.stdout).toEqual(direct.stdout);
    expect(degraded.stderr.toString("utf8")).toBe(`rsp: wrapper failed, passing through\n${direct.stderr.toString("utf8")}`);
    const degradedResidentResult = await degradedResident;
    expect(
      degradedResidentResult.status,
      `${degradedResidentResult.stdout.toString("utf8")}${degradedResidentResult.stderr.toString("utf8")}`,
    ).toBe(0);

    const invocations = await readTelemetryRecords(storeUri, RSP_TELEMETRY_INVOCATIONS_COLLECTION);
    const invocation = invocations.find((record) => isRecord(record) && record.command === "git log");
    expect(invocation).toMatchObject({
      command: "git log",
      wrapper: "git",
      loss: "terse",
      elided: true,
      raw_bytes: expect.any(Number),
      emitted_bytes: compressed.stdout.length,
      wrapper_ms: expect.any(Number),
      store_open_count: expect.any(Number),
      store_elapsed_ms: expect.any(Number),
      tokens_raw: expect.any(Number),
      tokens_emitted: expect.any(Number),
      estimated: false,
    });
    expect(invocations).toContainEqual(expect.objectContaining({
      command: "git status",
      wrapper: "git",
      loss: "lossless",
      elided: false,
      emitted_bytes: fastStatus.stdout.length,
      wrapper_ms: expect.any(Number),
    }));

    const degradations = await readTelemetryRecords(storeUri, RSP_TELEMETRY_DEGRADATIONS_COLLECTION);
    expect(degradations).toContainEqual(expect.objectContaining({
      command: "git",
      reason: "wrapper-crash",
      wrapper_family: "git",
      wrapper_exit_code: 1,
      stderr_head: "unsupported git subcommand:",
    }));

    const stats = runBundleFromCwd(root, ["stats", "--since", "7d", "--full"], { RED_SKILLS_CACHE_DIR: cacheDir });
    const statsText = stats.stdout.toString("utf8");
    const statsPayload = decode(statsText) as {
      records: number;
      savings: {
        window_days: number;
        invocations: number;
        elided: number;
        raw_bytes: number;
        emitted_bytes: number;
        tokens_saved: number;
        tokens_saved_display: string;
        dollars_saved_estimate_usd_display: string;
        pricing_model_family: string;
        top_commands: Array<{ command: string }>;
      };
      health: {
        degradations: number;
        degradation_rate_display: string;
        most_recent_degradation_reason: string;
        by_reason: Array<{ reason: string; count: number }>;
        by_family: Array<{ family: string; count: number }>;
        recent_failures: Array<{ family: string; command: string; reason: string; exit_code: number; stderr_head: string }>;
      };
      latency: { wrapper_ms_p50: number; wrapper_ms_p95: number };
    };
    expect(stats.status, `${statsText}${stats.stderr.toString("utf8")}`).toBe(0);
    expect(statsPayload.records).toBe(3);
    expect(statsPayload.savings.window_days).toBe(7);
    expect(statsPayload.savings.invocations).toBeGreaterThan(0);
    expect(statsPayload.savings.elided).toBe(1);
    expect(statsPayload.savings.raw_bytes).toBeGreaterThan(0);
    expect(statsPayload.savings.emitted_bytes).toBeGreaterThan(0);
    expect(statsPayload.savings.tokens_saved_display).toMatch(/(?:[1-9]\d*|[1-9]\d*-[1-9]\d* .*)/);
    expect(statsPayload.savings.dollars_saved_estimate_usd_display).toContain("$");
    expect(statsPayload.savings.pricing_model_family).toBe("gpt-5");
    expect(statsPayload.savings.top_commands).toContainEqual(expect.objectContaining({ command: "git log" }));
    expect(statsPayload.health.degradations).toBe(1);
    expect(statsPayload.health.degradation_rate_display).toBe("0.3333");
    expect(statsPayload.health.most_recent_degradation_reason).toBe("wrapper-crash");
    expect(statsPayload.health.by_reason).toContainEqual({ reason: "wrapper-crash", count: 1 });
    expect(statsPayload.health.by_family).toContainEqual({ family: "git", count: 1 });
    expect(statsPayload.health.recent_failures).toContainEqual(expect.objectContaining({
      family: "git",
      command: "git",
      reason: "wrapper-crash",
      exit_code: 1,
      stderr_head: "unsupported git subcommand:",
    }));
    expect(statsPayload.latency.wrapper_ms_p50).toEqual(expect.any(Number));
    expect(statsPayload.latency.wrapper_ms_p95).toEqual(expect.any(Number));
  }, 120_000);

  it("built bundle renders rsp gains TOON from synthetic telemetry", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const storeUri = `file://${join(root, ".red", "state", "red-skills.rdb")}`;
    const db = await connect(storeUri);
    try {
      await db.kv(RSP_TELEMETRY_INVOCATIONS_COLLECTION).put("big", {
        created_at: "2026-07-05T12:00:00.000Z",
        command: "git log --terse",
        elided: true,
        raw_bytes: 8000,
        emitted_bytes: 800,
        tokens_raw: 2000,
        tokens_emitted: 200,
        estimated: true,
        wrapper_ms: 15,
        store_open_count: 1,
      });
      await db.kv(RSP_TELEMETRY_INVOCATIONS_COLLECTION).put("small", {
        created_at: "2026-07-06T13:30:00.000Z",
        command: "gh pr list --brief",
        elided: false,
        raw_bytes: 200,
        emitted_bytes: 200,
        tokens_raw: 50,
        tokens_emitted: 50,
        wrapper_ms: 40,
        store_open_count: 0,
      });
      await db.kv(RSP_TELEMETRY_DEGRADATIONS_COLLECTION).put("down", {
        created_at: "2026-07-06T14:00:00.000Z",
        command: "git --version",
        reason: "store not provisioned",
      });
    } finally {
      await db.close();
    }

    const res = runBundleFromCwd(root, ["gains", "--since", "28d"], { RED_SKILLS_CACHE_DIR: cacheDir });
    const text = res.stdout.toString("utf8");
    expect(res.status, `${text}${res.stderr.toString("utf8")}`).toBe(0);
    expect(text).toContain("schema_version: red.rsp.gains.v1");
    expect(text).toContain("latency:");
    expect(text).toContain("throughput:");
    expect(text).toContain("savings:");
    expect(text).toContain("health:");
    expect(text).toContain("top_commands_by_tokens_saved");
    expect(text).not.toContain("{\n");
    const decoded = decode(text) as {
      window: { requested_days: number; invocations: number; degradations: number };
      savings: {
        tokens: { tokens_saved_low: number; tokens_saved_high: number; dollars_saved_estimate_usd: number };
        single_biggest_elision: { command_family: string; tokens_saved: number };
      };
    };
    expect(decoded.window.requested_days).toBe(28);
    expect(decoded.window.invocations).toBe(2);
    expect(decoded.window.degradations).toBe(1);
    expect(decoded.savings.tokens).toMatchObject({ tokens_saved_low: 1350, tokens_saved_high: 2250, dollars_saved_estimate_usd: 0.00225 });
    expect(decoded.savings.single_biggest_elision).toMatchObject({ command_family: "git log", tokens_saved: 1800 });
  }, 120_000);

  it("built bundle drains raw-text telemetry without losing the trailing event", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await enableRsp(root);
    const cacheDir = await seedWarmRedCache();
    const env = { RED_SKILLS_CACHE_DIR: cacheDir };
    const setup = runBundleFromCwd(root, ["setup"], env);
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);

    const now = new Date().toISOString();
    await mkdir(dirname(telemetrySpoolPath(root)), { recursive: true });
    await writeFile(telemetrySpoolPath(root), [
      JSON.stringify({
        collection: RSP_TELEMETRY_INVOCATIONS_COLLECTION,
        id: "leading",
        created_at: now,
        command: "git status",
        elided: false,
        raw_bytes: 80,
        emitted_bytes: 80,
        wrapper_ms: 1,
      }),
      "{not-json",
      JSON.stringify({
        collection: RSP_TELEMETRY_INVOCATIONS_COLLECTION,
        id: "raw-text",
        created_at: now,
        command: "git log --terse",
        elided: true,
        raw_bytes: 1200,
        emitted_bytes: 120,
        raw_text: "alpha beta gamma delta epsilon zeta eta theta iota kappa",
        emitted_text: "alpha beta",
        wrapper_ms: 2,
      }),
      JSON.stringify({
        collection: RSP_TELEMETRY_INVOCATIONS_COLLECTION,
        id: "trailing",
        created_at: now,
        command: "gh pr list",
        elided: false,
        raw_bytes: 200,
        emitted_bytes: 200,
        wrapper_ms: 3,
      }),
      "",
    ].join("\n"), "utf8");

    const child = spawn(process.execPath, [
      bundle,
      "server",
      "--idle-ms",
      "250",
      "--telemetry-drain-interval-ms",
      "50",
    ], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const status = await closeWithTimeout(child, normalizedDurationMs(5_000));
    expect(status, `${Buffer.concat(stdout).toString("utf8")}${Buffer.concat(stderr).toString("utf8")}`).toBe(0);
    await expect(readFile(telemetrySpoolPath(root), "utf8")).resolves.toBe("");

    const storeUri = `file://${join(root, ".red", "state", "red-skills.rdb")}`;
    const invocations = await readTelemetryRecords(storeUri, RSP_TELEMETRY_INVOCATIONS_COLLECTION);
    expect(invocations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "leading", command: "git status" }),
      expect.objectContaining({
        id: "raw-text",
        command: "git log --terse",
        tokens_raw: expect.any(Number),
        tokens_emitted: expect.any(Number),
      }),
      expect.objectContaining({ id: "trailing", command: "gh pr list" }),
    ]));
    const degradations = await readTelemetryRecords(storeUri, RSP_TELEMETRY_DEGRADATIONS_COLLECTION);
    expect(degradations).toContainEqual(expect.objectContaining({ reason: "telemetry parse failed" }));

    const stats = runBundleFromCwd(root, ["stats", "--since", "7d", "--full"], env);
    const statsText = stats.stdout.toString("utf8");
    const statsPayload = decode(statsText) as {
      savings: {
        invocations: number;
        tokens_saved: number;
        top_commands: Array<{ command: string; invocations: number }>;
      };
      health: { degradations: number };
    };
    expect(stats.status, `${statsText}${stats.stderr.toString("utf8")}`).toBe(0);
    expect(statsPayload.savings.invocations).toBe(3);
    expect(statsPayload.savings.tokens_saved).toBeGreaterThan(0);
    expect(statsPayload.savings.top_commands).toContainEqual(expect.objectContaining({ command: "git log --terse", invocations: 1 }));
    expect(statsPayload.savings.top_commands).toContainEqual(expect.objectContaining({ command: "gh pr list", invocations: 1 }));
    expect(statsPayload.health.degradations).toBe(1);
    const summaryRaw = await readFile(resolveResidentPaths(root).summaryPath, "utf8");
    const summary = parseStructured(summaryRaw) as {
      version: number;
      tokens_saved_today: number;
      updated_at: string;
    };
    expect(summaryRaw.trimStart().startsWith("{")).toBe(false);
    expect(summary.version).toBe(1);
    expect(summary.tokens_saved_today).toBeGreaterThan(0);
    expect(Date.parse(summary.updated_at)).not.toBeNaN();

    const gains = runBundleFromCwd(root, ["gains", "--since", "7d"], env);
    const gainsText = gains.stdout.toString("utf8");
    expect(gains.status, `${gainsText}${gains.stderr.toString("utf8")}`).toBe(0);
    const decoded = decode(gainsText) as {
      window: { invocations: number; degradations: number };
      savings: { single_biggest_elision: { command_family: string; tokens_saved: number } | null };
    };
    expect(decoded.window).toMatchObject({ invocations: 3, degradations: 1 });
    expect(decoded.savings.single_biggest_elision).toMatchObject({
      command_family: "git log",
      tokens_saved: expect.any(Number),
    });
  }, 120_000);

  it("built bundle keeps git log terse elision latency under budget", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 12);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const env = { RED_SKILLS_CACHE_DIR: cacheDir };
    await expectWarmResident(root, env);

    expect(runBundleFromCwd(root, ["git", "log", "--terse"], env).status).toBe(0);
    expect(runGit(["-C", root, "log"]).status).toBe(0);

    const rawSamples: number[] = [];
    const nodeSamples: number[] = [];
    const wrappedSamples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const raw = timedStatus(() => runGit(["-C", root, "log"]));
      const node = timedStatus(() => runNodeNoop());
      const wrapped = timedStatus(() => runBundleFromCwd(root, ["git", "log", "--terse"], env));
      expect(raw.status).toBe(0);
      expect(node.status).toBe(0);
      expect(wrapped.status).toBe(0);
      expect(wrapped.stderr).toEqual(Buffer.alloc(0));
      expect(wrapped.stdout.toString("utf8")).toMatch(/rsp show el:[a-f0-9]{12}/);
      rawSamples.push(raw.elapsedMs);
      nodeSamples.push(node.elapsedMs);
      wrappedSamples.push(wrapped.elapsedMs);
    }

    const rawMedian = median(rawSamples);
    const nodeMedian = median(nodeSamples);
    const wrappedMedian = median(wrappedSamples);
    const overheadMs = wrappedMedian - rawMedian;
    await expectLatencyBudget(
      "git log terse elision overhead",
      budgetSample(
        overheadMs,
        rawMedian + nodeMedian,
        `raw=${rawMedian.toFixed(1)}ms node=${nodeMedian.toFixed(1)}ms ` +
          `wrapped=${wrappedMedian.toFixed(1)}ms overhead=${overheadMs.toFixed(1)}ms`,
      ),
      normalizedLatencyRatio(12),
      () => {
        const retryRawSamples: number[] = [];
        const retryNodeSamples: number[] = [];
        const retryWrappedSamples: number[] = [];
        for (let i = 0; i < 5; i++) {
          const raw = timedStatus(() => runGit(["-C", root, "log"]));
          const node = timedStatus(() => runNodeNoop());
          const wrapped = timedStatus(() => runBundleFromCwd(root, ["git", "log", "--terse"], env));
          expect(raw.status).toBe(0);
          expect(node.status).toBe(0);
          expect(wrapped.status).toBe(0);
          expect(wrapped.stderr).toEqual(Buffer.alloc(0));
          expect(wrapped.stdout.toString("utf8")).toMatch(/rsp show el:[a-f0-9]{12}/);
          retryRawSamples.push(raw.elapsedMs);
          retryNodeSamples.push(node.elapsedMs);
          retryWrappedSamples.push(wrapped.elapsedMs);
        }

        const retryRawMedian = median(retryRawSamples);
        const retryNodeMedian = median(retryNodeSamples);
        const retryWrappedMedian = median(retryWrappedSamples);
        const retryOverheadMs = retryWrappedMedian - retryRawMedian;
        return budgetSample(
          retryOverheadMs,
          retryRawMedian + retryNodeMedian,
          `raw=${retryRawMedian.toFixed(1)}ms node=${retryNodeMedian.toFixed(1)}ms ` +
            `wrapped=${retryWrappedMedian.toFixed(1)}ms overhead=${retryOverheadMs.toFixed(1)}ms`,
        );
      },
    );
  }, 120_000);

  it("prints a degraded dashboard instead of creating the default Repo store when setup has not provisioned it", async () => {
    const root = await tempRoot();
    await enableRsp(root);

    const res = runRspFromCwd(root, [], {});
    const decoded = decode(res.stdout.toString("utf8")) as {
      executable: { name: string };
      recovery: { pending: number };
      waits: { active: number };
      store: { records: number; bytes: number };
      savings: { empty: boolean };
      next_steps: string[];
    };

    expect(res.status).toBe(0);
    expect(decoded).toMatchObject({
      executable: { name: "rsp" },
      recovery: { pending: 0 },
      waits: { active: 0 },
      store: { records: 0, bytes: 0 },
      savings: { empty: true },
    });
    expect(decoded.next_steps).toContain("rsp <wrapped-command> --terse");
    await expect(stat(join(root, ".red", "red.rdb"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(root, ".red", "state", "red-skills.rdb"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("passes through a successful wrapper when the repo store is absent and the cold summarizer cannot handle it", async () => {
    const root = await initGitRepo();
    await enableRsp(root);
    await writeFile(join(root, "untracked.txt"), "raw stdout\n", "utf8");
    const direct = runGit(["-C", root, "status", "--short"]);

    const res = runRspFromCwd(root, ["git", "-C", root, "status", "--short"], {});

    expect(res.status).toBe(direct.status);
    expect(res.stdout).toEqual(direct.stdout);
    expect(res.stderr.toString("utf8")).toBe(`rsp: wrapper failed, passing through\n${direct.stderr.toString("utf8")}`);
    await expect(stat(join(root, ".red", "red.rdb"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(root, ".red", "state", "red-skills.rdb"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("passes through a failing wrapper with the underlying exit code and raw stderr when the store is absent", async () => {
    const root = await initGitRepo();
    await enableRsp(root);
    const args = ["-C", root, "definitely-not-a-git-subcommand"];
    const direct = runGit(args);

    const res = runRspFromCwd(root, ["git", ...args], {});

    expect(res.status).toBe(direct.status);
    expect(res.stdout).toEqual(direct.stdout);
    expect(res.stderr.toString("utf8")).toBe(`rsp: wrapper failed, passing through\n${direct.stderr.toString("utf8")}`);
  });

  it("passes through wrappers when the configured store is unreadable non-RedDB data", async () => {
    const root = await initGitRepo();
    await enableRsp(root);
    const storeRoot = await tempRoot();
    const storePath = join(storeRoot, "rsp-elisions.json");
    await writeFile(storePath, "not a reddb store", "utf8");
    await writeFile(join(root, "raw.txt"), "raw\n", "utf8");
    const direct = runGit(["-C", root, "status", "--short"]);

    const res = runRspFromCwd(root, ["git", "-C", root, "status", "--short"], { RSP_STORE_URI: `file://${storePath}` });

    expect(res.status).toBe(direct.status);
    expect(res.stdout).toEqual(direct.stdout);
    expect(res.stderr.toString("utf8")).toBe(`rsp: wrapper failed, passing through\n${direct.stderr.toString("utf8")}`);
  });

  it("built bundle never writes .red/red.rdb and preserves a RedDB-format file there", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 12);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const redBytes = Buffer.concat([Buffer.from("RDBSBLK1", "ascii"), Buffer.from([0, 1, 2, 3])]);
    await writeFile(join(root, ".red", "red.rdb"), redBytes);
    await expectWarmResident(root, { RED_SKILLS_CACHE_DIR: cacheDir });

    const compressed = runBundleFromCwd(root, ["git", "log", "--terse"], { RED_SKILLS_CACHE_DIR: cacheDir });

    expect(compressed.status).toBe(0);
    expect(compressed.stderr).toEqual(Buffer.alloc(0));
    expect(compressed.stdout.toString("utf8")).toMatch(/rsp show el:[a-f0-9]{12}/);
    await expect(readFile(join(root, ".red", "red.rdb"))).resolves.toEqual(redBytes);
    await expect(stat(join(root, ".red", "state", "red-skills.rdb"))).resolves.toMatchObject({ size: expect.any(Number) });
  }, 120_000);

});
