// connector-shopware
//
// On-demand read + write against a tenant's Shopware 6 Admin API.
// Read paths are used by the classification agent to enrich incoming
// complaints (find the order, identify the customer). The write path
// (create-return) is invoked from an approved orchestrator action.
//
// Body: { organization_id, action, ...params }
//
//   action = "fetch-order"        params: { order_number }
//   action = "fetch-customer"     params: { email }
//   action = "create-return"      params: { order_id, reason?, internal_comment? }

import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import {
  type ShopwareConfig,
  fetchOrderByNumber,
  fetchCustomerByEmail,
  createReturn,
} from "../_shared/shopware.ts";

const PROVIDER_ID = "shopware";

async function getConfig(orgId: string): Promise<ShopwareConfig> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("organization_integrations")
    .select("credentials")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .eq("status", "active")
    .maybeSingle<{ credentials: Partial<ShopwareConfig> }>();
  if (error) throw error;
  const c = data?.credentials;
  if (!c?.base_url || !c.client_id || !c.client_secret) {
    throw new Error("shopware integration not configured for this org");
  }
  return c as ShopwareConfig;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: {
    organization_id?: string;
    action?:          string;
    order_number?:    string;
    email?:           string;
    order_id?:        string;
    reason?:          string;
    internal_comment?: string;
  };
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON", 400); }

  if (!body.organization_id || !body.action) {
    return errorResponse("organization_id and action required", 400);
  }

  try {
    const cfg = await getConfig(body.organization_id);

    switch (body.action) {
      case "fetch-order": {
        if (!body.order_number) return errorResponse("order_number required", 400);
        const order = await fetchOrderByNumber(cfg, body.order_number);
        return jsonResponse({ order });
      }
      case "fetch-customer": {
        if (!body.email) return errorResponse("email required", 400);
        const customer = await fetchCustomerByEmail(cfg, body.email);
        return jsonResponse({ customer });
      }
      case "create-return": {
        if (!body.order_id) return errorResponse("order_id required", 400);
        const result = await createReturn(cfg, {
          orderId:         body.order_id,
          reason:          body.reason,
          internalComment: body.internal_comment,
        });
        return jsonResponse({ return: result });
      }
      default:
        return errorResponse(`unknown action: ${body.action}`, 400);
    }
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 500);
  }
});
