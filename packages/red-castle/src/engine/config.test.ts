import { describe, expect, it } from "vitest";
import { createEnginePaths } from "./paths.js";
import { getCastleConfig, loadCastleConfig, readCastleBackpressure } from "./config.js";

describe("castle config reader", () => {
  it("reads .red/config.yaml directly from EnginePaths and folds frozen afk names", () => {
    const paths = createEnginePaths("/repo/.red");
    const values = loadCastleConfig(paths, {
      read: (path) => {
        expect(path).toBe("/repo/.red/config.yaml");
        return [
          "afk:",
          "  default_runner: claude",
          "  fleet:",
          "    target: 2",
          "plugins:",
          "  dev:",
          "    enabled: true",
          "    afk:",
          "      default_runner: codex",
          "      fleet:",
          "        target: 4",
          "      backpressure:",
          "        - pnpm test",
        ].join("\n");
      },
    });

    expect(getCastleConfig(values, "plugins.dev.enabled")).toBe("true");
    expect(getCastleConfig(values, "afk.default_runner")).toBe("codex");
    expect(getCastleConfig(values, "afk.fleet.target")).toBe("4");
    expect(readCastleBackpressure(values)).toEqual(["pnpm test"]);
  });

  it("honors the ADR 0067 activation gate without enabling absent plugins", () => {
    const missing = loadCastleConfig(createEnginePaths("/repo/.red"), { read: () => undefined });
    expect(getCastleConfig(missing, "plugins.dev.enabled")).toBe("");

    const disabled = loadCastleConfig(createEnginePaths("/repo/.red"), {
      read: () => "plugins:\n  dev:\n    afk:\n      default_runner: codex\n",
    });
    expect(getCastleConfig(disabled, "plugins.dev.enabled")).toBe("");
    expect(getCastleConfig(disabled, "afk.default_runner")).toBe("codex");

    const enabled = loadCastleConfig(createEnginePaths("/repo/.red"), {
      read: () => "plugins:\n  dev:\n    enabled: true\n",
    });
    expect(getCastleConfig(enabled, "plugins.dev.enabled")).toBe("true");
  });

  it("keeps compatibility afk.* as fallback and warns once on malformed YAML", () => {
    const warnings: string[] = [];
    const fallback = loadCastleConfig(createEnginePaths("/repo/.red"), {
      read: () => "afk:\n  default_runner: codex\n",
    });
    expect(getCastleConfig(fallback, "afk.default_runner")).toBe("codex");

    const malformed = loadCastleConfig(createEnginePaths("/repo/.red"), {
      read: () => "afk:\n   default_runner: codex\n",
      warn: (message) => warnings.push(message),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("config.yaml");
    expect(getCastleConfig(malformed, "afk.default_runner")).toBe("claude");
  });
});
