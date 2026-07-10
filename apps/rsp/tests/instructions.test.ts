import { describe, expect, it } from "vitest";
import { RSP_WRAPPER_CAPABILITIES } from "../src/capability-table.js";
import { renderRspInstructions } from "../src/instructions.js";

describe("rsp instruction renderer", () => {
  it("renders call forms, loss levels, and retrieval for every shipped wrapper", () => {
    const out = renderRspInstructions({ runner: "codex" });

    for (const capability of RSP_WRAPPER_CAPABILITIES) {
      expect(out).toContain(capability.title);
      expect(out).toContain(`Call form: \`${capability.callForm}\``);
      for (const level of capability.lossLevels) expect(out).toContain(level);
      expect(out).toContain(capability.retrieval);
    }
    expect(out).toContain("rsp show el:<id>");
  });

  it("is generated from the passed capability table without generator edits", () => {
    const out = renderRspInstructions({
      runner: "codex",
      capabilities: [
        {
          id: "demo",
          title: "Demo wrapper",
          callForm: "rsp demo <thing>",
          preferWhen: "Prefer for demo fixture output.",
          lossLevels: ["--demo-loss proves the fixture changed the rendered content"],
          retrieval: "Use `rsp show el:<id>` for demo bytes.",
        },
      ],
    });

    expect(out).toContain("Demo wrapper");
    expect(out).toContain("rsp demo <thing>");
    expect(out).toContain("--demo-loss proves the fixture changed the rendered content");
    expect(out).not.toContain("Git porcelain");
  });

  it("keeps Codex free of interception claims while Claude marks interception present", () => {
    const codex = renderRspInstructions({ runner: "codex" });
    const claude = renderRspInstructions({ runner: "claude" });

    expect(codex.toLowerCase()).not.toContain("intercept");
    expect(claude.toLowerCase()).toContain("interception");
    expect(claude).toContain("direct calls are still preferred");
  });
});

