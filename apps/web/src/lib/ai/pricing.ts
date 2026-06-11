// Static price table for AI usage cost estimates (spec-cockpit.md §16/§19:
// static table is the v1 decision; exact provider billing data is a later
// pricing-refresh concern). Prices in US cents per 1M tokens.
//
// Keys are matched by substring against the model string (gateway format
// "provider/model" or bare SDK model ids), so "anthropic/claude-sonnet-4-6"
// and "claude-sonnet-4-6" both resolve.

interface ModelPrice {
  /** cents per 1M input tokens */
  inPer1M: number;
  /** cents per 1M output tokens */
  outPer1M: number;
}

const PRICE_TABLE: Record<string, ModelPrice> = {
  "claude-sonnet-4-6":      { inPer1M: 300,  outPer1M: 1500 },
  "claude-haiku-4-5":       { inPer1M: 100,  outPer1M: 500 },
  "claude-3-5-haiku":       { inPer1M: 80,   outPer1M: 400 },
  "gpt-4o-mini":            { inPer1M: 15,   outPer1M: 60 },
  "gpt-4o":                 { inPer1M: 250,  outPer1M: 1000 },
  "gemini-2.0-flash":       { inPer1M: 10,   outPer1M: 40 },
  "gemini-2.0-pro":         { inPer1M: 125,  outPer1M: 500 },
  "deepseek-chat":          { inPer1M: 27,   outPer1M: 110 },
  "deepseek-reasoner":      { inPer1M: 55,   outPer1M: 219 },
  "mistral-large":          { inPer1M: 200,  outPer1M: 600 },
  "text-embedding-3-small": { inPer1M: 2,    outPer1M: 0 },
  "text-embedding-3-large": { inPer1M: 13,   outPer1M: 0 },
};

/**
 * Cost estimate in cents for a model interaction. Returns null for unknown
 * models — dashboards show tokens without cost rather than a wrong number.
 * gpt-4o is matched after gpt-4o-mini via key ordering below.
 */
export function estimateCostCents(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number | null {
  const normalized = model.toLowerCase();
  // longest key first so "gpt-4o-mini" wins over "gpt-4o"
  const keys = Object.keys(PRICE_TABLE).sort((a, b) => b.length - a.length);
  const key = keys.find((k) => normalized.includes(k));
  if (!key) return null;
  const price = PRICE_TABLE[key];
  const cents =
    (tokensIn / 1_000_000) * price.inPer1M +
    (tokensOut / 1_000_000) * price.outPer1M;
  return Math.round(cents * 10_000) / 10_000;
}
