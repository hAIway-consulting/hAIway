// Trello REST API client — write-focused (Card create + update).
// Read is intentionally not implemented yet; first use-case is one-way
// orchestrator -> Trello as the human's working surface.

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
  return await res.json() as T;
}

export interface TrelloCard {
  id:       string;
  shortUrl: string;
  url:      string;
  name:     string;
  idList:   string;
}

export interface CreateCardInput {
  name:       string;
  desc?:      string;
  listId?:    string;
  labelIds?:  string[];
  due?:       string; // ISO
  position?:  "top" | "bottom" | number;
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
    name:    input.name,
    desc:    input.desc ?? "",
    idList:  listId,
    pos:     input.position?.toString() ?? "top",
  });
  if (input.labelIds?.length) params.set("idLabels", input.labelIds.join(","));
  if (input.due)              params.set("due", input.due);
  return await call<TrelloCard>(cfg, `/cards?${params.toString()}`, { method: "POST" });
}

export interface UpdateCardInput {
  cardId: string;
  name?:  string;
  desc?:  string;
  listId?: string;
  closed?: boolean;
}

export async function updateCard(
  cfg:   TrelloConfig,
  input: UpdateCardInput,
): Promise<TrelloCard> {
  const params = new URLSearchParams();
  if (input.name   !== undefined) params.set("name",   input.name);
  if (input.desc   !== undefined) params.set("desc",   input.desc);
  if (input.listId !== undefined) params.set("idList", input.listId);
  if (input.closed !== undefined) params.set("closed", String(input.closed));
  return await call<TrelloCard>(cfg, `/cards/${input.cardId}?${params.toString()}`, { method: "PUT" });
}

export async function addComment(
  cfg:    TrelloConfig,
  cardId: string,
  text:   string,
): Promise<{ id: string }> {
  const params = new URLSearchParams({ text });
  return await call<{ id: string }>(
    cfg,
    `/cards/${cardId}/actions/comments?${params.toString()}`,
    { method: "POST" },
  );
}
