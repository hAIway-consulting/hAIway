// Trello REST API client — app-layer port of supabase/functions/_shared/trello.ts.
// Write-focused: the orchestrator creates a card on the tenant's configured
// list so a complaint lands on the human's working board with full context.

export interface TrelloConfig {
  api_key:          string;
  token:            string;
  board_id:         string;
  default_list_id?: string;
}

const BASE = "https://api.trello.com/1";

function authParams(cfg: TrelloConfig): string {
  return `key=${encodeURIComponent(cfg.api_key)}&token=${encodeURIComponent(cfg.token)}`;
}

async function call<T>(cfg: TrelloConfig, path: string, init?: RequestInit): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}${authParams(cfg)}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Accept": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`trello ${path} -> ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export interface TrelloCard {
  id:       string;
  shortUrl: string;
  url:      string;
  name:     string;
  idList:   string;
}

export interface CreateCardInput {
  name:      string;
  desc?:     string;
  listId?:   string;
  position?: "top" | "bottom" | number;
}

export async function createCard(
  cfg:   TrelloConfig,
  input: CreateCardInput,
): Promise<TrelloCard> {
  const listId = input.listId ?? cfg.default_list_id;
  if (!listId) {
    throw new Error("trello.createCard: no list_id (set default_list_id in config or pass listId)");
  }
  const params = new URLSearchParams({
    name:   input.name,
    desc:   input.desc ?? "",
    idList: listId,
    pos:    input.position?.toString() ?? "top",
  });
  return await call<TrelloCard>(cfg, `/cards?${params.toString()}`, { method: "POST" });
}
