import { readFileSync } from "node:fs";
import type { EnginePaths } from "./paths.js";

export type CastleConfigValues = Record<string, string>;
export type CastleConfigReader = (path: string) => string | undefined;
export type CastleConfigWarn = (message: string) => void;

export interface LoadCastleConfigOptions {
  readonly read?: CastleConfigReader;
  readonly warn?: CastleConfigWarn;
}

export class CastleMalformedConfigError extends Error {
  constructor(message = "malformed YAML") {
    super(message);
    this.name = "CastleMalformedConfigError";
  }
}

export const CASTLE_CONFIG_DEFAULTS = {
  "afk.default_runner": "claude",
  "afk.fleet.target": "2",
} as const;

function defaultReader(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function defaultWarn(message: string): void {
  process.stderr.write(`${message}\n`);
}

function defaults(): CastleConfigValues {
  return { ...CASTLE_CONFIG_DEFAULTS };
}

export function parseCastleConfigYaml(text: string): CastleConfigValues {
  const out: CastleConfigValues = {};
  const stack: string[] = [];
  const indents: number[] = [];
  const seqCounters: Record<string, number> = {};

  for (let raw of text.split("\n")) {
    raw = raw.replace(/\r$/, "");

    let stripped = raw;
    if (!/".*"/.test(stripped) && !/'.*'/.test(stripped)) {
      const hash = stripped.indexOf("#");
      if (hash >= 0) stripped = stripped.slice(0, hash);
    }

    if (stripped.replace(/\s/g, "") === "") continue;

    const indentStr = stripped.match(/^\s*/)?.[0] ?? "";
    const indent = indentStr.length;
    if (indent % 2 !== 0) throw new CastleMalformedConfigError();

    let rest = stripped.slice(indent).replace(/\s+$/, "");

    if (/^-(\s|$)/.test(rest)) {
      while (indents.length > 0 && indents[indents.length - 1]! >= indent) {
        stack.pop();
        indents.pop();
      }
      if (stack.length === 0) throw new CastleMalformedConfigError();

      let item = rest.slice(1).replace(/^\s+/, "");
      if (item === "") throw new CastleMalformedConfigError();
      item = stripQuotedComment(item);
      item = stripMatchingQuotes(item);

      const parent = stack.join(".");
      const idx = seqCounters[parent] ?? 0;
      seqCounters[parent] = idx + 1;
      out[`${parent}.${idx}`] = item;
      continue;
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*:/.test(rest)) {
      throw new CastleMalformedConfigError();
    }

    const colon = rest.indexOf(":");
    const key = rest.slice(0, colon);
    let value = rest.slice(colon + 1).replace(/^\s+/, "");

    value = stripQuotedComment(value);
    value = stripMatchingQuotes(value);

    while (indents.length > 0 && indents[indents.length - 1]! >= indent) {
      stack.pop();
      indents.pop();
    }

    const full = stack.length > 0 ? `${stack.join(".")}.${key}` : key;
    if (value === "") {
      stack.push(key);
      indents.push(indent);
    } else {
      out[full] = value;
    }
  }

  return out;
}

function stripQuotedComment(value: string): string {
  if (value[0] !== '"' && value[0] !== "'") return value;
  const quote = value[0];
  const close = value.indexOf(quote, 1);
  if (close <= 0) return value;
  const tail = value.slice(close + 1).trimStart();
  if (tail === "" || tail.startsWith("#")) return value.slice(0, close + 1);
  return value;
}

function stripMatchingQuotes(value: string): string {
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) {
      throw new CastleMalformedConfigError();
    }
    return value.slice(1, -1);
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new CastleMalformedConfigError();
    }
    return value.slice(1, -1);
  }
  return value;
}

export function loadCastleConfig(
  paths: Pick<EnginePaths, "config">,
  options: LoadCastleConfigOptions = {},
): CastleConfigValues {
  const read = options.read ?? defaultReader;
  const warn = options.warn ?? defaultWarn;
  const text = read(paths.config);
  if (text === undefined) return defaults();

  let parsed: CastleConfigValues;
  try {
    parsed = parseCastleConfigYaml(text);
  } catch {
    warn(`[castle:config] warn: malformed YAML in ${paths.config} - using defaults`);
    return defaults();
  }

  const values = defaults();
  for (const [key, value] of Object.entries(parsed)) {
    values[key] = value;
  }
  for (const [key, value] of Object.entries(parsed)) {
    const match = /^plugins\.dev\.(.+)$/.exec(key);
    if (!match) continue;
    const rest = match[1]!;
    values[rest === "afk" || rest.startsWith("afk.") ? rest : `plugins.dev.${rest}`] =
      value;
  }

  return values;
}

export function getCastleConfig(values: CastleConfigValues, key: string): string {
  return values[key] ?? "";
}

export function readCastleBackpressure(values: CastleConfigValues): string[] {
  const scalar = getCastleConfig(values, "afk.backpressure");
  if (scalar !== "") return [scalar];

  const commands: string[] = [];
  for (let i = 0; ; i += 1) {
    const command = getCastleConfig(values, `afk.backpressure.${i}`);
    if (command === "") break;
    commands.push(command);
  }
  return commands;
}
