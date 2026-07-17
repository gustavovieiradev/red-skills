export const TOKEN_ESTIMATE_RANGE_PCT = 0.25;

export interface TokenSavingsEstimate {
  tokens_saved: number;
  tokens_saved_estimated: boolean;
  token_estimate_range_pct: number | null;
  tokens_saved_low: number | null;
  tokens_saved_high: number | null;
  dollars_saved_estimate_usd: number;
  dollars_saved_low_usd: number | null;
  dollars_saved_high_usd: number | null;
  pricing_model_family: string;
  pricing_input_usd_per_million_tokens: number;
  pricing_row_label: string;
  pricing_note: string;
  token_count_source: "tokenizer" | "byte-estimate" | "mixed";
}

export const DEFAULT_RSP_PRICING_MODEL_FAMILY = "claude-sonnet-5-intro";

export interface RspPricingRow {
  input_usd_per_million_tokens: number;
  label: string;
}

export const RSP_INPUT_TOKEN_PRICING_ROWS: Record<string, RspPricingRow> = {
  "claude-sonnet-5-intro": {
    input_usd_per_million_tokens: 2,
    label: "Claude Sonnet 5 input, intro pricing through 2026-08-31",
  },
  "claude-sonnet-5": {
    input_usd_per_million_tokens: 3,
    label: "Claude Sonnet 5 input",
  },
  "claude-opus-4.1": {
    input_usd_per_million_tokens: 15,
    label: "Claude Opus 4.1 input",
  },
  "claude-opus-4": {
    input_usd_per_million_tokens: 15,
    label: "Claude Opus 4 input",
  },
  "claude-sonnet-4": {
    input_usd_per_million_tokens: 3,
    label: "Claude Sonnet 4 input",
  },
  "claude-haiku-3.5": {
    input_usd_per_million_tokens: 0.8,
    label: "Claude Haiku 3.5 input",
  },
  "claude-haiku-3": {
    input_usd_per_million_tokens: 0.25,
    label: "Claude Haiku 3 input",
  },
};

export const RSP_INPUT_TOKEN_PRICE_USD_PER_MILLION: Record<string, number> = Object.fromEntries(
  Object.entries(RSP_INPUT_TOKEN_PRICING_ROWS).map(([key, row]) => [key, row.input_usd_per_million_tokens]),
);

const PRICING_NOTE = "Anthropic input-token pricing row; token figures are labeled as tokenizer-derived or byte-estimated";

export function tokenSavingsEstimate(
  tokensSaved: number,
  estimated: boolean,
  modelFamily = DEFAULT_RSP_PRICING_MODEL_FAMILY,
): TokenSavingsEstimate {
  const tokens = Math.max(0, Math.floor(tokensSaved));
  const normalizedModel = modelFamily in RSP_INPUT_TOKEN_PRICE_USD_PER_MILLION
    ? modelFamily
    : DEFAULT_RSP_PRICING_MODEL_FAMILY;
  const row = RSP_INPUT_TOKEN_PRICING_ROWS[normalizedModel]!;
  const price = row.input_usd_per_million_tokens;
  const low = estimated ? Math.floor(tokens * (1 - TOKEN_ESTIMATE_RANGE_PCT)) : null;
  const high = estimated ? Math.ceil(tokens * (1 + TOKEN_ESTIMATE_RANGE_PCT)) : null;
  return {
    tokens_saved: tokens,
    tokens_saved_estimated: estimated,
    token_estimate_range_pct: estimated ? TOKEN_ESTIMATE_RANGE_PCT : null,
    tokens_saved_low: low,
    tokens_saved_high: high,
    dollars_saved_estimate_usd: dollarsForTokens(tokens, price),
    dollars_saved_low_usd: low == null ? null : dollarsForTokens(low, price),
    dollars_saved_high_usd: high == null ? null : dollarsForTokens(high, price),
    pricing_model_family: normalizedModel,
    pricing_input_usd_per_million_tokens: price,
    pricing_row_label: row.label,
    pricing_note: PRICING_NOTE,
    token_count_source: estimated ? "byte-estimate" : "tokenizer",
  };
}

export function dollarsForTokens(tokens: number, usdPerMillionTokens: number): number {
  return roundUsd((Math.max(0, tokens) / 1_000_000) * usdPerMillionTokens);
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
