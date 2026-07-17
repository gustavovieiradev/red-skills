import { encode as encodeToon, type JsonValue as ToonValue } from "@reddb-io/toon";
import type { PrecheckFacts } from "./boot.js";

export type OperationalProbeStatus = "green" | "red";
export type OperationalProbeFixGate = "safe" | "confirm";

export interface OperationalProbeContext {
  precheck: PrecheckFacts;
}

export interface OperationalProbeFinding {
  probe: string;
  name: string;
  status: "red";
  evidence: string;
  canonicalFix: string;
  fixGate: OperationalProbeFixGate;
}

export interface OperationalProbeRow {
  probe: string;
  name: string;
  status: OperationalProbeStatus;
  evidence: string;
  canonicalFix: string;
  fixGate: OperationalProbeFixGate;
}

export interface OperationalProbeReport {
  schema_version: "red.dev.operational_probes.v1";
  status: OperationalProbeStatus;
  probes: OperationalProbeRow[];
}

export interface OperationalProbeFixIo {
  remoteUrls(): Promise<Array<{ name: string; url: string }>>;
  setRemoteUrl(name: string, url: string): Promise<void>;
}

export interface OperationalProbeFixReceipt {
  probe: string;
  name: string;
  status: "applied" | "refused" | "skipped";
  changed: boolean;
  detail: string;
}

export interface OperationalProbe {
  id: string;
  name: string;
  canonicalFix: string;
  fixGate: OperationalProbeFixGate;
  run(ctx: OperationalProbeContext): Promise<OperationalProbeFinding | null> | OperationalProbeFinding | null;
  fix?(io: OperationalProbeFixIo): Promise<OperationalProbeFixReceipt>;
}

const HTTPS_GITHUB_REMOTE_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/;
const HTTPS_GIT_REMOTE_PROBE_ID = "https-git-remote";
const HTTPS_GIT_REMOTE_PROBE_NAME = "Git remotes must use SSH for AFK";
const HTTPS_GIT_REMOTE_FIX = "Set each GitHub HTTPS remote to its SSH URL, for example `git remote set-url origin git@github.com:OWNER/REPO.git`.";

export function httpsGithubRemoteToSsh(url: string): string | null {
  const match = HTTPS_GITHUB_REMOTE_RE.exec(url);
  if (!match) return null;
  return `git@github.com:${match[1]}/${match[2]}.git`;
}

const httpsGitRemoteProbe: OperationalProbe = {
  id: HTTPS_GIT_REMOTE_PROBE_ID,
  name: HTTPS_GIT_REMOTE_PROBE_NAME,
  canonicalFix: HTTPS_GIT_REMOTE_FIX,
  fixGate: "confirm",
  run(ctx) {
    const offending = ctx.precheck.remoteUrls.filter((url) => url.startsWith("https://"));
    if (offending.length === 0 || ctx.precheck.allowHttpsRemote) return null;
    return {
      probe: HTTPS_GIT_REMOTE_PROBE_ID,
      name: HTTPS_GIT_REMOTE_PROBE_NAME,
      status: "red",
      evidence: `https remotes: ${offending.join(", ")}`,
      canonicalFix: HTTPS_GIT_REMOTE_FIX,
      fixGate: "confirm",
    };
  },
  async fix(io) {
    const remotes = await io.remoteUrls();
    let changed = 0;
    for (const remote of remotes) {
      const ssh = httpsGithubRemoteToSsh(remote.url);
      if (ssh === null || ssh === remote.url) continue;
      await io.setRemoteUrl(remote.name, ssh);
      changed += 1;
    }
    return {
      probe: HTTPS_GIT_REMOTE_PROBE_ID,
      name: HTTPS_GIT_REMOTE_PROBE_NAME,
      status: "applied",
      changed: changed > 0,
      detail: changed > 0 ? `rewrote ${changed} remote(s) to SSH` : "no GitHub HTTPS remotes found",
    };
  },
};

export const OPERATIONAL_PROBES: readonly OperationalProbe[] = [
  httpsGitRemoteProbe,
] as const;

export async function evaluateOperationalProbes(
  ctx: OperationalProbeContext,
  registry: readonly OperationalProbe[] = OPERATIONAL_PROBES,
): Promise<OperationalProbeReport> {
  const probes: OperationalProbeRow[] = [];
  for (const probe of registry) {
    const finding = await probe.run(ctx);
    if (finding) {
      probes.push(finding);
    } else {
      probes.push({
        probe: probe.id,
        name: probe.name,
        status: "green",
        evidence: "ok",
        canonicalFix: probe.canonicalFix,
        fixGate: probe.fixGate,
      });
    }
  }
  return {
    schema_version: "red.dev.operational_probes.v1",
    status: probes.some((probe) => probe.status === "red") ? "red" : "green",
    probes,
  };
}

export class OperationalProbeHaltError extends Error {
  constructor(readonly report: OperationalProbeReport) {
    const reds = report.probes.filter((probe) => probe.status === "red");
    const first = reds[0];
    super(
      first
        ? `Operational probe red: ${first.name}. Canonical fix: ${first.canonicalFix}`
        : "Operational probe halted with no red finding",
    );
    this.name = "OperationalProbeHaltError";
  }
}

export function assertOperationalProbesGreen(report: OperationalProbeReport): void {
  if (report.status === "red") throw new OperationalProbeHaltError(report);
}

export function renderOperationalProbeReportToon(report: OperationalProbeReport): string {
  return encodeToon(report as unknown as ToonValue);
}

export async function applyOperationalProbeFixes(
  report: OperationalProbeReport,
  io: OperationalProbeFixIo,
  confirm: (finding: OperationalProbeRow) => Promise<boolean> | boolean,
  registry: readonly OperationalProbe[] = OPERATIONAL_PROBES,
): Promise<OperationalProbeFixReceipt[]> {
  const byId = new Map(registry.map((probe) => [probe.id, probe]));
  const receipts: OperationalProbeFixReceipt[] = [];
  for (const finding of report.probes) {
    if (finding.status !== "red") continue;
    const probe = byId.get(finding.probe);
    if (!probe?.fix) {
      receipts.push({
        probe: finding.probe,
        name: finding.name,
        status: "skipped",
        changed: false,
        detail: "no canonical fixer registered",
      });
      continue;
    }
    if (finding.fixGate === "confirm" && !(await confirm(finding))) {
      receipts.push({
        probe: finding.probe,
        name: finding.name,
        status: "refused",
        changed: false,
        detail: "confirmation declined",
      });
      continue;
    }
    receipts.push(await probe.fix(io));
  }
  return receipts;
}
