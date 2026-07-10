import { describe, expect, it } from "vitest";
import { renderRspInstructionsHookOutput } from "../src/commands/rsp-instructions.js";

describe("rsp-instructions command", () => {
  it("renders Codex SessionStart output as a systemMessage with no interception claims", () => {
    const parsed = JSON.parse(renderRspInstructionsHookOutput("codex")) as { systemMessage: string };

    expect(parsed.systemMessage).toContain("rsp wrapper guidance");
    expect(parsed.systemMessage).toContain("rsp gh <pr|issue|run> <list|view>");
    expect(parsed.systemMessage.toLowerCase()).not.toContain("intercept");
  });

  it("renders Claude SessionStart output as hookSpecificOutput and marks interception present", () => {
    const parsed = JSON.parse(renderRspInstructionsHookOutput("claude")) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };

    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("pre-execution interception");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("rsp show el:<id>");
  });
});

