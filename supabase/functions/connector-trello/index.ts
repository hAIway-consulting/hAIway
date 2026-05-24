// connector-trello
//
// Writes to a tenant-configured Trello board. The orchestrator calls this
// from inside an approved action so a card lands in the human's working
// surface with the full case context already filled in.
//
// Body: { organization_id, action, ...params }
//
//   action = "create-card"   params: { name, desc?, list_id?, label_ids?, due? }
//   action = "update-card"   params: { card_id, name?, desc?, list_id?, closed? }
//   action = "add-comment"   params: { card_id, text }

import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import {
  type TrelloConfig,
  createCard,
  updateCard,
  addComment,
} from "../_shared/trello.ts";

const PROVIDER_ID = "trello";

async function getConfig(orgId: string): Promise<TrelloConfig> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("organization_integrations")
    .select("credentials")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .eq("status", "active")
    .maybeSingle<{ credentials: Partial<TrelloConfig> }>();
  if (error) throw error;
  const c = data?.credentials;
  if (!c?.api_key || !c.token || !c.board_id) {
    throw new Error("trello integration not configured for this org");
  }
  return c as TrelloConfig;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: {
    organization_id?: string;
    action?:          string;
    // create-card
    name?:            string;
    desc?:            string;
    list_id?:         string;
    label_ids?:       string[];
    due?:             string;
    // update-card
    card_id?:         string;
    closed?:          boolean;
    // add-comment
    text?:            string;
  };
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON", 400); }

  if (!body.organization_id || !body.action) {
    return errorResponse("organization_id and action required", 400);
  }

  try {
    const cfg = await getConfig(body.organization_id);

    switch (body.action) {
      case "create-card": {
        if (!body.name) return errorResponse("name required", 400);
        const card = await createCard(cfg, {
          name:     body.name,
          desc:     body.desc,
          listId:   body.list_id,
          labelIds: body.label_ids,
          due:      body.due,
        });
        return jsonResponse({ card });
      }
      case "update-card": {
        if (!body.card_id) return errorResponse("card_id required", 400);
        const card = await updateCard(cfg, {
          cardId: body.card_id,
          name:   body.name,
          desc:   body.desc,
          listId: body.list_id,
          closed: body.closed,
        });
        return jsonResponse({ card });
      }
      case "add-comment": {
        if (!body.card_id || !body.text) return errorResponse("card_id and text required", 400);
        const comment = await addComment(cfg, body.card_id, body.text);
        return jsonResponse({ comment });
      }
      default:
        return errorResponse(`unknown action: ${body.action}`, 400);
    }
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 500);
  }
});
