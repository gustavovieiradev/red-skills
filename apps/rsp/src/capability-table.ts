export type RspWrapperId = "git" | "gh" | "vitest" | "cargo-test" | (string & {});

export interface RspWrapperCapability {
  id: RspWrapperId;
  title: string;
  callForm: string;
  preferWhen: string;
  lossLevels: readonly string[];
  retrieval: string;
}

export const RSP_WRAPPER_CAPABILITIES: readonly RspWrapperCapability[] = [
  {
    id: "git",
    title: "Git porcelain",
    callForm: "rsp git <status|log|diff|commit|push> [git args...]",
    preferWhen: "Prefer over raw git for status, log, diff, commit, and push output that an agent needs to read or summarize.",
    lossLevels: [
      "default lossless renders stable TOON for supported successful commands",
      "--brief is accepted as the low-loss default lane for wrappers that need a shorter field projection",
      "--terse keeps the useful summary rows and stores the full rendered output behind an elision handle",
    ],
    retrieval: "If output contains `rsp show el:<id>`, run that exact command to recover the original rendered bytes.",
  },
  {
    id: "gh",
    title: "GitHub CLI projection",
    callForm: "rsp gh <pr|issue|run> <list|view> [--wide] [--full] [gh args...]",
    preferWhen: "Prefer over raw gh for PR, issue, and workflow-run list/view reads; use --wide for extra metadata and --full when bodies or logs must be complete.",
    lossLevels: [
      "default lossless emits the canonical field set and may attach handles for long text fields",
      "--brief keeps the same command shape while allowing compact long-field projections",
      "--terse summarizes row-heavy results and stores the full rendered output behind an elision handle",
    ],
    retrieval: "Use `rsp show el:<id>` for any truncated body, log, or terse projection before making a claim that depends on omitted bytes.",
  },
  {
    id: "vitest",
    title: "Vitest reporter",
    callForm: "rsp vitest [vitest args...]",
    preferWhen: "Prefer over raw vitest when running JavaScript or TypeScript tests so passing noise is collapsed and failures stay visible.",
    lossLevels: [
      "default lossless reports the run summary and failing assertions",
      "--brief is the intended compact failure lane when only excerpts are needed",
      "--terse is accepted for consistency with other rsp wrappers",
    ],
    retrieval: "When a failure excerpt ends with `rsp show el:<id>`, retrieve it before editing code that depends on the omitted stack or assertion body.",
  },
  {
    id: "cargo-test",
    title: "Cargo test reporter",
    callForm: "rsp cargo test [cargo test args...]",
    preferWhen: "Prefer over raw cargo test for Rust test runs and compiler-message-heavy failures.",
    lossLevels: [
      "default lossless reports the run summary and failing tests or compiler errors",
      "--brief stores over-limit failure excerpts behind elision handles",
      "--terse is accepted for consistency with other rsp wrappers",
    ],
    retrieval: "Run `rsp show el:<id>` before acting on any elided compiler output, panic text, or long assertion.",
  },
] as const;

