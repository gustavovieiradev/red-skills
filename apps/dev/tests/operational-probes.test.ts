import { describe, expect, it } from "vitest";
import { decode } from "@reddb-io/toon";
import {
  applyOperationalProbeFixes,
  assertOperationalProbesGreen,
  evaluateOperationalProbes,
  httpsGithubRemoteToSsh,
  OperationalProbeHaltError,
  renderOperationalProbeReportToon,
  type OperationalProbeFixIo,
} from "../src/core/operational-probes.js";
import type { PrecheckFacts } from "../src/core/boot.js";

function facts(remoteUrls: readonly string[]): PrecheckFacts {
  return {
    ghInstalled: true,
    ghAuthenticated: true,
    isGitRepo: true,
    remoteUrls,
    hasMainBranch: true,
    currentBranch: "main",
    pnpmInstalled: true,
  };
}

function fakeRemoteIo(initial: Record<string, string>): { io: OperationalProbeFixIo; snapshot: () => string } {
  const remotes = new Map(Object.entries(initial));
  return {
    snapshot: () => JSON.stringify([...remotes.entries()].sort()),
    io: {
      async remoteUrls() {
        return [...remotes.entries()].map(([name, url]) => ({ name, url }));
      },
      async setRemoteUrl(name, url) {
        remotes.set(name, url);
      },
    },
  };
}

describe("operational probe registry", () => {
  it("reports a GitHub HTTPS remote as a red probe with a canonical fix", async () => {
    const report = await evaluateOperationalProbes({
      precheck: facts(["https://github.com/reddb-io/red-skills.git"]),
    });

    expect(report.status).toBe("red");
    expect(report.probes).toContainEqual(expect.objectContaining({
      probe: "https-git-remote",
      name: "Git remotes must use SSH for AFK",
      status: "red",
      fixGate: "confirm",
    }));
    expect(() => assertOperationalProbesGreen(report)).toThrow(OperationalProbeHaltError);
  });

  it("renders AI-facing probe output as decodable TOON", async () => {
    const report = await evaluateOperationalProbes({
      precheck: facts(["https://github.com/reddb-io/red-skills.git"]),
    });

    const toon = renderOperationalProbeReportToon(report);
    expect(toon).toContain("schema_version: red.dev.operational_probes.v1");
    expect(toon).not.toContain("{\n");
    expect(decode(toon)).toEqual(report);
  });

  it("keeps the read-only probe pass side-effect-free", async () => {
    const remote = fakeRemoteIo({ origin: "https://github.com/reddb-io/red-skills.git" });
    const before = remote.snapshot();

    await evaluateOperationalProbes({
      precheck: facts(["https://github.com/reddb-io/red-skills.git"]),
    });

    expect(remote.snapshot()).toBe(before);
  });

  it("refuses a confirm-gated fix without mutating remote state", async () => {
    const remote = fakeRemoteIo({ origin: "https://github.com/reddb-io/red-skills.git" });
    const report = await evaluateOperationalProbes({
      precheck: facts(["https://github.com/reddb-io/red-skills.git"]),
    });
    const before = remote.snapshot();

    const receipts = await applyOperationalProbeFixes(report, remote.io, () => false);

    expect(receipts).toEqual([expect.objectContaining({ status: "refused", changed: false })]);
    expect(remote.snapshot()).toBe(before);
  });

  it("applies a confirmed fix with an observable remote-url change", async () => {
    const remote = fakeRemoteIo({ origin: "https://github.com/reddb-io/red-skills.git" });
    const report = await evaluateOperationalProbes({
      precheck: facts(["https://github.com/reddb-io/red-skills.git"]),
    });

    const receipts = await applyOperationalProbeFixes(report, remote.io, () => true);

    expect(receipts).toEqual([expect.objectContaining({ status: "applied", changed: true })]);
    expect(remote.snapshot()).toContain("git@github.com:reddb-io/red-skills.git");
  });

  it("normalizes GitHub HTTPS remote URLs to SSH", () => {
    expect(httpsGithubRemoteToSsh("https://github.com/reddb-io/red-skills")).toBe(
      "git@github.com:reddb-io/red-skills.git",
    );
    expect(httpsGithubRemoteToSsh("https://example.com/reddb-io/red-skills.git")).toBeNull();
  });
});
