import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode } from "@reddb-io/toon";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHeadroomOutput,
  buildTwoAxisBenchmarkReport,
  renderTwoAxisSummary,
  writeTwoAxisBenchmarkReport,
} from "../src/two-axis-benchmark.js";

const roots: string[] = [];
const fixtureRoot = join(import.meta.dirname, "fixtures");

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rsp-two-axis-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("rsp two-axis benchmark report", () => {
  it("reports shipped modes plus brief and terse token deltas with fidelity", async () => {
    const report = await buildTwoAxisBenchmarkReport({ fixtureRoot });

    expect(report.corpus).toMatchObject({
      fixture_count: 18,
      large_output_filters: ["git:diff", "git:log", "vitest:run"],
    });
    expect(report.method.tokenizer).toBe("js-tiktoken:gpt-4o");
    expect(report.method.rtk_source).toMatchObject({ kind: "recorded-fixtures", version: expect.stringMatching(/^rtk /) });
    expect(report.method.external_claims[0]).toMatchObject({ status: "cited_unverified", measured_locally: false });
    expect(report.aggregate.headroom_tokens).toBeGreaterThan(0);
    expect(report.aggregate.raw_tokens).toBeGreaterThan(report.aggregate.headroom_tokens);
    expect(report.aggregate.rsp_brief_pct_of_headroom ?? 0).toBeGreaterThan(0);
    expect(report.aggregate.rtk_pct_of_headroom ?? 0).toBeGreaterThan(0);
    expect(report.aggregate.rsp_brief_tokens).toBe(sum(report.filters.map((row) => row.headroom.rsp_brief_tokens)));
    expect(report.aggregate.headroom_tokens).toBe(sum(report.filters.map((row) => row.headroom.headroom_tokens)));

    const gitCommit = report.filters.find((row) => row.filter === "git:commit");
    expect(gitCommit).toMatchObject({
      mode: "passthrough",
      raw: { median_delta_pct: 0, p90_delta_pct: 0, fidelity_pass_rate_pct: 100 },
      brief: { median_delta_pct: 0, p90_delta_pct: 0, fidelity_pass_rate_pct: 100 },
      terse: { median_delta_pct: 0, p90_delta_pct: 0, fidelity_pass_rate_pct: 100 },
      rtk: { fidelity_pass_rate_pct: 100, source: "recorded" },
      hypothetical_active: {
        brief: { source: "measured" },
        terse: { source: "measured" },
      },
    });
    expect(typeof gitCommit?.brief.median_delta_pct).toBe("number");
    expect(gitCommit?.headroom.raw_tokens).toBeGreaterThan(gitCommit?.headroom.headroom_tokens ?? 0);
    expect(gitCommit?.headroom.rsp_brief_tokens).toBe(gitCommit?.headroom.raw_tokens);

    const vitest = report.filters.find((row) => row.filter === "vitest:run");
    expect(vitest).toMatchObject({
      mode: "active",
      fixture_count: 6,
      brief: { fidelity_pass_rate_pct: 100 },
      terse: { fidelity_pass_rate_pct: 100 },
    });
    expect(vitest?.terse.median_delta_pct).toBeGreaterThanOrEqual(vitest?.brief.median_delta_pct ?? 0);
    expect(vitest?.headroom.headroom_tokens).toBeGreaterThan(0);
    expect(vitest?.headroom.rsp_terse_tokens).toBeGreaterThan(vitest?.headroom.headroom_tokens ?? 0);

    expect(report.filters.find((row) => row.filter === "git:diff")).toMatchObject({ fixture_count: 2 });
    expect(report.filters.find((row) => row.filter === "git:log")).toMatchObject({ fixture_count: 2 });

    expect(report.parity).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "cargo-test", filter: "cargo:test", rsp_fidelity_pass_rate_pct: 100 }),
      expect.objectContaining({ domain: "git-commit", filter: "git:commit", rsp_fidelity_pass_rate_pct: 100 }),
    ]));

    const decoded = decode(report.toon);
    expect(decoded).toMatchObject({ benchmark: "rsp-two-axis", corpus: { fixture_count: report.corpus.fixture_count } });
  });

  it("writes a reproducible TOON artifact and matching human summary", async () => {
    const root = await tempRoot();
    const toonPath = join(root, "two-axis.toon");
    const summaryPath = join(root, "two-axis.md");

    const report = await writeTwoAxisBenchmarkReport({ fixtureRoot, toonPath, summaryPath });

    await expect(readFile(toonPath, "utf8")).resolves.toBe(report.toon);
    await expect(readFile(summaryPath, "utf8")).resolves.toBe(renderTwoAxisSummary(report));
    await expect(readFile(summaryPath, "utf8")).resolves.toContain("| Filter | Mode | Fixtures | raw tok | brief tok | terse tok | RTK tok | headroom tok | brief headroom | terse headroom | RTK headroom | brief shipped delta | brief fidelity | brief hyp-active delta | terse shipped delta | terse fidelity | terse hyp-active delta | RTK median/p90 token delta | RTK fidelity |");
  });

  it("derives mechanical headroom output from fixture fidelity assertions", () => {
    expect(buildHeadroomOutput({
      assertions: [
        { question: "newest hash", path: "commits.0.short", expected: "abc1234" },
        { question: "commit count", path: "commits.length", expected: 2 },
      ],
    })).toBe("commits.0.short=\"abc1234\"\ncommits.length=2\n");

    expect(buildHeadroomOutput({
      assertions: [],
    })).toBe("");
  });
});

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
