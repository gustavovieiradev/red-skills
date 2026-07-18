import { describe, expect, it } from "vitest";
import {
  LatencyBudgetSample,
  REFERENCE_NODE_NOOP_MS,
  RSP_ACCOUNTING_EVENTS_COLLECTION,
  RSP_DECISIONS_COLLECTION,
  RSP_TELEMETRY_DEGRADATIONS_COLLECTION,
  RSP_TELEMETRY_INVOCATIONS_COLLECTION,
  RspElisionStore,
  TEST_NODE_NOOP_BASELINE_MS,
  TEST_RESIDENT_READY_TIMEOUT_MS,
  TEST_TELEMETRY_DRAIN_TIMEOUT_MS,
  budgetSample,
  buildBundleOnce,
  bundle,
  bundleBuilt,
  chmod,
  cli,
  closeWithTimeout,
  commitMany,
  connect,
  copyFile,
  countTrackedResidentProcesses,
  createHash,
  createServer,
  decode,
  dirname,
  enableRsp,
  expectLatencyBudget,
  expectWarmResident,
  extractHandle,
  fakeGhPath,
  handleHungOldResidentSocket,
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
  readFile,
  readPid,
  readResidentVersion,
  readSpoolEvents,
  readTelemetryRecords,
  readdir,
  repoRoot,
  require,
  residentDirs,
  residentPathsBySocket,
  resolveResidentPaths,
  rm,
  roots,
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
  testChildEnv,
  timedStatus,
  tmpdir,
  trackedResidentPaths,
  tsxLoader,
  uniqueResidentPaths,
  waitForActiveWait,
  waitForGone,
  waitForPidGone,
  waitForResidentReady,
  waitForResidentSocket,
  waitForSummaryTokens,
  waitForTelemetryInvocations,
  writeFile
} from "./cli-test-helpers.js";

