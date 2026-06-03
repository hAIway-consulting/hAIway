// Shopware 6 Admin API client — app-layer port of supabase/functions/_shared/shopware.ts.
//
// The edge-function version reads a single order/customer by key; the
// orchestrator needs to LIST the most recent product + customer to compose a
// demo complaint, so this adds fetchRecentProducts / fetchRecentCustomers.
//
// Auth: integration client_id/client_secret -> short-lived bearer, cached
// in-memory per warm server process; on 401 we refresh once and retry.

export interface ShopwareConfig {
  base_url:      string;
  client_id:     string;
  client_secret: string;
}

interface CachedToken {
  token:      string;
  expires_at: number;
}

const tokenCache = new Map<string, CachedToken>();

function cacheKey(cfg: ShopwareConfig): string {
  return `${cfg.base_url}::${cfg.client_id}`;
}

async function fetchToken(cfg: ShopwareConfig): Promise<CachedToken> {
  const res = await fetch(`${cfg.base_url}/api/oauth/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      grant_type:    "client_credentials",
      client_id:     cfg.client_id,
      client_secret: cfg.client_secret,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`shopware auth failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return {
    token:      body.access_token,
    // refresh 30 s before real expiry to avoid the race
    expires_at: Date.now() + (body.expires_in - 30) * 1000,
  };
}

async function getToken(cfg: ShopwareConfig): Promise<string> {
  const key    = cacheKey(cfg);
  const cached = tokenCache.get(key);
  if (cached && cached.expires_at > Date.now()) return cached.token;
  const fresh = await fetchToken(cfg);
  tokenCache.set(key, fresh);
  return fresh.token;
}

async function call<T>(
  cfg:   ShopwareConfig,
  path:  string,
  init?: RequestInit,
  retry = true,
): Promise<T> {
  const token = await getToken(cfg);
  const res = await fetch(`${cfg.base_url}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && retry) {
    tokenCache.delete(cacheKey(cfg));
    return await call<T>(cfg, path, init, false);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`shopware ${path} -> ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export interface ShopwareProduct {
  id:            string;
  productNumber: string;
  name:          string | null;
}

export interface ShopwareCustomer {
  id:             string;
  email:          string;
  firstName:      string | null;
  lastName:       string | null;
  customerNumber: string | null;
}

interface ProductRow {
  id:            string;
  productNumber: string;
  name?:         string | null;
  translated?:   { name?: string | null };
}

interface CustomerRow {
  id:             string;
  email:          string;
  firstName?:     string | null;
  lastName?:      string | null;
  customerNumber?: string | null;
}

/** Most recently created products, newest first. */
export async function fetchRecentProducts(
  cfg:   ShopwareConfig,
  limit = 1,
): Promise<ShopwareProduct[]> {
  const result = await call<{ data: ProductRow[] }>(cfg, "/api/search/product", {
    method: "POST",
    body:   JSON.stringify({
      limit,
      sort: [{ field: "createdAt", order: "DESC" }],
    }),
  });
  return (result.data ?? []).map((p) => ({
    id:            p.id,
    productNumber: p.productNumber,
    // Admin API may return the localized name on the entity or under translated.
    name:          p.name ?? p.translated?.name ?? null,
  }));
}

/** Most recently created customers, newest first. */
export async function fetchRecentCustomers(
  cfg:   ShopwareConfig,
  limit = 1,
): Promise<ShopwareCustomer[]> {
  const result = await call<{ data: CustomerRow[] }>(cfg, "/api/search/customer", {
    method: "POST",
    body:   JSON.stringify({
      limit,
      sort: [{ field: "createdAt", order: "DESC" }],
    }),
  });
  return (result.data ?? []).map((c) => ({
    id:             c.id,
    email:          c.email,
    firstName:      c.firstName ?? null,
    lastName:       c.lastName ?? null,
    customerNumber: c.customerNumber ?? null,
  }));
}
