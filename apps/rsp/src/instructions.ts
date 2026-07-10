import { RSP_WRAPPER_CAPABILITIES, type RspWrapperCapability } from "./capability-table.js";

export type RspInstructionRunner = "codex" | "claude";

export interface RspInstructionOptions {
  runner: RspInstructionRunner;
  capabilities?: readonly RspWrapperCapability[];
}

export function renderRspInstructions(options: RspInstructionOptions): string {
  const capabilities = options.capabilities ?? RSP_WRAPPER_CAPABILITIES;
  const lines: string[] = [];
  lines.push("# rsp wrapper guidance");
  lines.push("");
  if (options.runner === "claude") {
    lines.push(
      "Claude Code has pre-execution interception for these wrappers when the RedSkills hook is active; deliberate direct calls are still preferred because they make the loss policy explicit.",
    );
  } else {
    lines.push("Use these wrappers directly when the task touches supported command output; this is the Codex lane for rsp guidance.");
  }
  lines.push("Every elision handle is reversible: run `rsp show el:<id>` to recover the stored bytes.");
  lines.push("");

  for (const item of capabilities) {
    lines.push(`## ${item.title}`);
    lines.push(`Call form: \`${item.callForm}\``);
    lines.push(`Prefer when: ${item.preferWhen}`);
    lines.push("Loss levels:");
    for (const level of item.lossLevels) lines.push(`- ${level}`);
    lines.push(`Retrieval: ${item.retrieval}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

