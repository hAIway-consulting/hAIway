// Trello REST API client.
// Read + organise: the chat agent's Trello tools list the tenant's open cards
// and move stale ones into a category list. Nothing is ever deleted.

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

// ── Read + organise (used by the chat agent's Trello tools) ───────────────

export interface TrelloList {
  id:   string;
  name: string;
}

export interface TrelloBoardCard {
  id:               string;
  name:             string;
  idList:           string;
  dateLastActivity: string; // ISO — last time the card was touched
  shortUrl:         string;
}

/** Open lists of the tenant's configured board. */
export async function listOpenLists(cfg: TrelloConfig): Promise<TrelloList[]> {
  return await call<TrelloList[]>(
    cfg,
    `/boards/${cfg.board_id}/lists?fields=id,name&filter=open`,
  );
}

/** Open (non-archived) cards of the tenant's configured board, with activity. */
export async function listOpenCards(cfg: TrelloConfig): Promise<TrelloBoardCard[]> {
  return await call<TrelloBoardCard[]>(
    cfg,
    `/boards/${cfg.board_id}/cards?fields=id,name,idList,dateLastActivity,shortUrl&filter=open`,
  );
}

/** Create a new list on the board (e.g. a "stale cards" category). */
export async function createList(cfg: TrelloConfig, name: string): Promise<TrelloList> {
  const params = new URLSearchParams({ name, idBoard: cfg.board_id, pos: "bottom" });
  return await call<TrelloList>(cfg, `/lists?${params.toString()}`, { method: "POST" });
}

/** Move a card to another list (reversible — never deletes). */
export async function moveCard(
  cfg:    TrelloConfig,
  cardId: string,
  listId: string,
): Promise<TrelloCard> {
  const params = new URLSearchParams({ idList: listId });
  return await call<TrelloCard>(cfg, `/cards/${cardId}?${params.toString()}`, { method: "PUT" });
}
