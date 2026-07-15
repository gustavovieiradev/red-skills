import {
  appendSummaryField,
  decode,
  encode,
  projectFields,
  type JsonObject,
  type JsonValue,
} from "@reddb-io/toon";

type JsonRecord = Record<string, JsonValue>;

function toJsonValue(value: unknown): JsonValue {
  if (value == null) return null;
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return Number.isNaN(value) ? null : value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => toJsonValue(child));
  }
  if (typeof value === "object") {
    const out: JsonRecord = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined && typeof child !== "function" && typeof child !== "symbol") {
        out[key] = toJsonValue(child);
      }
    }
    return out;
  }
  return String(value);
}

export interface ToonOutputOptions<Row extends JsonRecord> {
  rowsKey: string;
  rows: readonly Row[];
  fields: readonly (keyof Row & string)[];
  summary: JsonValue;
  extra?: JsonRecord;
  compact?: boolean;
}

/**
 * Shared AXI/TOON renderer for agent-facing structured CLI output.
 *
 * Callers choose the row key, fields, and summary. The helper only enforces
 * the common TOON shape: projected tabular rows plus a trailing summary field.
 */
export function renderToonOutput<Row extends JsonRecord>({
  rowsKey,
  rows,
  fields,
  summary,
  extra = {},
  compact = false,
}: ToonOutputOptions<Row>): string {
  const projected = projectFields(rows, fields);
  if (compact) {
    const reductions: string[] = [];
    const reducedValue = reduceJsonValue(
      {
        [rowsKey]: projected as JsonValue,
        ...extra,
      } as JsonObject,
      "",
      reductions,
    ) as JsonObject;
    const reducedSummary = reduceJsonValue(summary, "summary", reductions);
    return appendSummaryField(
      {
        ...reducedValue,
        reduction: {
          mode: "compact",
          reduced: reductions.length > 0 ? reductions.slice(0, 20) : ["none"],
          recovery: "rerun without --compact",
        },
      },
      reducedSummary,
    );
  }
  const value = {
    [rowsKey]: projected,
    ...extra,
  } as JsonObject;
  return appendSummaryField(value, summary);
}

export function renderToonDocument(value: unknown): string {
  const output = encode(toJsonValue(value));
  decode(output);
  return output;
}

function reduceJsonValue(value: JsonValue, path: string, reductions: string[]): JsonValue {
  if (typeof value === "string") {
    const reduced = value.replace(/\s+/g, " ").trim();
    if (reduced !== value) reductions.push(`${path || "$"}: whitespace collapsed`);
    return reduced;
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => reduceJsonValue(child, `${path}[${index}]`, reductions));
  }
  if (value && typeof value === "object") {
    const out: JsonRecord = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = reduceJsonValue(child, path ? `${path}.${key}` : key, reductions);
    }
    return out;
  }
  return value;
}