describe("rsp cli", () => {
  it("keeps the cli entrypoint as a small stable barrel", async () => {
    const source = await readFile(cli, "utf8");
    const lineCount = source.split(/\r?\n/).length;
    const exports = await import("../src/cli.js");

    expect(lineCount).toBeLessThanOrEqual(1200);
    expect(Object.keys(exports).sort()).toEqual(["main", "renderSetupResult", "renderStats"]);
  });
  it("prints unknown rsp flags as structured usage errors", async () => {
    const root = await tempRoot();

    const res = runRsp(root, ["--bogus"], {});
    const decoded = decode(res.stdout.toString("utf8")) as { category: string; exit_code: number; valid_flags: string[] };

    expect(res.status).toBe(2);
    expect(res.stderr).toEqual(Buffer.alloc(0));
    expect(decoded.category).toBe("usage");
    expect(decoded.exit_code).toBe(2);
    expect(decoded.valid_flags).toContain("--brief");
  });
  it.each([
    ["compound-stdout-stderr", "printf 'out\\n'; printf 'err\\n' >&2"],
    ["pipeline", "printf 'one\\ntwo\\n' | sed -n '2p'"],
    ["redirect", "printf 'saved\\n' > redirected.txt; cat redirected.txt"],
    ["failing-exit", "printf 'bad\\n' >&2; exit 7"],
    ["signal", "kill -TERM $$"],
  ])("proxies %s with byte-identical shell behavior", async (_label, command) => {
    const rawRoot = await tempRoot();
    const proxyRoot = await tempRoot();
    await enableRsp(proxyRoot);

    const raw = runShellFromCwd(rawRoot, command);
    const proxied = runRsp(proxyRoot, ["proxy", "--", command], {});

    expect(proxied.stdout).toEqual(raw.stdout);
    expect(proxied.stderr).toEqual(raw.stderr);
    expect(proxied.status).toBe(raw.status);
    expect(proxied.signal).toBe(raw.signal);
  });
  it("fails open to raw execution on proxy-internal error and records the decision", async () => {
    const root = await tempRoot();
    await enableRsp(root);

    const res = runRsp(root, ["proxy", "--", "printf 'ok\\n'"], { RSP_PROXY_FAIL_INTERNAL: "1" });

    expect(res.status).toBe(0);
    expect(res.stdout.toString("utf8")).toBe("ok\n");
    expect(res.stderr).toEqual(Buffer.alloc(0));
    await expect(readSpoolEvents(root)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: RSP_DECISIONS_COLLECTION,
        decision: "failed-open",
        reason: "proxy-internal-error",
      }),
    ]));
  });
  it("normalizes latency budgets to the sampled baseline and still catches regressions", async () => {
    expect(localBaselineRatio(100)).toBe(4);
    expect(normalizedDurationMs(1_000, 100)).toBe(4_000);
    expect(normalizedTimeoutMs(100, 2, 1_000)).toBe(4_000);

    let attempts = 0;
    await expectLatencyBudget("test budget", budgetSample(200, 50, "first=200.0ms"), 3, async () => {
      attempts++;
      return budgetSample(130, 50, "retry=130.0ms");
    });

    expect(attempts).toBe(1);
    await expect(expectLatencyBudget("test budget", budgetSample(250, 50, "first=250.0ms"), 3, async () => {
      return budgetSample(220, 50, "retry=220.0ms");
    })).rejects.toThrow(/exceeded 3\.00x baseline twice/);
  });
  it("passes wrappers through without creating .red when rsp is not enabled", async () => {
    const root = await initGitRepo();
    await writeFile(join(root, "untracked.txt"), "raw stdout\n", "utf8");
    const direct = runGit(["-C", root, "status", "--short"]);

    const res = runRspFromCwd(root, ["git", "status", "--short"], {});

    expect(res.status).toBe(direct.status);
    expect(res.stdout).toEqual(direct.stdout);
    expect(res.stderr).toEqual(direct.stderr);
    await expect(stat(join(root, ".red"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("restores the disabled passthrough notice under RSP_DEBUG", async () => {
    const root = await initGitRepo();
    await writeFile(join(root, "untracked.txt"), "raw stdout\n", "utf8");
    const direct = runGit(["-C", root, "status", "--short"]);

    const res = runRspFromCwd(root, ["git", "status", "--short"], { RSP_DEBUG: "1" });

    expect(res.status).toBe(direct.status);
    expect(res.stdout).toEqual(direct.stdout);
    expect(res.stderr.toString("utf8")).toBe(`rsp: rsp is not enabled in this directory; run /red-setup, passing through\n${direct.stderr.toString("utf8")}`);
    await expect(stat(join(root, ".red"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("doctor reports rsp disabled as a definitive finding, not an error", async () => {
    const root = await initGitRepo();

    const res = runRspFromCwd(root, ["doctor"], {});
    const decoded = decode(res.stdout.toString("utf8")) as {
      status: string;
      exit_code: number;
      probes: Array<{ name: string; pass: boolean; finding: string }>;
      errors: unknown[];
    };

    expect(res.status).toBe(0);
    expect(res.stderr).toEqual(Buffer.alloc(0));
    expect(decoded.status).toBe("disabled");
    expect(decoded.exit_code).toBe(0);
    expect(decoded.errors).toEqual([]);
    expect(decoded.probes.map((probe) => probe.name)).toEqual([
      "config_gate_resolution",
      "hook_wiring",
      "proxy_mode",
      "resident_liveness",
      "store_provisioning",
      "recent_degradation_rate",
    ]);
    expect(decoded.probes.find((probe) => probe.name === "config_gate_resolution")).toMatchObject({
      pass: true,
      finding: "rsp disabled in this directory; run /red-setup to opt in",
    });
    await expect(stat(join(root, ".red"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("doctor reports named red plumbing probes with shared structured fix commands", async () => {
    const root = await initGitRepo();
    await enableRsp(root);

    const res = runRspFromCwd(root, ["doctor"], {});
    const decoded = decode(res.stdout.toString("utf8")) as {
      status: string;
      exit_code: number;
      probes: Array<{
        name: string;
        pass: boolean;
        finding: string;
        fix_command?: string;
        error?: { command: string; category: string; exit_code: number; error: string; help: string[] };
      }>;
      errors: Array<{ command: string; category: string; exit_code: number; error: string; help: string[] }>;
    };

    expect(res.status).toBe(1);
    expect(res.stderr).toEqual(Buffer.alloc(0));
    expect(decoded.status).toBe("fail");
    expect(decoded.exit_code).toBe(1);
    expect(decoded.probes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "config_gate_resolution", pass: true, finding: "rsp.enabled resolved true for this directory" }),
      expect.objectContaining({ name: "hook_wiring", pass: true }),
      expect.objectContaining({ name: "proxy_mode", pass: true }),
      expect.objectContaining({ name: "resident_liveness", pass: false, fix_command: "rsp warm-resident" }),
      expect.objectContaining({ name: "store_provisioning", pass: false, fix_command: "rsp setup" }),
      expect.objectContaining({ name: "recent_degradation_rate", pass: true }),
    ]));
    for (const probe of decoded.probes.filter((entry) => !entry.pass)) {
      expect(probe.error).toMatchObject({
        command: `rsp doctor:${probe.name}`,
        category: "real-error",
        exit_code: 1,
        error: probe.finding,
        help: [probe.fix_command],
      });
    }
    expect(decoded.errors).toEqual(decoded.probes.filter((entry) => !entry.pass).map((entry) => entry.error));
  });
  it("doctor turns recent degradation spikes red with count and dominant reason", async () => {
    const root = await initGitRepo();
    await enableRsp(root);
    const storeUri = `file://${join(root, ".red", "state", "red-skills.rdb")}`;
    const store = await RspElisionStore.open({ uri: storeUri, allowResidentOpen: true });
    await store.close();
    const db = await connect(storeUri);
    try {
      await db.kv(RSP_ACCOUNTING_EVENTS_COLLECTION).put("ok", {
        created_at: new Date().toISOString(),
        event_type: "invocation",
        command: "git status",
        raw_bytes: 20,
        emitted_bytes: 20,
      });
      await db.kv(RSP_ACCOUNTING_EVENTS_COLLECTION).put("degraded-one", {
        created_at: new Date().toISOString(),
        event_type: "invocation",
        command: "git log",
        degradation_reason: "wrapper-crash",
        wrapper_family: "git",
        wrapper_exit_code: 1,
        stderr_head: "boom",
      });
      await db.kv(RSP_ACCOUNTING_EVENTS_COLLECTION).put("degraded-two", {
        created_at: new Date().toISOString(),
        event_type: "invocation",
        command: "git diff",
        degradation_reason: "wrapper-crash",
        wrapper_family: "git",
        wrapper_exit_code: 1,
        stderr_head: "boom",
      });
    } finally {
      await db.close();
    }

    const res = runRspFromCwd(root, ["doctor", "--since", "1d"], {});
    const decoded = decode(res.stdout.toString("utf8")) as {
      status: string;
      probes: Array<{
        name: string;
        pass: boolean;
        finding: string;
        fix_command?: string;
        error?: { category: string; help: string[] };
      }>;
    };
    const degradation = decoded.probes.find((probe) => probe.name === "recent_degradation_rate");

    expect(res.status).toBe(1);
    expect(decoded.status).toBe("fail");
    expect(degradation).toMatchObject({
      pass: false,
      finding: "2 degradation(s) in the recent 1d window; dominant reason wrapper-crash (2)",
      fix_command: "rsp stats --since 1d --full",
      error: { category: "real-error", help: ["rsp stats --since 1d --full"] },
    });
  });
  it("built bundle keeps disabled passthrough silent, debuggable, and distinct from enabled degradation", async () => {
    buildBundleOnce();
    const disabledRoot = await initGitRepo();
    await writeFile(join(disabledRoot, "untracked.txt"), "raw stdout\n", "utf8");
    const disabledDirect = runGit(["-C", disabledRoot, "status"]);

    const disabled = runBundleFromCwd(disabledRoot, ["git", "status"], { RSP_DEBUG: "0" });

    expect(disabled.status).toBe(disabledDirect.status);
    expect(disabled.stdout).toEqual(disabledDirect.stdout);
    expect(disabled.stderr).toEqual(disabledDirect.stderr);
    await expect(stat(join(disabledRoot, ".red"))).rejects.toMatchObject({ code: "ENOENT" });

    const debug = runBundleFromCwd(disabledRoot, ["git", "status"], { RSP_DEBUG: "1" });

    expect(debug.status).toBe(disabledDirect.status);
    expect(debug.stdout).toEqual(disabledDirect.stdout);
    expect(debug.stderr.toString("utf8")).toBe(`rsp: rsp is not enabled in this directory; run /red-setup, passing through\n${disabledDirect.stderr.toString("utf8")}`);

    const degradedRoot = await initGitRepo();
    await enableRsp(degradedRoot);
    await writeFile(join(degradedRoot, "untracked.txt"), "raw stdout\n", "utf8");
    const degradedDirect = runGit(["-C", degradedRoot, "status", "--short"]);

    const degraded = runBundleFromCwd(degradedRoot, ["git", "-C", degradedRoot, "status", "--short"], {
      RSP_DEBUG: "0",
    });

    expect(degraded.status).toBe(degradedDirect.status);
    expect(degraded.stdout).toEqual(degradedDirect.stdout);
    expect(degraded.stderr.toString("utf8")).toBe(`rsp: wrapper failed, passing through\n${degradedDirect.stderr.toString("utf8")}`);
  }, 120_000);
  it("server exits inert without creating a socket when rsp is not enabled", async () => {
    const root = await tempRoot();

    const res = runRspFromCwd(root, ["server", "--idle-ms", "10"], {});

    expect(res.status).toBe(0);
    expect(res.stdout.toString("utf8")).toBe("rsp is not enabled in this directory; run /red-setup\n");
    expect(res.stderr).toEqual(Buffer.alloc(0));
    await expect(stat(join(root, ".red"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("mcp boots inert with no config and answers status without side effects", async () => {
    const root = await tempRoot();

    const responses = await runMcpRequests(root, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "rsp_status", arguments: {} } },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "rsp_compress", arguments: { payload: Array.from({ length: 30 }, (_, i) => ({ id: i })) } },
      },
    ]);

    const list = responses.find((response) => response.id === 2) as { result: { tools: Array<{ name: string }> } };
    const status = responses.find((response) => response.id === 3) as { result: { content: Array<{ text: string }> } };
    const compress = responses.find((response) => response.id === 4) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(list.result.tools.map((tool) => tool.name)).toEqual(["rsp_status"]);
    expect(decode(status.result.content[0]!.text)).toMatchObject({
      tool: "rsp_status",
      enabled: false,
      status: "disabled",
      help: ["/red-setup"],
    });
    expect(compress.result.isError).toBe(true);
    expect(decode(compress.result.content[0]!.text)).toMatchObject({
      tool: "rsp_status",
      enabled: false,
      status: "disabled",
    });
    await expect(stat(join(root, ".red"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("mcp stays inert when config lacks an rsp block or disables rsp", async () => {
    const noRsp = await tempRoot();
    await mkdir(join(noRsp, ".red"), { recursive: true });
    await writeFile(join(noRsp, ".red", "config.yaml"), "plugins:\n  dev:\n    enabled: true\n", "utf8");
    const disabled = await tempRoot();
    await mkdir(join(disabled, ".red"), { recursive: true });
    await writeFile(join(disabled, ".red", "config.yaml"), "rsp:\n  enabled: false\n", "utf8");

    for (const root of [noRsp, disabled]) {
      const responses = await runMcpRequests(root, [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);
      const list = responses.find((response) => response.id === 2) as { result: { tools: Array<{ name: string }> } };
      expect(list.result.tools.map((tool) => tool.name)).toEqual(["rsp_status"]);
      await expect(stat(join(root, ".red", "tmp", "rsp.sock"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(root, ".red", "state", "red-skills.rdb"))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  it("mcp exposes resident tools and returns TOON tool responses when rsp is enabled", async () => {
    const root = await tempRoot();
    await enableRsp(root);

    const responses = await runMcpRequests(root, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "rsp_status", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rsp_stats", arguments: {} } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "rsp_show", arguments: { handle: "el:missing" } } },
    ]);

    const list = responses.find((response) => response.id === 2) as { result: { tools: Array<{ name: string }> } };
    expect(list.result.tools.map((tool) => tool.name)).toEqual(["rsp_status", "rsp_stats", "rsp_show", "rsp_compress"]);
    const status = responses.find((response) => response.id === 3) as { result: { content: Array<{ text: string }> } };
    expect(decode(status.result.content[0]!.text)).toMatchObject({ tool: "rsp_status", enabled: true, status: "enabled" });
    const stats = responses.find((response) => response.id === 4) as { result: { content: Array<{ text: string }> } };
    expect(decode(stats.result.content[0]!.text)).toMatchObject({ tool: "rsp_stats", records: 0, bytes: 0 });
    const missing = responses.find((response) => response.id === 5) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(missing.result.isError).toBe(true);
    expect(decode(missing.result.content[0]!.text)).toMatchObject({
      tool: "rsp_show",
      handle: "el:missing",
      found: false,
      error: "not found",
    });
  });
  it("mcp compresses large JSON and rsp_show round-trips the elided original", async () => {
    const root = await tempRoot();
    await enableRsp(root);
    const payload = Array.from({ length: 60 }, (_, i) => ({
      id: i,
      status: i === 27 ? 500 : 200,
      latency: i === 33 ? 4_500 : i,
      label: `row-${i}`,
    }));
    const original = JSON.stringify(payload);

    const compressedResponses = await runMcpRequests(root, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "rsp_compress", arguments: { payload: original, level: "terse" } },
      },
    ]);

    const compressed = compressedResponses.find((response) => response.id === 2) as {
      result: { content: Array<{ text: string }> };
    };
    const text = compressed.result.content[0]!.text;
    expect(text).toContain("items:");
    expect(text).toContain("items[");
    expect(text).toContain("{id,status,latency,label}");
    const handle = /rsp show (el:[a-f0-9]{12})/.exec(text)?.[1];
    expect(handle).toBeTruthy();

    const shownResponses = await runMcpRequests(root, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "rsp_show", arguments: { handle } },
      },
    ]);

    const shown = shownResponses.find((response) => response.id === 2) as {
      result: { content: Array<{ text: string }> };
    };
    expect(decode(shown.result.content[0]!.text)).toMatchObject({
      tool: "rsp_show",
      found: true,
      text: original,
    });
  });
  it("built bundle mcp compress honors disabled gates and round-trips large JSON", async () => {
    const disabledRoot = await tempRoot();
    const disabledResponses = await runMcpRequests(disabledRoot, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "rsp_compress", arguments: { payload: [{ id: 1 }], level: "brief" } },
      },
    ], "bundle");
    const disabled = disabledResponses.find((response) => response.id === 2) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(disabled.result.isError).toBe(true);
    expect(decode(disabled.result.content[0]!.text)).toMatchObject({
      tool: "rsp_status",
      enabled: false,
      status: "disabled",
    });
    await expect(stat(join(disabledRoot, ".red"))).rejects.toMatchObject({ code: "ENOENT" });

    const root = await tempRoot();
    await enableRsp(root);
    const payload = Array.from({ length: 60 }, (_, i) => ({ id: i, value: i, error: i === 41 ? "boom" : "" }));
    const original = JSON.stringify(payload);
    const compressedResponses = await runMcpRequests(root, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "rsp_compress", arguments: { payload: original, level: "terse" } },
      },
    ], "bundle");
    const compressed = compressedResponses.find((response) => response.id === 2) as {
      result: { content: Array<{ text: string }> };
    };
    const handle = /rsp show (el:[a-f0-9]{12})/.exec(compressed.result.content[0]!.text)?.[1];
    expect(handle).toBeTruthy();

    const shownResponses = await runMcpRequests(root, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "rsp_show", arguments: { handle } },
      },
    ], "bundle");
    const shown = shownResponses.find((response) => response.id === 2) as {
      result: { content: Array<{ text: string }> };
    };
    expect(decode(shown.result.content[0]!.text)).toMatchObject({
      tool: "rsp_show",
      found: true,
      text: original,
    });
  }, 120_000);
  it("built bundle keeps cold small git status off the resident", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);

    const res = runBundleFromCwd(root, ["git", "status"], {
      RED_SKILLS_CACHE_DIR: cacheDir,
      RSP_FAIL_IF_STORE_OPEN: "1",
    });
    const direct = runGit(["-C", root, "status", "--porcelain=v1"]);
    const paths = trackedResidentPaths(root);

    expect(res.status).toBe(0);
    if (direct.stdout.length === 0) {
      expect(decode(res.stdout.toString("utf8"))).toMatchObject({
        category: "no-op",
        scope: "git status",
        empty: true,
      });
    } else {
      expect(res.stdout).toEqual(direct.stdout);
    }
    expect(res.stderr).toEqual(Buffer.alloc(0));
    await expect(stat(paths.socketPath)).rejects.toMatchObject({ code: "ENOENT" });
    const status = runBundleFromCwd(root, ["status"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(status.status, `${status.stdout.toString("utf8")}${status.stderr.toString("utf8")}`).toBe(0);
    expect(decode(status.stdout.toString("utf8"))).toMatchObject({
      state: "missing",
    });
  }, 120_000);
  it("built bundle keeps cold git status off the resident drain path", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await enableRsp(root);
    await writeFile(join(root, ".gitignore"), ".red/\n", "utf8");
    expect(runGit(["-C", root, "add", ".gitignore"]).status).toBe(0);
    expect(runGit(["-C", root, "commit", "-m", "baseline"]).status).toBe(0);
    const cacheDir = await seedWarmRedCache();
    const storeUri = `file://${join(root, ".red", "state", "red-skills.rdb")}`;
    await mkdir(dirname(telemetrySpoolPath(root)), { recursive: true });
    const huge = "x".repeat(512 * 1024);
    await writeFile(telemetrySpoolPath(root), Array.from({ length: 8 }, (_, i) => JSON.stringify({
      collection: RSP_TELEMETRY_INVOCATIONS_COLLECTION,
      id: `backlog-${i}`,
      created_at: new Date().toISOString(),
      command: "git log --terse",
      elided: true,
      raw_bytes: huge.length,
      emitted_bytes: huge.length,
      raw_text: huge,
      emitted_text: huge,
    })).join("\n") + "\n", "utf8");

    const raw = timedStatus(() => runGit(["-C", root, "status", "--porcelain=v1"]));
    const node = timedStatus(runNodeNoop);
    const wrapped = timedStatus(() => runBundleFromCwd(root, ["--store-uri", storeUri, "git", "status"], {
      RED_SKILLS_CACHE_DIR: cacheDir,
      RSP_TELEMETRY_DRAIN_TIMEOUT_MS: String(normalizedDurationMs(60_000)),
    }));
    const paths = trackedResidentPaths(root);

    expect(wrapped.status, `${wrapped.stdout.toString("utf8")}${wrapped.stderr.toString("utf8")}`).toBe(0);
    expect(raw.stdout.length).toBe(0);
    expect(decode(wrapped.stdout.toString("utf8"))).toMatchObject({
      category: "no-op",
      scope: "git status",
      empty: true,
    });
    expect(wrapped.stderr).toEqual(Buffer.alloc(0));
    await expect(stat(paths.socketPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(wrapped.elapsedMs - node.elapsedMs).toBeLessThan(normalizedDurationMs(150) + raw.elapsedMs);
  }, 120_000);
  it("built bundle resident listens before opening the RedDB store", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const paths = trackedResidentPaths(root);
    const child = spawn(process.execPath, [bundle, "server", "--idle-ms", String(normalizedDurationMs(5_000))], {
      cwd: root,
      env: {
        ...process.env,
        RED_SKILLS_CACHE_DIR: cacheDir,
        RSP_TEST_HANG_RESIDENT_STORE_OPEN: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await waitForResidentSocket(root);
    const ping = await sendResidentRequest({ socketPath: paths.socketPath, timeoutMs: 200 }, {
      id: randomUUID(),
      op: "ping",
    });
    expect(ping).toMatchObject({ ok: false, error: "rsp resident store is not ready" });
    const stats = await sendResidentRequest({ socketPath: paths.socketPath, timeoutMs: 200 }, {
      id: randomUUID(),
      op: "stats",
    });
    expect(stats).toMatchObject({ ok: false, error: "rsp resident store is not ready" });
    await sendResidentRequest({ socketPath: paths.socketPath, timeoutMs: 200 }, {
      id: randomUUID(),
      op: "handover",
      clientVersion: "999.0.0",
    }).catch(() => undefined);
    if (child.exitCode == null) child.kill("SIGTERM");
    const status = await closeWithTimeout(child, normalizedDurationMs(5_000)).catch(() => null);
    expect(status === 0 || status === null).toBe(true);
  }, 120_000);
  it("built bundle warm-resident waits through a slow resident store open", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);

    const warm = runBundleFromCwd(root, ["warm-resident", "--idle-ms", String(normalizedDurationMs(30_000))], {
      RED_SKILLS_CACHE_DIR: cacheDir,
      RSP_TEST_DELAY_RESIDENT_STORE_OPEN_MS: "5500",
    });

    expect(warm.status, `${warm.stdout.toString("utf8")}${warm.stderr.toString("utf8")}`).toBe(0);
    expect(warm.stdout).toEqual(Buffer.alloc(0));
    expect(warm.stderr).toEqual(Buffer.alloc(0));
    await waitForResidentReady(root);
  }, 120_000);
  it("built bundle elision falls back fast when the resident store is not ready", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    await commitMany(root, 24);
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const paths = trackedResidentPaths(root);
    const child = spawn(process.execPath, [bundle, "server", "--idle-ms", String(normalizedDurationMs(5_000))], {
      cwd: root,
      env: {
        ...process.env,
        RED_SKILLS_CACHE_DIR: cacheDir,
        RSP_TEST_HANG_RESIDENT_STORE_OPEN: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForResidentSocket(root);

    const raw = runGit(["-C", root, "log"]);
    const node = timedStatus(runNodeNoop);
    const wrapped = timedStatus(() => runBundleFromCwd(root, ["git", "log", "--terse"], { RED_SKILLS_CACHE_DIR: cacheDir }));

    expect(wrapped.status, `${wrapped.stdout.toString("utf8")}${wrapped.stderr.toString("utf8")}`).toBe(0);
    expect(wrapped.stderr).toEqual(Buffer.alloc(0));
    expect(wrapped.stdout.length).toBeLessThan(raw.stdout.length);
    expect(wrapped.stdout.toString("utf8")).toContain("recovery unavailable (resident cold) — re-run: git log");
    expect(wrapped.elapsedMs - node.elapsedMs).toBeLessThan(normalizedDurationMs(250));
    await sendResidentRequest({ socketPath: paths.socketPath, timeoutMs: 200 }, {
      id: randomUUID(),
      op: "handover",
      clientVersion: "999.0.0",
    }).catch(() => undefined);
    if (child.exitCode == null) child.kill("SIGTERM");
    const status = await closeWithTimeout(child, normalizedDurationMs(5_000)).catch(() => null);
    expect(status === 0 || status === null).toBe(true);
  }, 120_000);
  it("built bundle teardown stops every spawned resident process", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const paths = trackedResidentPaths(root);

    const res = runBundleFromCwd(root, ["warm-resident", "--idle-ms", String(normalizedDurationMs(30_000))], {
      RED_SKILLS_CACHE_DIR: cacheDir,
    });

    expect(res.status, `${res.stdout.toString("utf8")}${res.stderr.toString("utf8")}`).toBe(0);
    await waitForResidentSocket(root);
    await expect(readPid(paths.pidPath)).resolves.toEqual(expect.any(Number));
    expect(await countTrackedResidentProcesses()).toBe(1);

    await stopTrackedResidents([]);

    expect(await countTrackedResidentProcesses([root])).toBe(0);
  }, 120_000);
  it("built bundle idle resident exits even when final telemetry drain hangs", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const paths = trackedResidentPaths(root);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const started = Date.now();
    const child = spawn(process.execPath, [
      bundle,
      "server",
      "--idle-ms",
      "100",
      "--telemetry-drain-timeout-ms",
      "60000",
    ], {
      cwd: root,
      env: {
        ...process.env,
        RED_SKILLS_CACHE_DIR: cacheDir,
        RSP_TEST_HANG_TELEMETRY_DRAIN: "1",
        RSP_TEST_IDLE_SHUTDOWN_WATCHDOG_MS: String(normalizedDurationMs(500)),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

    await waitForResidentSocket(root);
    const status = await closeWithTimeout(child, normalizedDurationMs(5_000));

    expect(status, `${Buffer.concat(stdout).toString("utf8")}${Buffer.concat(stderr).toString("utf8")}`).toBe(0);
    expect(Date.now() - started).toBeLessThan(normalizedDurationMs(10_000));
    await expect(stat(paths.socketPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await countTrackedResidentProcesses()).toBe(0);
  }, 120_000);
  it("built bundle Claude pre-exec hook rewrites while cold and warms once", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const env = { RED_SKILLS_CACHE_DIR: cacheDir };
    const paths = trackedResidentPaths(root);

    const coldNodeBaseline = timedStatus(runNodeNoop);
    const cold = timedStatus(() => runBundleHookFromCwd(root, "git status", env));
    const coldHookWorkMs = Math.max(0, cold.elapsedMs - coldNodeBaseline.elapsedMs);

    expect(cold.status).toBe(0);
    expect(JSON.parse(cold.stdout.toString("utf8"))).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: "rsp proxy -- 'git status'" },
      },
    });
    expect(cold.stderr).toEqual(Buffer.alloc(0));
    await expectLatencyBudget(
      "cold pre-exec hook work",
      budgetSample(
        coldHookWorkMs,
        coldNodeBaseline.elapsedMs,
        `node=${coldNodeBaseline.elapsedMs.toFixed(1)}ms cold=${cold.elapsedMs.toFixed(1)}ms hookWork=${coldHookWorkMs.toFixed(1)}ms`,
      ),
      normalizedLatencyRatio(8),
      async () => {
        const retryRoot = await initGitRepo();
        const retryCacheDir = await seedWarmRedCache();
        const retrySetup = runBundleFromCwd(retryRoot, ["setup"], { RED_SKILLS_CACHE_DIR: retryCacheDir });
        expect(retrySetup.status, `${retrySetup.stdout.toString("utf8")}${retrySetup.stderr.toString("utf8")}`).toBe(0);
        const retryEnv = { RED_SKILLS_CACHE_DIR: retryCacheDir };
        const retryNodeBaseline = timedStatus(runNodeNoop);
        const retryCold = timedStatus(() => runBundleHookFromCwd(retryRoot, "git status", retryEnv));
        const retryColdHookWorkMs = Math.max(0, retryCold.elapsedMs - retryNodeBaseline.elapsedMs);

        expect(retryCold.status).toBe(0);
        expect(JSON.parse(retryCold.stdout.toString("utf8"))).toMatchObject({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: { command: "rsp proxy -- 'git status'" },
          },
        });
        expect(retryCold.stderr).toEqual(Buffer.alloc(0));
        return budgetSample(
          retryColdHookWorkMs,
          retryNodeBaseline.elapsedMs,
          `node=${retryNodeBaseline.elapsedMs.toFixed(1)}ms cold=${retryCold.elapsedMs.toFixed(1)}ms hookWork=${retryColdHookWorkMs.toFixed(1)}ms`,
        );
      },
    );
    await waitForResidentSocket(root);
    // The wake lock is transient; the observable contract is that the hook's
    // kick brings the resident online.
    await waitForGone(paths.wakeLockPath);

    for (let i = 0; i < 4; i++) {
      const repeat = runBundleHookFromCwd(root, "git status", env);
      expect(repeat.status).toBe(0);
      expect(JSON.parse(repeat.stdout.toString("utf8"))).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { command: "rsp proxy -- 'git status'" },
        },
      });
      expect(repeat.stderr).toEqual(Buffer.alloc(0));
    }

    const measureWarmHookWork = () => {
      const nodeSamples: number[] = [];
      const warmSamples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const node = timedStatus(runNodeNoop);
        const warm = timedStatus(() => runBundleHookFromCwd(root, "git status", env));

        expect(warm.status).toBe(0);
        expect(JSON.parse(warm.stdout.toString("utf8"))).toMatchObject({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: { command: "rsp proxy -- 'git status'" },
          },
        });
        expect(warm.stderr).toEqual(Buffer.alloc(0));
        nodeSamples.push(node.elapsedMs);
        warmSamples.push(warm.elapsedMs);
      }

      const nodeMedian = median(nodeSamples);
      const warmMedian = median(warmSamples);
      return {
        nodeMedian,
        warmMedian,
        hookWorkMs: Math.max(0, warmMedian - nodeMedian),
      };
    };

    const measuredWarm = measureWarmHookWork();
    await expectLatencyBudget(
      "warm pre-exec hook work",
      budgetSample(
        measuredWarm.hookWorkMs,
        measuredWarm.nodeMedian,
        `node=${measuredWarm.nodeMedian.toFixed(1)}ms warm=${measuredWarm.warmMedian.toFixed(1)}ms ` +
          `hookWork=${measuredWarm.hookWorkMs.toFixed(1)}ms`,
      ),
      normalizedLatencyRatio(8),
      () => {
        const retry = measureWarmHookWork();
        return budgetSample(
          retry.hookWorkMs,
          retry.nodeMedian,
          `node=${retry.nodeMedian.toFixed(1)}ms warm=${retry.warmMedian.toFixed(1)}ms ` +
            `hookWork=${retry.hookWorkMs.toFixed(1)}ms`,
        );
      },
    );
  }, 120_000);
  it("built bundle keeps the warmed resident alive until the configured idle timeout", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const idleMs = normalizedDurationMs(5_000);
    const env = { RED_SKILLS_CACHE_DIR: cacheDir, RSP_IDLE_MS: String(idleMs) };
    const paths = trackedResidentPaths(root);

    const cold = runBundleHookFromCwd(root, "git status", env);
    expect(cold.status).toBe(0);
    expect(JSON.parse(cold.stdout.toString("utf8"))).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: "rsp proxy -- 'git status'" },
      },
    });
    expect(cold.stderr).toEqual(Buffer.alloc(0));
    await waitForResidentSocket(root);
    await waitForGone(paths.wakeLockPath);

    await new Promise((resolve) => setTimeout(resolve, normalizedDurationMs(2_000)));
    const warm = runBundleHookFromCwd(root, "git status", env);
    expect(warm.status).toBe(0);
    expect(JSON.parse(warm.stdout.toString("utf8"))).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: "rsp proxy -- 'git status'" },
      },
    });
    expect(warm.stderr).toEqual(Buffer.alloc(0));

    await waitForGone(paths.socketPath, idleMs + normalizedDurationMs(5_000));
    await waitForGone(paths.registryPath);
    const expired = runBundleHookFromCwd(root, "git status", env);
    expect(expired.status).toBe(0);
    expect(JSON.parse(expired.stdout.toString("utf8"))).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: "rsp proxy -- 'git status'" },
      },
    });
    expect(expired.stderr).toEqual(Buffer.alloc(0));
  }, 120_000);
  it("built bundle Codex pre-exec rewrite records telemetry when the rewritten command runs", async () => {
    buildBundleOnce();
    const root = await initGitRepo();
    const cacheDir = await seedWarmRedCache();
    const setup = runBundleFromCwd(root, ["setup"], { RED_SKILLS_CACHE_DIR: cacheDir });
    expect(setup.status, `${setup.stdout.toString("utf8")}${setup.stderr.toString("utf8")}`).toBe(0);
    const env = { RED_SKILLS_CACHE_DIR: cacheDir };
    const storeUri = `file://${join(root, ".red", "state", "red-skills.rdb")}`;
    const resident = runBundleFromCwdAsync(root, ["server", "--idle-ms", "1000"], env);
    await waitForResidentSocket(root);
    await waitForResidentReady(root);

    const hook = runBundleCodexHookFromCwd(root, "git status", env);
    expect(hook.status, `${hook.stdout.toString("utf8")}${hook.stderr.toString("utf8")}`).toBe(0);
    expect(hook.stderr).toEqual(Buffer.alloc(0));
    expect(JSON.parse(hook.stdout.toString("utf8"))).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: "rsp proxy -- 'git status'" },
      },
    });

    const rewritten = runBundleFromCwd(root, ["git", "status"], env);
    expect(rewritten.status).toBe(0);
    expect(rewritten.stderr).toEqual(Buffer.alloc(0));
    const residentResult = await resident;
    expect(residentResult.status, `${residentResult.stdout.toString("utf8")}${residentResult.stderr.toString("utf8")}`).toBe(0);

    const invocations = await readTelemetryRecords(storeUri, RSP_TELEMETRY_INVOCATIONS_COLLECTION);
    expect(invocations).toContainEqual(expect.objectContaining({
      command: "git status",
      wrapper: "git",
      loss: "lossless",
      elided: false,
    }));

    const disabledRoot = await initGitRepo();
    const disabledHook = runBundleCodexHookFromCwd(disabledRoot, "git status", env);
    expect(disabledHook.status).toBe(0);
    expect(disabledHook.stdout).toEqual(Buffer.alloc(0));
    expect(disabledHook.stderr).toEqual(Buffer.alloc(0));
    const direct = runGit(["-C", disabledRoot, "status"]);
    const disabled = runBundleFromCwd(disabledRoot, ["git", "status"], env);
    expect(disabled.status).toBe(direct.status);
    expect(disabled.stdout).toEqual(direct.stdout);
    expect(disabled.stderr).toEqual(direct.stderr);
  }, 120_000);
 });
