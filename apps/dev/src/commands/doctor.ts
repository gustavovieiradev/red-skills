import { evaluateOperationalProbes, renderOperationalProbeReportToon, applyOperationalProbeFixes, type OperationalProbeFixIo } from "../core/operational-probes.js";
import { collectPrecheckFacts, resolveRepoContext } from "../runtime/wire.js";
import { execTool } from "../runtime/exec.js";

interface DoctorFlags {
  fix: boolean;
  yes: boolean;
  human: boolean;
  repo?: string;
}

function parseDoctorFlags(args: readonly string[]): DoctorFlags {
  const flags: DoctorFlags = { fix: false, yes: false, human: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--fix") flags.fix = true;
    else if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--human") flags.human = true;
    else if (arg === "--repo") flags.repo = args[++i];
    else if (arg.startsWith("--repo=")) flags.repo = arg.slice("--repo=".length);
  }
  return flags;
}

function renderHuman(report: Awaited<ReturnType<typeof evaluateOperationalProbes>>): string {
  const rows = report.probes.map((probe) => {
    const mark = probe.status === "green" ? "ok" : "red";
    return `${mark} ${probe.name}: ${probe.evidence}${probe.status === "red" ? `; fix: ${probe.canonicalFix}` : ""}`;
  });
  return [`operational probes: ${report.status}`, ...rows].join("\n") + "\n";
}

function gitRemoteIo(cwd: string): OperationalProbeFixIo {
  return {
    async remoteUrls() {
      const names = await execTool("git", ["remote"], { cwd });
      if (names.code !== 0) return [];
      const remotes = [];
      for (const name of names.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
        const url = await execTool("git", ["remote", "get-url", name], { cwd });
        if (url.code === 0 && url.stdout.trim()) remotes.push({ name, url: url.stdout.trim() });
      }
      return remotes;
    },
    async setRemoteUrl(name, url) {
      const result = await execTool("git", ["remote", "set-url", name, url], { cwd });
      if (result.code !== 0) throw new Error(result.stderr || `git remote set-url ${name} failed`);
    },
  };
}

export async function doctorCommand(args: string[], cwd = process.cwd()): Promise<number> {
  const flags = parseDoctorFlags(args);
  const root = flags.repo ?? cwd;
  const ctx = await resolveRepoContext(root);
  const precheck = await collectPrecheckFacts(ctx);
  const report = await evaluateOperationalProbes({ precheck });

  if (flags.fix) {
    const receipts = await applyOperationalProbeFixes(report, gitRemoteIo(root), () => flags.yes);
    if (flags.human) {
      process.stdout.write(renderHuman(report));
      for (const receipt of receipts) {
        process.stdout.write(`${receipt.status} ${receipt.name}: ${receipt.detail}\n`);
      }
    } else {
      process.stdout.write(renderOperationalProbeReportToon({
        ...report,
        probes: report.probes.map((probe) => {
          const receipt = receipts.find((r) => r.probe === probe.probe);
          return receipt ? { ...probe, evidence: `${probe.evidence}; fix_${receipt.status}: ${receipt.detail}` } : probe;
        }),
      }) + "\n");
    }
    return receipts.some((receipt) => receipt.status === "refused" || receipt.status === "skipped") ? 1 : 0;
  }

  process.stdout.write(flags.human ? renderHuman(report) : `${renderOperationalProbeReportToon(report)}\n`);
  return report.status === "red" ? 1 : 0;
}
