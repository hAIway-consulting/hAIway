// Phone Assistant RAG — Real-time knowledge retrieval during calls
// Vapi Server URL mode: receives function-call webhooks, returns context
//
// Flow:
// 1. Vapi sends tool-call with caller question
// 2. We resolve the phone number → org_id + assistant config
// 3. Embed the question, run hybrid_search_boosted
// 4. Build context from top chunks, return to Vapi → caller hears answer

import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import { embedText } from "../_shared/embeddings.ts";
import { verifyVapiSignature } from "../_shared/vapi-verify.ts";
import {
  refreshAccessToken,
  listAvailableSlots,
  createCalendarEvent,
  type CalendarSettings,
} from "../_shared/google-calendar.ts";

// Debug webhooks are opt-in — off by default to avoid storing PII (caller name,
// phone, tokens) in _debug_webhooks. Enable per-env by setting DEBUG_WEBHOOKS=true.
const DEBUG_WEBHOOKS = Deno.env.get("DEBUG_WEBHOOKS") === "true";

// Vapi Server URL message types
type VapiMessage = {
  message: {
    type: string;
    // assistant-request
    call?: {
      phoneNumber?: { number?: string };
      customer?: { number?: string };
      assistantId?: string;
      assistant?: { id?: string };
    };
    // function-call
    functionCall?: {
      name: string;
      parameters: Record<string, string>;
    };
    // tool-calls
    toolCalls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    // top-level assistant reference
    assistant?: { id?: string };
  };
};

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-vapi-secret, x-vapi-signature",
      },
    });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const bodyText = await req.text();

  // Verify webhook signature
  const signature =
    req.headers.get("x-vapi-secret") ?? req.headers.get("x-vapi-signature");
  const valid = await verifyVapiSignature(bodyText, signature);
  if (!valid) {
    return errorResponse("Invalid signature", 401);
  }

  let payload: VapiMessage;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return errorResponse("Invalid JSON", 400);
  }

  const messageType = payload.message?.type;

  console.log(`[phone-rag] messageType=${messageType}, phone=${payload.message?.call?.phoneNumber?.number ?? "none"}, assistantId=${payload.message?.call?.assistantId ?? "none"}`);

  // Debug: store tool-calls and function-call payloads for inspection
  if (DEBUG_WEBHOOKS && (messageType === "tool-calls" || messageType === "function-call" || messageType === "assistant-request")) {
    const db = getServiceClient();
    await db.from("_debug_webhooks").insert({
      message_type: messageType,
      payload: payload.message,
    }).then(() => {}, (err: unknown) => console.error("[debug] insert failed:", err));
  }

  // ─── ASSISTANT REQUEST ────────────────────────────────────────────
  // Vapi calls this when a new call starts to get assistant config
  if (messageType === "assistant-request") {
    const assistant = await resolveAssistantConfig(payload.message);

    if (!assistant) {
      return jsonResponse({
        error: "No assistant configured for this number",
      }, 404);
    }

    // Check business hours
    if (assistant.business_hours_start && assistant.business_hours_end) {
      const isWithinHours = await checkBusinessHours(
        assistant.business_hours_start,
        assistant.business_hours_end,
        assistant.business_hours_tz ?? "Europe/Berlin",
      );
      if (!isWithinHours) {
        return jsonResponse({
          assistant: {
            firstMessage: assistant.after_hours_message,
            model: {
              provider: "anthropic",
              model: "claude-sonnet-4-6",
              messages: [
                {
                  role: "system",
                  content: "Inform the caller that the service is currently unavailable and end the call politely.",
                },
              ],
            },
            endCallAfterSilenceSeconds: 5,
          },
        });
      }
    }

    // Determine greeting based on language mode
    let greeting =
      assistant.language_mode === "en"
        ? assistant.greeting_en
        : assistant.greeting_de;

    // ─── CALLER CONTEXT WHISPER ─────────────────────────────────────
    // If we can identify the caller, personalize greeting + inject context
    const callerNumber = payload.message.call?.customer?.number ?? "";
    let callerBriefing = "";

    if (callerNumber) {
      const callerContext = await getCallerContextFromDB(assistant.org_id, callerNumber);
      if (callerContext) {
        // Personalize greeting with caller name
        const firstName = callerContext.contact_name?.split(" ")[0] ?? "";
        if (firstName) {
          greeting = assistant.language_mode === "en"
            ? `Hello ${firstName}! Nice to hear from you again. How can I help you today?`
            : `Hallo ${firstName}! Schoen, dass Sie wieder anrufen. Wie kann ich Ihnen heute helfen?`;
        }

        // Build context briefing for system prompt
        const parts: string[] = [];
        parts.push(`Der Anrufer ist: ${callerContext.contact_name}`);
        if (callerContext.company_name) parts.push(`Firma: ${callerContext.company_name}`);
        if (callerContext.contact_email) parts.push(`E-Mail: ${callerContext.contact_email}`);

        if (callerContext.recent_activities && callerContext.recent_activities.length > 0) {
          const actSummary = callerContext.recent_activities
            .map((a: { title: string; date: string; activity_type: string }) =>
              `${a.date}: ${a.title} (${a.activity_type})`)
            .join("; ");
          parts.push(`Letzte Interaktionen: ${actSummary}`);
        }

        if (callerContext.next_appointment) {
          parts.push(`Naechster Termin: ${callerContext.next_appointment.title} am ${callerContext.next_appointment.datetime}`);
        }

        callerBriefing = `\n\n--- ANRUFER-BRIEFING ---\n${parts.join("\n")}\n--- ENDE BRIEFING ---\nNutze dieses Wissen im Gespraech, aber gib nicht ungefragt alle Details preis. Begruesse den Anrufer persoenlich.`;

        // Record KPI event
        const db = getServiceClient();
        await db.rpc("record_kpi_event", {
          p_org_id: assistant.org_id,
          p_event_type: "caller_identified",
          p_feature_key: "phone_assistant",
          p_value: 1,
          p_metadata: JSON.stringify({ contact_name: callerContext.contact_name }),
        }).then(() => {}, (err: unknown) => console.error("[kpi] record failed:", err));
      }
    }

    // Check if calendar integration is active for this org
    const calendarConfig = await getCalendarConfig(assistant.org_id);

    // Build tools list (RAG + optional calendar) as server-side tools
    const toolDefs = buildAssistantTools(!!calendarConfig);
    const serverUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/phone-assistant-rag`;
    const serverTools = toolDefs.map((t) => ({
      ...t,
      server: { url: serverUrl },
    }));

    // Extend system prompt with caller briefing + calendar instructions
    let systemPrompt = assistant.system_prompt;
    if (callerBriefing) {
      systemPrompt += callerBriefing;
    }
    if (calendarConfig) {
      systemPrompt += "\n\nDu kannst Termine vereinbaren. Nutze check_available_slots um freie Zeiten zu pruefen und schedule_appointment um einen Termin zu erstellen. Frage den Anrufer nach gewuenschtem Datum, Uhrzeit und Dauer bevor du einen Termin erstellst.";
    }

    // Return assistant config — tools in model.tools with server.url
    // so Vapi routes tool-calls back to our edge function as webhooks
    return jsonResponse({
      assistant: {
        firstMessage: greeting,
        model: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
          ],
          tools: serverTools,
        },
        voice: {
          provider: "openai",
          voiceId:
            assistant.language_mode === "en"
              ? assistant.voice_id_en
              : assistant.voice_id_de,
        },
        maxDurationSeconds: assistant.max_call_duration_seconds,
        silenceTimeoutSeconds: 30,
        endCallMessage: "Vielen Dank fuer Ihren Anruf. Auf Wiedersehen!",
      },
    });
  }

  // ─── TOOL CALLS (Vapi v2 format) ──────────────────────────────────
  if (messageType === "tool-calls") {
    const toolCalls = payload.message.toolCalls ?? [];
    console.log(`[phone-rag] tool-calls: count=${toolCalls.length}, call.assistantId=${payload.message?.call?.assistantId ?? "MISSING"}, call.assistant.id=${payload.message?.call?.assistant?.id ?? "MISSING"}, message.assistant.id=${payload.message?.assistant?.id ?? "MISSING"}, phone=${payload.message?.call?.phoneNumber?.number ?? "MISSING"}, customer=${payload.message?.call?.customer?.number ?? "MISSING"}`);
    const results = [];

    try {
    for (const toolCall of toolCalls) {
      if (toolCall.function.name === "search_knowledge") {
        let args: Record<string, string>;
        try {
          args = parseToolArgs(toolCall.function.arguments);
        } catch {
          results.push({
            toolCallId: toolCall.id,
            result: "Fehler beim Parsen der Anfrage.",
          });
          continue;
        }

        const query = args.query ?? "";
        if (!query.trim()) {
          results.push({
            toolCallId: toolCall.id,
            result: "Keine Suchanfrage angegeben.",
          });
          continue;
        }

        // Get org from call context (phone number or assistantId fallback)
        const assistant = await resolveAssistantConfig(payload.message);

        if (!assistant) {
          results.push({
            toolCallId: toolCall.id,
            result: "Kein Assistent konfiguriert.",
          });
          continue;
        }

        // Auto-boost sources linked to caller's contact + resolve permissions
        const callerNumber = payload.message.call?.customer?.number ?? "";
        const [boostSourceIds, callerUserId] = await Promise.all([
          getCallerBoostSourceIds(assistant.org_id, callerNumber),
          getCallerUserId(assistant.org_id, callerNumber),
        ]);

        const context = await searchKnowledge(
          assistant.org_id,
          query,
          assistant.max_chunks ?? 5,
          assistant.boost_factor ?? 1.5,
          boostSourceIds,
          callerUserId,
        );

        results.push({
          toolCallId: toolCall.id,
          result: context || "Keine relevanten Informationen gefunden.",
        });
      } else if (toolCall.function.name === "search_knowledge_for_contact") {
        let args: Record<string, string>;
        try {
          args = parseToolArgs(toolCall.function.arguments);
        } catch {
          results.push({
            toolCallId: toolCall.id,
            result: "Fehler beim Parsen der Anfrage.",
          });
          continue;
        }

        const contactName = args.contact_name ?? "";
        const query = args.query ?? contactName;

        if (!contactName.trim()) {
          results.push({
            toolCallId: toolCall.id,
            result: "Kein Kontaktname angegeben.",
          });
          continue;
        }

        const assistant = await resolveAssistantConfig(payload.message);
        if (!assistant) {
          results.push({
            toolCallId: toolCall.id,
            result: "Kein Assistent konfiguriert.",
          });
          continue;
        }

        const callerNum = payload.message.call?.customer?.number ?? "";
        const contactCallerUserId = await getCallerUserId(assistant.org_id, callerNum);

        const context = await searchKnowledgeForContact(
          assistant.org_id,
          contactName,
          query,
          assistant.max_chunks ?? 5,
          assistant.boost_factor ?? 1.5,
          contactCallerUserId,
        );

        results.push({
          toolCallId: toolCall.id,
          result: context || `Keine Informationen zu "${contactName}" gefunden.`,
        });
      } else if (toolCall.function.name === "check_available_slots") {
        let args: Record<string, string>;
        try {
          args = parseToolArgs(toolCall.function.arguments);
        } catch {
          results.push({ toolCallId: toolCall.id, result: "Fehler beim Parsen der Anfrage." });
          continue;
        }

        const assistant = await resolveAssistantConfig(payload.message);
        if (!assistant) {
          results.push({ toolCallId: toolCall.id, result: "Kein Assistent konfiguriert." });
          continue;
        }

        const result = await handleCheckAvailableSlots(
          assistant.org_id,
          args.date,
          args.duration_minutes ? parseInt(args.duration_minutes) : undefined,
        );
        results.push({ toolCallId: toolCall.id, result });

      } else if (toolCall.function.name === "schedule_appointment") {
        let args: Record<string, string>;
        try {
          args = parseToolArgs(toolCall.function.arguments);
        } catch {
          results.push({ toolCallId: toolCall.id, result: "Fehler beim Parsen der Anfrage." });
          continue;
        }

        const assistant = await resolveAssistantConfig(payload.message);
        if (!assistant) {
          results.push({ toolCallId: toolCall.id, result: "Kein Assistent konfiguriert." });
          continue;
        }

        const result = await handleScheduleAppointment(
          assistant.org_id,
          args,
        );
        results.push({ toolCallId: toolCall.id, result });

      } else {
        results.push({
          toolCallId: toolCall.id,
          result: "Unbekannte Funktion.",
        });
      }
    }
    } catch (err) {
      console.error("[phone-rag] Unhandled error in tool-calls:", err);
      // Store error in debug table
      if (DEBUG_WEBHOOKS) {
        const db2 = getServiceClient();
        await db2.from("_debug_webhooks").insert({
          message_type: "tool-calls-error",
          payload: { error: String(err), stack: err instanceof Error ? err.stack : undefined },
        }).then(() => {}, () => {});
      }
      return jsonResponse({
        results: toolCalls.map((tc) => ({
          toolCallId: tc.id,
          result: "Ein interner Fehler ist aufgetreten. Bitte versuchen Sie es erneut.",
        })),
      });
    }

    // Debug: store tool-call results
    if (DEBUG_WEBHOOKS) {
      const dbDebug = getServiceClient();
      await dbDebug.from("_debug_webhooks").insert({
        message_type: "tool-calls-results",
        payload: { results },
      }).then(() => {}, () => {});
    }

    return jsonResponse({ results });
  }

  // ─── FUNCTION CALL (Vapi v1 format, fallback) ────────────────────
  if (messageType === "function-call") {
    const fn = payload.message.functionCall;
    if (!fn) {
      return jsonResponse({ result: "Unbekannte Funktion." });
    }

    const assistant = await resolveAssistantConfig(payload.message);
    if (!assistant) {
      return jsonResponse({ result: "Kein Assistent konfiguriert." });
    }

    if (fn.name === "search_knowledge") {
      const query = fn.parameters?.query ?? "";
      if (!query.trim()) {
        return jsonResponse({ result: "Keine Suchanfrage angegeben." });
      }

      const callerNumber = payload.message.call?.customer?.number ?? "";
      const [boostSourceIds, fnCallerUserId] = await Promise.all([
        getCallerBoostSourceIds(assistant.org_id, callerNumber),
        getCallerUserId(assistant.org_id, callerNumber),
      ]);

      const context = await searchKnowledge(
        assistant.org_id,
        query,
        assistant.max_chunks ?? 5,
        assistant.boost_factor ?? 1.5,
        boostSourceIds,
        fnCallerUserId,
      );

      return jsonResponse({
        result: context || "Keine relevanten Informationen gefunden.",
      });
    }

    if (fn.name === "search_knowledge_for_contact") {
      const contactName = fn.parameters?.contact_name ?? "";
      const query = fn.parameters?.query ?? contactName;

      if (!contactName.trim()) {
        return jsonResponse({ result: "Kein Kontaktname angegeben." });
      }

      const fnCallerNum = payload.message.call?.customer?.number ?? "";
      const fnContactUserId = await getCallerUserId(assistant.org_id, fnCallerNum);

      const context = await searchKnowledgeForContact(
        assistant.org_id,
        contactName,
        query,
        assistant.max_chunks ?? 5,
        assistant.boost_factor ?? 1.5,
        fnContactUserId,
      );

      return jsonResponse({
        result: context || `Keine Informationen zu "${contactName}" gefunden.`,
      });
    }

    if (fn.name === "check_available_slots") {
      const result = await handleCheckAvailableSlots(
        assistant.org_id,
        fn.parameters?.date,
        fn.parameters?.duration_minutes ? parseInt(fn.parameters.duration_minutes) : undefined,
      );
      return jsonResponse({ result });
    }

    if (fn.name === "schedule_appointment") {
      const result = await handleScheduleAppointment(assistant.org_id, fn.parameters ?? {});
      return jsonResponse({ result });
    }

    return jsonResponse({ result: "Unbekannte Funktion." });
  }

  // ─── OTHER MESSAGE TYPES ──────────────────────────────────────────
  // hang, end-of-call-report, etc. — acknowledge
  return jsonResponse({ ok: true });
});

// ─── HELPERS ──────────────────────────────────────────────────────────────

/** Vapi sends arguments as object (Anthropic model) or string (OpenAI model). Handle both. */
function parseToolArgs(args: unknown): Record<string, string> {
  if (typeof args === "object" && args !== null) return args as Record<string, string>;
  if (typeof args === "string") return JSON.parse(args);
  return {};
}

type AssistantConfig = {
  org_id: string;
  assistant_id: string;
  assistant_name: string;
  system_prompt: string;
  greeting_de: string;
  greeting_en: string;
  voice_id_de: string;
  voice_id_en: string;
  language_mode: string;
  max_chunks: number;
  boost_factor: number;
  max_call_duration_seconds: number;
  business_hours_start: string;
  business_hours_end: string;
  business_hours_tz: string;
  after_hours_message: string;
};

/**
 * Resolve assistant config from call context.
 * Priority: phone number → provider_assistant_id (fallback for Talk button / browser calls)
 */
async function resolveAssistantConfig(
  message: VapiMessage["message"],
): Promise<AssistantConfig | null> {
  const db = getServiceClient();
  const calledNumber = message.call?.phoneNumber?.number ?? "";
  // Vapi sends assistantId in different locations depending on message type
  const providerAssistantId =
    message.call?.assistantId
    ?? message.call?.assistant?.id
    ?? message.assistant?.id
    ?? "";

  console.log(`[resolveAssistantConfig] calledNumber="${calledNumber}", providerAssistantId="${providerAssistantId}"`);

  // Try phone number first
  if (calledNumber) {
    const { data, error } = await db.rpc("get_org_for_phone_number", {
      p_phone_number: calledNumber,
    });
    if (error) console.error("[resolveAssistantConfig] get_org_for_phone_number error:", error);
    if (data && data.length > 0) {
      console.log("[resolveAssistantConfig] Resolved org via phone number:", calledNumber);
      return data[0];
    }
  }

  // Fallback: resolve via provider_assistant_id (Vapi Talk button, browser calls)
  if (providerAssistantId) {
    const { data, error } = await db.rpc("get_org_for_provider_assistant", {
      p_provider_assistant_id: providerAssistantId,
    });
    if (error) console.error("[resolveAssistantConfig] get_org_for_provider_assistant error:", error);
    if (data && data.length > 0) {
      console.log("[resolveAssistantConfig] Resolved org via provider_assistant_id:", providerAssistantId);
      return data[0];
    }
  }

  console.error("[resolveAssistantConfig] FAILED. calledNumber:", calledNumber, "assistantId:", providerAssistantId);
  return null;
}

async function searchKnowledge(
  orgId: string,
  query: string,
  maxChunks: number,
  boostFactor: number,
  boostSourceIds: string[] = [],
  callerUserId: string | null = null,
): Promise<string> {
  const db = getServiceClient();

  // Generate embedding for semantic search
  const embedding = await embedText(query);

  let chunks: Array<{ chunk_text: string; source_title: string }>;

  if (embedding) {
    // Hybrid search (FTS + vector) with permission filter
    const { data, error } = await db.rpc("hybrid_search_boosted", {
      p_org_id: orgId,
      p_query: query,
      p_embedding: JSON.stringify(embedding),
      p_boost_source_ids: boostSourceIds,
      p_boost_factor: boostFactor,
      p_limit: maxChunks,
      p_user_id: callerUserId,
    });

    if (error) {
      console.error("Hybrid search error:", error);
      // Fallback to FTS
      const { data: ftsData } = await db.rpc("search_chunks", {
        p_org_id: orgId,
        p_query: query,
        p_limit: maxChunks,
        p_user_id: callerUserId,
      });
      chunks = ftsData ?? [];
    } else {
      chunks = data ?? [];
    }
  } else {
    // FTS only
    const { data, error } = await db.rpc("search_chunks", {
      p_org_id: orgId,
      p_query: query,
      p_limit: maxChunks,
      p_user_id: callerUserId,
    });
    if (error) {
      console.error("FTS error:", error);
      return "";
    }
    chunks = data ?? [];
  }

  if (!chunks || chunks.length === 0) return "";

  // Build context string for the LLM
  return chunks
    .map(
      (c: { chunk_text: string; source_title: string }, i: number) =>
        `[Quelle ${i + 1}: ${c.source_title}]\n${c.chunk_text}`,
    )
    .join("\n\n---\n\n");
}

async function searchKnowledgeForContact(
  orgId: string,
  contactName: string,
  query: string,
  maxChunks: number,
  boostFactor: number,
  callerUserId: string | null = null,
): Promise<string> {
  const db = getServiceClient();

  // Find contact by name
  const { data: contacts } = await db.rpc("search_contact_by_name", {
    p_org_id: orgId,
    p_name: contactName,
  });

  let boostSourceIds: string[] = [];
  let contactInfo = "";

  if (contacts && contacts.length > 0) {
    const contact = contacts[0];
    contactInfo = `Kontakt: ${contact.first_name} ${contact.last_name}`;
    if (contact.company_name) contactInfo += ` (${contact.company_name})`;
    if (contact.email) contactInfo += `, E-Mail: ${contact.email}`;
    if (contact.phone) contactInfo += `, Tel: ${contact.phone}`;

    // Get source IDs linked to this contact for boosting
    const { data: sourceIds } = await db.rpc("get_boosted_source_ids_for_contact", {
      p_org_id: orgId,
      p_contact_id: contact.id,
    });
    boostSourceIds = sourceIds ?? [];
  }

  // Search with contact-boosted sources + permission filter
  const searchResult = await searchKnowledge(
    orgId,
    query,
    maxChunks,
    boostFactor,
    boostSourceIds,
    callerUserId,
  );

  // Prepend contact info if found
  if (contactInfo && searchResult) {
    return `${contactInfo}\n\n---\n\n${searchResult}`;
  }
  if (contactInfo) {
    return contactInfo;
  }
  return searchResult;
}

/** Resolve the TimeKeeper user_id for a caller via phone number → contacts.user_id */
async function getCallerUserId(
  orgId: string,
  callerNumber: string,
): Promise<string | null> {
  if (!callerNumber) return null;

  const db = getServiceClient();
  const normalized = callerNumber.replace(/\s+/g, "");

  const { data } = await db
    .from("contacts")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("phone", normalized)
    .not("user_id", "is", null)
    .limit(1)
    .maybeSingle();

  return data?.user_id ?? null;
}

async function getCallerBoostSourceIds(
  orgId: string,
  callerNumber: string,
): Promise<string[]> {
  if (!callerNumber) return [];

  const db = getServiceClient();

  // Match caller to contact
  const { data: contactId } = await db.rpc("match_caller_to_contact", {
    p_org_id: orgId,
    p_caller_number: callerNumber,
  });

  if (!contactId) return [];

  // Get boost source IDs for this contact
  const { data: sourceIds } = await db.rpc("get_boosted_source_ids_for_contact", {
    p_org_id: orgId,
    p_contact_id: contactId,
  });

  return sourceIds ?? [];
}

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────

function buildAssistantTools(includeCalendar: boolean) {
  const tools = [
    {
      type: "function",
      function: {
        name: "search_knowledge",
        description:
          "Search the knowledge base including past conversations, call transcripts, meeting notes, and all company information. Use this for ANY question about past interactions, contacts, or factual information.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query based on the customer's question" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_knowledge_for_contact",
        description:
          "Search the knowledge base for information about a specific contact person, including past conversations and linked documents. Use when the caller asks about a specific person by name.",
        parameters: {
          type: "object",
          properties: {
            contact_name: { type: "string", description: "The name of the contact person to search for" },
            query: { type: "string", description: "Optional additional search query to refine results" },
          },
          required: ["contact_name"],
        },
      },
    },
  ];

  if (includeCalendar) {
    tools.push(
      {
        type: "function",
        function: {
          name: "check_available_slots",
          description: "Check available appointment slots for a specific date. Use when a caller wants to schedule a meeting or appointment.",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "The date to check in YYYY-MM-DD format" },
              duration_minutes: { type: "string", description: "Desired appointment duration in minutes (default: 30)" },
            },
            required: ["date"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "schedule_appointment",
          description: "Create a new appointment in the calendar. Use after checking available slots and confirming with the caller.",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Appointment date in YYYY-MM-DD format" },
              time: { type: "string", description: "Start time in HH:MM format" },
              duration_minutes: { type: "string", description: "Duration in minutes (default: 30)" },
              title: { type: "string", description: "Appointment title/subject" },
              attendee_name: { type: "string", description: "Name of the attendee" },
              attendee_email: { type: "string", description: "Email of the attendee for calendar invitation" },
            },
            required: ["date", "time", "title"],
          },
        },
      },
    );
  }

  return tools;
}

// ─── CALENDAR HELPERS ────────────────────────────────────────────────────

type CalendarConfig = {
  calendar_id: string;
  refresh_token: string;
  access_token: string | null;
  token_expires_at: string | null;
  settings: CalendarSettings;
  status: string;
};

async function getCalendarConfig(orgId: string): Promise<CalendarConfig | null> {
  const db = getServiceClient();
  const { data } = await db.rpc("get_calendar_integration_for_org", {
    p_org_id: orgId,
  });

  if (!data || data.length === 0) return null;
  const row = data[0];
  if (!row.refresh_token) return null;
  return row as CalendarConfig;
}

async function getCalendarAccessToken(
  orgId: string,
  config: CalendarConfig,
): Promise<string | null> {
  // Check if existing token is still valid (with 2 min buffer)
  if (config.access_token && config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at);
    if (expiresAt.getTime() > Date.now() + 120_000) {
      return config.access_token;
    }
  }

  // Refresh the token (pass orgId for org-aware credentials). The phone
  // assistant runs on every voice call and must degrade gracefully when the
  // calendar token can't be refreshed — keep the null-return contract by
  // catching here. The reason is logged for triage.
  let result: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    result = await refreshAccessToken(config.refresh_token, orgId);
  } catch (err) {
    console.error("[phone-rag] calendar token refresh failed:", err);
    return null;
  }

  // Store the new token in DB
  const db = getServiceClient();
  await db.rpc("update_calendar_token", {
    p_org_id: orgId,
    p_access_token: result.access_token,
    p_expires_at: result.expires_at.toISOString(),
  });

  return result.access_token;
}

async function handleCheckAvailableSlots(
  orgId: string,
  date?: string,
  durationMinutes?: number,
): Promise<string> {
  const config = await getCalendarConfig(orgId);
  if (!config) return "Kalender-Integration ist nicht eingerichtet.";

  const accessToken = await getCalendarAccessToken(orgId, config);
  if (!accessToken) return "Kalender-Zugriff fehlgeschlagen. Bitte spaeter erneut versuchen.";

  const settings = config.settings;
  const duration = durationMinutes || settings.default_duration_minutes || 30;

  // Default to tomorrow if no date given or invalid
  let targetDate = date;
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    targetDate = tomorrow.toISOString().slice(0, 10);
  }

  // Debug: store calendar query details
  const dbCal = DEBUG_WEBHOOKS ? getServiceClient() : null;
  if (dbCal) {
    await dbCal.from("_debug_webhooks").insert({
      message_type: "calendar-debug",
      payload: {
        step: "before_listAvailableSlots",
        calendar_id: config.calendar_id,
        targetDate,
        duration,
        settings,
        has_access_token: !!accessToken,
        token_length: accessToken?.length,
      },
    }).then(() => {}, () => {});
  }

  const slots = await listAvailableSlots(
    accessToken,
    config.calendar_id,
    targetDate,
    duration,
    settings,
  );

  // Check for error marker from FreeBusy
  if (slots.length > 0 && slots[0].start === "__ERROR__") {
    if (dbCal) {
      await dbCal.from("_debug_webhooks").insert({
        message_type: "calendar-error",
        payload: { error: slots[0].end, targetDate, calendar_id: config.calendar_id },
      }).then(() => {}, () => {});
    }
    return "Kalender-Zugriff fehlgeschlagen. Bitte spaeter erneut versuchen.";
  }

  // Debug: store result
  if (dbCal) {
    await dbCal.from("_debug_webhooks").insert({
      message_type: "calendar-debug",
      payload: {
        step: "after_listAvailableSlots",
        slots_count: slots.length,
        slots: slots.slice(0, 5),
      },
    }).then(() => {}, () => {});
  }

  if (slots.length === 0) {
    return `Am ${formatDateDE(targetDate)} sind leider keine freien Termine (${duration} Minuten) verfuegbar.`;
  }

  const slotList = slots
    .slice(0, 8) // Limit to 8 slots for voice readability
    .map((s) => `${s.start} bis ${s.end}`)
    .join(", ");

  return `Am ${formatDateDE(targetDate)} sind folgende Zeiten fuer einen ${duration}-Minuten-Termin verfuegbar: ${slotList}.`;
}

async function handleScheduleAppointment(
  orgId: string,
  params: Record<string, string>,
): Promise<string> {
  const config = await getCalendarConfig(orgId);
  if (!config) return "Kalender-Integration ist nicht eingerichtet.";

  const date = params.date;
  const time = params.time;
  const title = params.title;

  if (!date || !time || !title) {
    return "Bitte Datum (YYYY-MM-DD), Uhrzeit (HH:MM) und Betreff angeben.";
  }

  const accessToken = await getCalendarAccessToken(orgId, config);
  if (!accessToken) return "Kalender-Zugriff fehlgeschlagen. Bitte spaeter erneut versuchen.";

  const settings = config.settings;
  const duration = params.duration_minutes ? parseInt(params.duration_minutes) : (settings.default_duration_minutes || 30);

  const result = await createCalendarEvent(
    accessToken,
    config.calendar_id,
    {
      summary: title,
      date,
      startTime: time,
      durationMinutes: duration,
      attendeeName: params.attendee_name,
      attendeeEmail: params.attendee_email,
      description: `Termin vereinbart per Telefonassistent`,
    },
    settings.timezone || "Europe/Berlin",
  );

  if (!result.ok) {
    return `Termin konnte nicht erstellt werden: ${result.error}`;
  }

  return `Termin "${title}" am ${formatDateDE(date)} um ${time} Uhr (${duration} Min.) wurde erfolgreich erstellt.`;
}

function formatDateDE(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split("-");
    return `${d}.${m}.${y}`;
  } catch {
    return dateStr;
  }
}

// ─── CALLER CONTEXT ─────────────────────────────────────────────────────

type CallerContext = {
  contact_id: string;
  contact_name: string;
  company_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  recent_activities: Array<{ title: string; date: string; activity_type: string }>;
  next_appointment: { title: string; datetime: string } | null;
};
// NOTE: get_caller_context used to return an `open_processes` column as well.
// The process model was dropped by
// 20260806160000_drop_process_and_mapping_model.sql, which recreates the RPC
// without it — keep this type in sync with that definition.

async function getCallerContextFromDB(
  orgId: string,
  callerNumber: string,
): Promise<CallerContext | null> {
  const db = getServiceClient();
  const { data, error } = await db.rpc("get_caller_context", {
    p_org_id: orgId,
    p_caller_number: callerNumber,
  });

  if (error) {
    console.error("[caller-context] Error:", error);
    return null;
  }

  if (!data || data.length === 0 || !data[0].contact_id) return null;
  return data[0] as CallerContext;
}

// ─── BUSINESS HOURS ──────────────────────────────────────────────────────

async function checkBusinessHours(
  start: string,
  end: string,
  tz: string,
): Promise<boolean> {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const currentTime = formatter.format(now);
    return currentTime >= start.slice(0, 5) && currentTime <= end.slice(0, 5);
  } catch {
    // If timezone parsing fails, assume within hours
    return true;
  }
}
