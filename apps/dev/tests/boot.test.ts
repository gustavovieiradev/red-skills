import { describe, expect, it, vi } from "vitest";
import {
  precheck,
  runBoot,
  BootHaltError,
  facts,
  makeDeps,
  options,
  attempt,
  type BootDeps,
} from "./boot.test-helpers.js";

describe("precheck", () => {
  it("passes with no warnings when every precondition holds", () => {
    expect(precheck(facts())).toEqual({ ok: true, warnings: [] });
  });

  it("fails gh-missing first", () => {
    expect(precheck(facts({ ghInstalled: false, ghAuthenticated: false }))).toEqual({
      ok: false,
      failed: "gh-missing",
    });
  });

  it("fails gh-unauthenticated", () => {
    expect(precheck(facts({ ghAuthenticated: false }))).toEqual({
      ok: false,
      failed: "gh-unauthenticated",
    });
  });

  it("fails not-a-git-repo", () => {
    expect(precheck(facts({ isGitRepo: false }))).toEqual({
      ok: false,
      failed: "not-a-git-repo",
    });
  });

  it("leaves https remotes to the operational probe registry", () => {
    expect(
      precheck(facts({ remoteUrls: ["https://github.com/reddb-io/red-skills.git"] })),
    ).toEqual({ ok: true, warnings: [] });
  });

  it("allows an https remote in a CI lane (allowHttpsRemote) — GHA checkout is token-https", () => {
    // The Actions lane checks out an https remote authed by GITHUB_TOKEN; the
    // SSH-only rule must not fire there or every cloud attempt dies at precheck.
    expect(
      precheck(
        facts({
          remoteUrls: ["https://github.com/reddb-io/red-skills.git"],
          allowHttpsRemote: true,
        }),
      ),
    ).toEqual({ ok: true, warnings: [] });
  });

  it("fails no-main-branch", () => {
    expect(precheck(facts({ hasMainBranch: false }))).toEqual({
      ok: false,
      failed: "no-main-branch",
    });
  });

  it("fails not-on-trunk, naming the current branch, expected default branch, and trunk source", () => {
    expect(precheck(facts({ currentBranch: "feature/x" }))).toEqual({
      ok: false,
      failed: "not-on-trunk",
      detail: { current: "feature/x", expected: "main", source: "trunk" },
    });
  });

  it("passes when the current branch matches the configured trunk", () => {
    expect(precheck(facts({ currentBranch: "develop", configuredTrunk: "develop" }))).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it("fails not-on-trunk, naming the configured trunk when the checkout is on main", () => {
    expect(precheck(facts({ currentBranch: "main", configuredTrunk: "develop" }))).toEqual({
      ok: false,
      failed: "not-on-trunk",
      detail: { current: "main", expected: "develop", source: "trunk" },
    });
  });

  it("fails not-on-trunk, naming the configured branch pin as the expectation source", () => {
    expect(
      precheck(facts({ currentBranch: "main", configuredTrunk: "release/x", configuredTrunkSource: "pin" })),
    ).toEqual({
      ok: false,
      failed: "not-on-trunk",
      detail: { current: "main", expected: "release/x", source: "pin" },
    });
  });

  it("locked: passes when currentBranch matches the lock value", () => {
    expect(precheck(facts({ currentBranch: "feature-locked", lockedBranch: "feature-locked" }))).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it("locked: overrides the configured trunk", () => {
    expect(
      precheck(
        facts({
          currentBranch: "feature-locked",
          lockedBranch: "feature-locked",
          configuredTrunk: "develop",
        }),
      ),
    ).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it("locked: fails not-on-trunk when currentBranch is main instead of the lock value", () => {
    expect(precheck(facts({ currentBranch: "main", lockedBranch: "feature-locked" }))).toEqual({
      ok: false,
      failed: "not-on-trunk",
      detail: { current: "main", expected: "feature-locked", source: "lock" },
    });
  });

  it("locked: fails not-on-trunk when currentBranch is a different branch than the lock value", () => {
    expect(precheck(facts({ currentBranch: "other-branch", lockedBranch: "feature-locked" }))).toEqual({
      ok: false,
      failed: "not-on-trunk",
      detail: { current: "other-branch", expected: "feature-locked", source: "lock" },
    });
  });

  it("treats a missing pnpm as a warning, not a failure", () => {
    const r = precheck(facts({ pnpmInstalled: false }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual(["pnpm not on PATH; feedback loops will be skipped"]);
  });
});

// ---------- runBoot harness ----------

describe("runBoot precheck short-circuit", () => {
  it("aborts before bootstrap on a precheck failure", async () => {
    const { deps, calls } = makeDeps();
    const result = await runBoot(deps, options({ precheck: facts({ ghInstalled: false }) }));
    expect(result.precheck).toEqual({ ok: false, failed: "gh-missing" });
    expect(result.bootstrap).toBeUndefined();
    expect(result.orphanCleanup).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("refuses on a red operational probe before bootstrap, naming the probe and fix", async () => {
    const { deps, calls } = makeDeps();
    await expect(
      runBoot(
        deps,
        options({
          precheck: facts({
            remoteUrls: [{ name: "origin", url: "https://github.com/reddb-io/red-skills.git" }],
          }),
        }),
      ),
    ).rejects.toMatchObject({
      phase: "operational-probe",
      probe: {
        name: "SSH-only git remotes",
        canonicalFix: expect.stringContaining("Use SSH git remotes"),
      },
    });
    await expect(
      runBoot(
        deps,
        options({
          precheck: facts({
            remoteUrls: [{ name: "origin", url: "https://github.com/reddb-io/red-skills.git" }],
          }),
        }),
      ),
    ).rejects.toThrow(/SSH-only git remotes.*Use SSH git remotes/);
    expect(calls).toEqual([]);
  });

  it("refuses on an unlistable queue, naming the queue visibility probe", async () => {
    const { deps, calls } = makeDeps();
    await expect(
      runBoot(
        deps,
        options({
          precheck: facts({
            remoteUrls: [],
            queueVisibility: {
              listEngineCandidates: async () => {
                throw Object.assign(new Error("Resource protected by organization SAML enforcement"), {
                  surface: "graphql",
                });
              },
              countRestQueue: async () => 3,
            },
          }),
        }),
      ),
    ).rejects.toMatchObject({
      phase: "operational-probe",
      probe: {
        name: "AFK queue visibility",
        canonicalFix: expect.stringContaining("gh auth refresh"),
      },
    });
    expect(calls).toEqual([]);
  });

  it("auto-applies guarded base-freshness before bootstrap and logs the before/after SHAs", async () => {
    const fastForwardLocalBase = vi.fn(async () => ({
      action: "fast-forward" as const,
      guard: "passed" as const,
      target: "main",
      remote: "origin",
      currentBranch: "main",
      evidence: "fast-forwarded main to origin/main",
    }));
    const log = vi.fn();
    const { deps, calls } = makeDeps({ fastForwardLocalBase, log });

    const result = await runBoot(
      deps,
      options({
        operationalProbes: {
          remoteUrls: [],
          baseFreshness: {
            trunk: "main",
            remote: "origin",
            localSha: "1111111111111111111111111111111111111111",
            remoteSha: "2222222222222222222222222222222222222222",
            ahead: 0,
            behind: 1,
            remoteReachable: true,
            guard: {
              guard: "passed",
              target: "main",
              remote: "origin",
              currentBranch: "main",
              evidence: "guard passed: on-trunk clean-tree ancestor (main -> origin/main)",
            },
          },
        },
      }),
    );

    expect(result.bootstrap).toEqual({ ok: true });
    expect(fastForwardLocalBase).toHaveBeenCalledWith({ remote: "origin", target: "main" });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "boot operational probe auto-fix applied: afk.base-freshness before=111111111111 after=222222222222",
      ),
    );
    expect(calls.slice(0, 3)).toEqual([
      "fs.ensureDir:/p/.red/tmp",
      "fs.ensureDir:/p/.red/state",
      "fs.gitignore:.red/tmp/",
    ]);
  });

  it.each([
    [
      "off-trunk",
      {
        guard: "refused" as const,
        target: "main",
        remote: "origin",
        currentBranch: "feature/work",
        failed: "not-on-trunk" as const,
        failedCondition: "on-trunk" as const,
        evidence: "condition failed: on-trunk (current=feature/work expected=main)",
      },
    ],
    [
      "dirty tree",
      {
        guard: "refused" as const,
        target: "main",
        remote: "origin",
        currentBranch: "main",
        failed: "dirty-tree" as const,
        failedCondition: "clean-tree" as const,
        evidence: "condition failed: clean-tree (1 dirty path(s))",
      },
    ],
    [
      "diverged",
      {
        guard: "refused" as const,
        target: "main",
        remote: "origin",
        currentBranch: "main",
        failed: "not-ancestor" as const,
        failedCondition: "ancestor" as const,
        evidence: "condition failed: ancestor (main is not an ancestor of origin/main)",
      },
    ],
  ])("keeps halting on base-freshness when the guard refuses: %s", async (_name, guard) => {
    const fastForwardLocalBase = vi.fn();
    const { deps, calls } = makeDeps({ fastForwardLocalBase });

    await expect(
      runBoot(
        deps,
        options({
          operationalProbes: {
            remoteUrls: [],
            baseFreshness: {
              trunk: "main",
              remote: "origin",
              localSha: "1111111111111111111111111111111111111111",
              remoteSha: "2222222222222222222222222222222222222222",
              ahead: 0,
              behind: 1,
              remoteReachable: true,
              guard,
            },
          },
        }),
      ),
    ).rejects.toThrow(/Operational probe red: AFK local trunk freshness/);

    expect(fastForwardLocalBase).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("refuses boot on discarded config fallback, naming the config coherence probe", async () => {
    const { deps, calls } = makeDeps();
    await expect(
      runBoot(
        deps,
        options({
          precheck: facts({
            remoteUrls: [],
            configCoherence: {
              path: "/repo/.red/config.yaml",
              displayPath: ".red/config.yaml",
              fileLoaded: true,
              discarded: true,
              parseFailure: {
                message: "malformed YAML at line 4: expected a mapping key",
                line: 4,
                construct: "expected a mapping key",
              },
              rootAccessorCollisions: [],
              resolved: { trunk: "main", gate: "", lock: "" },
            },
          }),
        }),
      ),
    ).rejects.toMatchObject({
      phase: "operational-probe",
      probe: {
        id: "config.coherence",
        name: "Config coherence",
        evidence: expect.stringContaining("line 4: expected a mapping key"),
      },
    });
    expect(calls).toEqual([]);
  });
});

describe("runBoot Docs Sweep", () => {
  it("lands stranded docs before the unblock sweep", async () => {
    const blockerState: BootDeps["lookups"]["blockerState"] = async () => "CLOSED";
    const { deps, calls } = makeDeps({
      blockerState,
      docsSweepLander: async (plan) => {
        calls.push(`docs.land:${plan.files.map((f) => f.path).join(",")}`);
        return { ok: true };
      },
    });

    await runBoot(
      deps,
      options({
        docsSweep: {
          base: "main",
          files: [
            {
              path: ".red/CONTEXT-MAP.md",
              state: "modified",
              group: "glossary",
              ignored: false,
              trackedPrecedent: true,
            },
          ],
        },
        unblockCandidates: [
          { number: 100, labels: ["blocked:dependency"], body: "## Blocked by\n\n- [ ] #10\n" },
        ],
      }),
    );

    expect(calls.indexOf("docs.land:.red/CONTEXT-MAP.md")).toBeLessThan(calls.indexOf("gh.editLabels:100"));
  });

  it("halts before worker-consumable sweeps when stranded docs cannot land", async () => {
    const { deps, calls } = makeDeps();
    await expect(
      runBoot(
        deps,
        options({
          docsSweep: {
            base: "main",
            files: [
              {
                path: ".red/adr/0099-docs-sweep.md",
                state: "untracked",
                group: "adr",
                ignored: true,
                trackedPrecedent: false,
              },
            ],
          },
          unblockCandidates: [
            { number: 100, labels: ["blocked:dependency"], body: "## Blocked by\n\n- [ ] #10\n" },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(BootHaltError);
    expect(calls).not.toContain("gh.editLabels:100");
  });
});

describe("runBoot bootstrap", () => {
  it("ensures dirs, gitignore lines, and writes worker.pid", async () => {
    const { deps, fsCalls } = makeDeps();
    await runBoot(deps, options());
    expect(fsCalls.ensureDir).toEqual([
      "/p/.red/tmp",
      "/p/.red/state",
      "/p/.red/tmp/workers/wAAA",
    ]);
    expect(fsCalls.gitignore).toEqual([".red/tmp/", ".red/state/"]);
    expect(fsCalls.workerPid).toEqual([
      { path: "/p/.red/tmp/workers/wAAA/worker.pid", pid: 4242 },
    ]);
  });
});

describe("runBoot skipSweeps — supervisor-owned boot (#623)", () => {
  it("runs precheck + bootstrap then returns before every sweep", async () => {
    const { deps, calls, fsCalls } = makeDeps();
    // Provide sweep INPUTS that would normally trigger work, to prove they are
    // ignored once skipSweeps is set: an orphan dir, an attempt-cap group, a
    // reapable branch, and an unblock candidate.
    const result = await runBoot(
      deps,
      options({
        skipSweeps: true,
        orphans: [{ path: "/d/orphan", issue: 7, ageS: 999_999 }],
        attemptCap: { byIssue: new Map([[7, [attempt(7, 1, 999_999)]]]) },
        branches: { snapshotRefs: [{ branch: "afk-attempts/7-x" }], remoteLiveRefs: [], localLiveRefs: [] },
        unblockCandidates: [{ number: 9, body: "", labels: ["blocked:dependency", "req:1"] }],
      }),
    );

    // Bootstrap still ran (dirs + gitignore + worker.pid).
    expect(fsCalls.ensureDir).toEqual([
      "/p/.red/tmp",
      "/p/.red/state",
      "/p/.red/tmp/workers/wAAA",
    ]);
    expect(fsCalls.workerPid).toHaveLength(1);
    // …but NOTHING else: no removeDir, no gh, no git — every sweep was skipped.
    expect(fsCalls.removeDir).toEqual([]);
    expect(calls.filter((c) => c.startsWith("gh.") || c.startsWith("git."))).toEqual([]);

    // The result carries only precheck + bootstrap; every sweep field is absent.
    expect(result.precheck.ok).toBe(true);
    expect(result.bootstrap).toEqual({ ok: true });
    expect(result.orphanCleanup).toBeUndefined();
    expect(result.attemptCap).toBeUndefined();
    expect(result.branchCleanup).toBeUndefined();
    expect(result.tmpJanitor).toBeUndefined();
    expect(result.unblockSweep).toBeUndefined();
    expect(result.reconcileSweep).toBeUndefined();
    expect(result.straggler).toBeUndefined();
  });

  it("still aborts on a precheck failure before bootstrap", async () => {
    const { deps, calls } = makeDeps();
    const result = await runBoot(
      deps,
      options({ skipSweeps: true, precheck: facts({ ghInstalled: false }) }),
    );
    expect(result.precheck).toEqual({ ok: false, failed: "gh-missing" });
    expect(result.bootstrap).toBeUndefined();
    expect(calls).toEqual([]);
  });

  // Regression test for #2054: base-freshness probe kills worker sessions when local
  // main is behind origin after a release. Workers branch from origin/main, so a
  // behind local main does not affect their work — downgrade to non-fatal when guard passes.
  it("does NOT halt on base-freshness guard=passed — worker branches from origin/main anyway", async () => {
    // No fastForwardLocalBase dep (matches buildMinimalBootDeps for worker sessions).
    const { deps, fsCalls } = makeDeps();

    const result = await runBoot(
      deps,
      options({
        skipSweeps: true,
        operationalProbes: {
          remoteUrls: [],
          baseFreshness: {
            trunk: "main",
            remote: "origin",
            localSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
            remoteSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ahead: 0,
            behind: 1,
            remoteReachable: true,
            guard: {
              guard: "passed",
              target: "main",
              remote: "origin",
              currentBranch: "main",
              evidence: "guard passed: on-trunk clean-tree ancestor (main -> origin/main)",
            },
          },
        },
      }),
    );

    expect(result.bootstrap).toEqual({ ok: true });
    // The finding is still recorded in the probe report (visible in logs) but non-fatal.
    expect(result.operationalProbes?.findings).toHaveLength(1);
    expect(result.operationalProbes?.findings[0]?.id).toBe("afk.base-freshness");
    // Bootstrap ran normally.
    expect(fsCalls.ensureDir).toContain("/p/.red/tmp");
  });

  it.each([
    [
      "off-trunk",
      {
        guard: "refused" as const,
        target: "main",
        remote: "origin",
        currentBranch: "feature/work",
        failed: "not-on-trunk" as const,
        failedCondition: "on-trunk" as const,
        evidence: "condition failed: on-trunk (current=feature/work expected=main)",
      },
    ],
    [
      "dirty tree",
      {
        guard: "refused" as const,
        target: "main",
        remote: "origin",
        currentBranch: "main",
        failed: "dirty-tree" as const,
        failedCondition: "clean-tree" as const,
        evidence: "condition failed: clean-tree (1 dirty path(s))",
      },
    ],
    [
      "diverged",
      {
        guard: "refused" as const,
        target: "main",
        remote: "origin",
        currentBranch: "main",
        failed: "not-ancestor" as const,
        failedCondition: "ancestor" as const,
        evidence: "condition failed: ancestor (main is not an ancestor of origin/main)",
      },
    ],
  ])("still halts on base-freshness guard=refused in worker session: %s", async (_name, guard) => {
    const { deps } = makeDeps();

    await expect(
      runBoot(
        deps,
        options({
          skipSweeps: true,
          operationalProbes: {
            remoteUrls: [],
            baseFreshness: {
              trunk: "main",
              remote: "origin",
              localSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
              remoteSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              ahead: 0,
              behind: 1,
              remoteReachable: true,
              guard,
            },
          },
        }),
      ),
    ).rejects.toThrow(/Operational probe red: AFK local trunk freshness/);
  });

  it("still halts on a second red probe even when base-freshness guard=passed is exempt", async () => {
    const { deps } = makeDeps();

    await expect(
      runBoot(
        deps,
        options({
          skipSweeps: true,
          operationalProbes: {
            remoteUrls: [],
            baseFreshness: {
              trunk: "main",
              remote: "origin",
              localSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
              remoteSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              ahead: 0,
              behind: 1,
              remoteReachable: true,
              guard: {
                guard: "passed",
                target: "main",
                remote: "origin",
                currentBranch: "main",
                evidence: "guard passed: on-trunk clean-tree ancestor (main -> origin/main)",
              },
            },
            configCoherence: {
              path: "/repo/.red/config.yaml",
              displayPath: ".red/config.yaml",
              fileLoaded: true,
              discarded: true,
              parseFailure: { message: "malformed YAML at line 3", line: 3 },
              rootAccessorCollisions: [],
              resolved: { trunk: "main", gate: "", lock: "" },
            },
          },
        }),
      ),
    ).rejects.toMatchObject({
      phase: "operational-probe",
      probe: { id: "config.coherence" },
    });
  });
});
