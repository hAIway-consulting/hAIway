// Shopware 6 Admin API client.
//
// Authenticates via integration client_id/client_secret -> short-lived bearer.
// Token is cached in-memory per process; on 401 we refresh once and retry.

export interface ShopwareConfig {
  base_url:       string;
  client_id:      string;
  client_secret:  string;
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
  const body = await res.json() as { access_token: string; expires_in: number };
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
  cfg:    ShopwareConfig,
  path:   string,
  init?:  RequestInit,
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
  return await res.json() as T;
}

export interface ShopwareOrder {
  id:           string;
  orderNumber:  string;
  orderDateTime?: string;
  amountTotal?: number;
  currencyId?:  string;
  orderCustomer?: {
    email?:      string;
    firstName?:  string;
    lastName?:   string;
    customerId?: string;
  };
  lineItems?: Array<Record<string, unknown>>;
}

export async function fetchOrderByNumber(
  cfg: ShopwareConfig,
  orderNumber: string,
): Promise<ShopwareOrder | null> {
  const result = await call<{ data: ShopwareOrder[] }>(cfg, "/api/search/order", {
    method: "POST",
    body:   JSON.stringify({
      filter: [{ type: "equals", field: "orderNumber", value: orderNumber }],
      associations: { lineItems: {}, orderCustomer: {} },
      limit:  1,
    }),
  });
  return result.data?.[0] ?? null;
}

export interface ShopwareCustomer {
  id:         string;
  email:      string;
  firstName?: string;
  lastName?:  string;
}

export async function fetchCustomerByEmail(
  cfg: ShopwareConfig,
  email: string,
): Promise<ShopwareCustomer | null> {
  const result = await call<{ data: ShopwareCustomer[] }>(cfg, "/api/search/customer", {
    method: "POST",
    body:   JSON.stringify({
      filter: [{ type: "equals", field: "email", value: email }],
      limit:  1,
    }),
  });
  return result.data?.[0] ?? null;
}

// Returns are part of Shopware's standard order_return entity in 6.6+.
// We create the return record only; line-item attachment is left to the
// approval step so a human can review the suggested items first.
export interface CreateReturnInput {
  orderId: string;
  reason?: string;
  internalComment?: string;
}

export async function createReturn(
  cfg: ShopwareConfig,
  input: CreateReturnInput,
): Promise<{ id: string }> {
  const result = await call<{ id: string }>(cfg, "/api/order-return", {
    method: "POST",
    body:   JSON.stringify({
      orderId:         input.orderId,
      reason:          input.reason ?? "Kundenreklamation",
      internalComment: input.internalComment ?? null,
    }),
  });
  return result;
}
