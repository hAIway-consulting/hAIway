"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { getAppUrl } from "@/lib/app-url";

// ─── ASSISTANT CONFIG ──────────────────────────────────────────────────────

export async function createOrUpdateAssistant(formData: FormData) {
  const orgId = await requireOrgId();
  const db = createServiceClient();

  const name = (formData.get("name") as string)?.trim() || "Telefonassistent";
  const systemPrompt = (formData.get("system_prompt") as string)?.trim() || null;
  const greetingDe = (formData.get("greeting_de") as string)?.trim() || null;
  const greetingEn = (formData.get("greeting_en") as string)?.trim() || null;
  const voiceIdDe = (formData.get("voice_id_de") as string) || "alloy";
  const voiceIdEn = (formData.get("voice_id_en") as string) || "alloy";
  const languageMode = (formData.get("language_mode") as string) || "auto";
  const maxChunks = parseInt(formData.get("max_chunks") as string, 10) || 5;
  const boostFactor = parseFloat(formData.get("boost_factor") as string) || 1.5;
  const maxCallDuration = parseInt(formData.get("max_call_duration_seconds") as string, 10) || 600;
  const businessHoursStart = (formData.get("business_hours_start") as string)?.trim() || null;
  const businessHoursEnd = (formData.get("business_hours_end") as string)?.trim() || null;
  const businessHoursTz = (formData.get("business_hours_tz") as string)?.trim() || "Europe/Berlin";
  const afterHoursMessage = (formData.get("after_hours_message") as string)?.trim() || null;
  const notificationEmail = (formData.get("notification_email") as string)?.trim() || null;
  const notificationMode = (formData.get("notification_mode") as string) || "none";

  const values = {
    organization_id: orgId,
    name,
    system_prompt: systemPrompt,
    greeting_de: greetingDe,
    greeting_en: greetingEn,
    voice_id_de: voiceIdDe,
    voice_id_en: voiceIdEn,
    language_mode: languageMode,
    max_chunks: maxChunks,
    boost_factor: boostFactor,
    max_call_duration_seconds: maxCallDuration,
    business_hours_start: businessHoursStart,
    business_hours_end: businessHoursEnd,
    business_hours_tz: businessHoursTz,
    after_hours_message: afterHoursMessage,
    notification_email: notificationEmail,
    notification_mode: notificationMode,
  };

  // Upsert: create or update (unique on organization_id)
  const { data: existing } = await db
    .from("phone_assistants")
    .select("id")
    .eq("organization_id", orgId)
    .single();

  if (existing) {
    await db
      .from("phone_assistants")
      .update(values)
      .eq("id", existing.id);
  } else {
    await db.from("phone_assistants").insert(values);
  }

  revalidatePath("/telefon-assistent");
  revalidatePath("/telefon-assistent/einstellungen");
  redirect("/telefon-assistent");
}

export async function toggleAssistantStatus() {
  const orgId = await requireOrgId();
  const db = createServiceClient();

  const { data: assistant } = await db
    .from("phone_assistants")
    .select("id, status")
    .eq("organization_id", orgId)
    .single();

  if (!assistant) return;

  const newStatus = assistant.status === "active" ? "paused" : "active";
  await db
    .from("phone_assistants")
    .update({ status: newStatus })
    .eq("id", assistant.id);

  revalidatePath("/telefon-assistent");
  revalidatePath("/telefon-assistent/einstellungen");
}

// ─── VAPI PROVISIONING ─────────────────────────────────────────────────────

// ─── VAPI API (direct from server action — keys from Vercel env) ───────────

const VAPI_API_URL = "https://api.vapi.ai";

function getVapiKey(): string | undefined {
  return process.env.VAPI_API_KEY;
}

async function vapiRequest(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const apiKey = getVapiKey();
  if (!apiKey) return { ok: false, error: "VAPI_API_KEY not set" };

  try {
    const response = await fetch(`${VAPI_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    if (!response.ok) {
      return { ok: false, error: data?.message ?? `Vapi error: ${response.status}` };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function provisionVapiAssistant(): Promise<{ ok: boolean; error?: string }> {
  const apiKey = getVapiKey();
  if (!apiKey) {
    return { ok: false, error: "VAPI_API_KEY ist nicht konfiguriert. Bitte in Vercel Env-Variablen hinterlegen." };
  }

  const orgId = await requireOrgId();
  const db = createServiceClient();

  // Get assistant config
  const { data: pa } = await db
    .from("phone_assistants")
    .select("*")
    .eq("organization_id", orgId)
    .single();

  if (!pa) {
    return { ok: false, error: "Kein Telefonassistent konfiguriert. Bitte zuerst Einstellungen speichern." };
  }

  if (pa.provider_assistant_id) {
    revalidatePath("/telefon-assistent/einstellungen");
    return { ok: true };
  }

  const serverUrl = process.env.VAPI_SERVER_URL
    ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/phone-assistant-rag`;

  // Check if calendar integration is active for this org
  const hasCalendar = await hasActiveCalendarIntegration(orgId);

  // Tools with server.url so Vapi routes tool-calls back as webhooks
  const serverTools = buildAssistantTools(hasCalendar).map((t) => ({
    ...t,
    server: { url: serverUrl },
  }));

  // Extend system prompt with calendar instructions if active
  let systemPrompt = pa.system_prompt ?? "Du bist ein hilfreicher Telefonassistent.";
  if (hasCalendar) {
    systemPrompt += CALENDAR_PROMPT_EXTENSION;
  }

  const result = await vapiRequest("/assistant", "POST", {
    name: `${pa.name} (${orgId.slice(0, 8)})`,
    serverUrl,
    serverUrlSecret: process.env.VAPI_SECRET ?? undefined,
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      messages: [{ role: "system", content: systemPrompt }],
      tools: serverTools,
    },
    voice: { provider: "openai", voiceId: pa.voice_id_de ?? "alloy" },
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: "multi",
      endpointing: 300,
    },
    startSpeakingPlan: { waitSeconds: 0.6 },
    stopSpeakingPlan: { numWords: 3, voiceSeconds: 0.4, backoffSeconds: 1 },
    firstMessage: pa.greeting_de ?? "Hallo, wie kann ich Ihnen helfen?",
    maxDurationSeconds: pa.max_call_duration_seconds ?? 600,
    silenceTimeoutSeconds: 60,
    endCallMessage: "Vielen Dank fuer Ihren Anruf. Auf Wiedersehen!",
  });

  if (!result.ok) {
    console.error("Vapi create assistant error:", result.error);
    return { ok: false, error: `Vapi-Fehler: ${result.error}` };
  }

  const vapiId = result.data?.id as string;

  // Store provider ID and activate
  await db
    .from("phone_assistants")
    .update({ provider_assistant_id: vapiId, status: "active" })
    .eq("id", pa.id);

  console.log("Vapi assistant created:", vapiId);

  revalidatePath("/telefon-assistent");
  revalidatePath("/telefon-assistent/einstellungen");
  return { ok: true };
}

export async function syncVapiConfig(): Promise<{ ok: boolean; error?: string }> {
  const apiKey = getVapiKey();
  if (!apiKey) {
    return { ok: false, error: "VAPI_API_KEY ist nicht konfiguriert." };
  }

  const orgId = await requireOrgId();
  const db = createServiceClient();

  const { data: pa } = await db
    .from("phone_assistants")
    .select("*")
    .eq("organization_id", orgId)
    .single();

  if (!pa?.provider_assistant_id) {
    return { ok: false, error: "Kein Provider-Assistent vorhanden." };
  }

  const serverUrl = process.env.VAPI_SERVER_URL
    ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/phone-assistant-rag`;

  // Check if calendar integration is active for this org
  const hasCalendar = await hasActiveCalendarIntegration(orgId);

  // Tools with server.url for webhook routing
  const serverTools = buildAssistantTools(hasCalendar).map((t) => ({
    ...t,
    server: { url: serverUrl },
  }));

  // Extend system prompt with calendar instructions if active
  let systemPrompt = pa.system_prompt ?? "Du bist ein hilfreicher Telefonassistent.";
  if (hasCalendar) {
    systemPrompt += CALENDAR_PROMPT_EXTENSION;
  }

  const result = await vapiRequest(`/assistant/${pa.provider_assistant_id}`, "PATCH", {
    serverUrl,
    serverUrlSecret: process.env.VAPI_SECRET ?? undefined,
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      messages: [{ role: "system", content: systemPrompt }],
      tools: serverTools,
    },
    voice: {
      provider: "openai",
      voiceId: pa.language_mode === "en" ? pa.voice_id_en : pa.voice_id_de,
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: pa.language_mode === "en" ? "en" : "multi",
      endpointing: 300,
    },
    startSpeakingPlan: { waitSeconds: 0.6 },
    stopSpeakingPlan: { numWords: 3, voiceSeconds: 0.4, backoffSeconds: 1 },
    firstMessage: pa.language_mode === "en" ? pa.greeting_en : pa.greeting_de,
    maxDurationSeconds: pa.max_call_duration_seconds,
    silenceTimeoutSeconds: 60,
  });

  if (!result.ok) {
    console.error("Vapi sync error:", result.error);
    return { ok: false, error: `Vapi-Fehler: ${result.error}` };
  }

  revalidatePath("/telefon-assistent");
  revalidatePath("/telefon-assistent/einstellungen");
  return { ok: true };
}

// ─── TOOL DEFINITIONS ──────────────────────────────────────────────────────

function buildAssistantTools(includeCalendar = false): Array<Record<string, any>> {
  const tools: Array<Record<string, any>> = [
    {
      type: "function",
      function: {
        name: "search_knowledge",
        description:
          "Search the knowledge base including past conversations, call transcripts, meeting notes, and all company information. Use this for ANY question about past interactions, contacts, or factual information.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
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
            contact_name: {
              type: "string",
              description: "The name of the contact person to search for",
            },
            query: {
              type: "string",
              description: "Optional additional search query to refine results",
            },
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

async function hasActiveCalendarIntegration(orgId: string): Promise<boolean> {
  const db = createServiceClient();
  const { data } = await db
    .from("calendar_integrations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .not("refresh_token", "is", null)
    .limit(1)
    .single();
  return !!data;
}

const CALENDAR_PROMPT_EXTENSION = "\n\nDu kannst Termine vereinbaren. Nutze check_available_slots um freie Zeiten zu pruefen und schedule_appointment um einen Termin zu erstellen. Frage den Anrufer nach gewuenschtem Datum, Uhrzeit und Dauer bevor du einen Termin erstellst.";

// ─── CALENDAR INTEGRATION ──────────────────────────────────────────────────

export async function saveCalendarSettings(formData: FormData) {
  const orgId = await requireOrgId();
  const db = createServiceClient();

  const calendarId = (formData.get("calendar_id") as string)?.trim() || "primary";
  const defaultDuration = parseInt(formData.get("default_duration_minutes") as string, 10) || 30;
  const buffer = parseInt(formData.get("buffer_minutes") as string, 10) || 15;
  const workStart = (formData.get("working_hours_start") as string)?.trim() || "09:00";
  const workEnd = (formData.get("working_hours_end") as string)?.trim() || "17:00";
  const timezone = (formData.get("timezone") as string)?.trim() || "Europe/Berlin";

  const settings = {
    default_duration_minutes: defaultDuration,
    buffer_minutes: buffer,
    working_hours_start: workStart,
    working_hours_end: workEnd,
    timezone,
  };

  const { data: existing } = await db
    .from("calendar_integrations")
    .select("id")
    .eq("organization_id", orgId)
    .single();

  if (existing) {
    await db
      .from("calendar_integrations")
      .update({ calendar_id: calendarId, settings })
      .eq("id", existing.id);
  } else {
    await db.from("calendar_integrations").insert({
      organization_id: orgId,
      calendar_id: calendarId,
      settings,
    });
  }

  revalidatePath("/telefon-assistent/kalender");
  revalidatePath("/telefon-assistent/einstellungen");
}

export async function disconnectCalendar() {
  const orgId = await requireOrgId();
  const db = createServiceClient();

  await db
    .from("calendar_integrations")
    .update({
      status: "inactive",
      refresh_token: null,
      access_token: null,
      token_expires_at: null,
    })
    .eq("organization_id", orgId);

  // Auto-sync Vapi assistant to remove calendar tools
  await syncVapiConfig().catch((e) =>
    console.error("Auto-sync after calendar disconnect failed:", e),
  );

  revalidatePath("/telefon-assistent/kalender");
  revalidatePath("/telefon-assistent/einstellungen");
}

export async function getGoogleOAuthUrl(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${await getAppUrl()}/telefon-assistent/kalender/callback`;

  const params = new URLSearchParams({
    client_id: clientId || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar",
    access_type: "offline",
    prompt: "consent",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<{ ok: boolean; error?: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${await getAppUrl()}/telefon-assistent/kalender/callback`;

  if (!clientId || !clientSecret) {
    return { ok: false, error: `Google OAuth nicht konfiguriert. Client ID: ${clientId ? "gesetzt" : "FEHLT"}, Client Secret: ${clientSecret ? "gesetzt" : "FEHLT"}` };
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Google OAuth token exchange error:", response.status, errText);
      return { ok: false, error: `Token-Austausch fehlgeschlagen (${response.status}): ${errText.slice(0, 200)}` };
    }

    const data = await response.json();
    const refreshToken = data.refresh_token;
    const accessToken = data.access_token;
    const expiresIn = data.expires_in ?? 3600;

    if (!refreshToken) {
      return { ok: false, error: "Kein Refresh-Token erhalten. Bitte erneut verbinden." };
    }

    const orgId = await requireOrgId();
    const db = createServiceClient();

    const tokenExpiresAt = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();

    const { data: existing } = await db
      .from("calendar_integrations")
      .select("id")
      .eq("organization_id", orgId)
      .single();

    if (existing) {
      await db
        .from("calendar_integrations")
        .update({
          refresh_token: refreshToken,
          access_token: accessToken,
          token_expires_at: tokenExpiresAt,
          status: "active",
        })
        .eq("id", existing.id);
    } else {
      await db.from("calendar_integrations").insert({
        organization_id: orgId,
        refresh_token: refreshToken,
        access_token: accessToken,
        token_expires_at: tokenExpiresAt,
        status: "active",
      });
    }

    // Auto-sync Vapi assistant to include calendar tools
    await syncVapiConfig().catch((e) =>
      console.error("Auto-sync after calendar connect failed:", e),
    );

    return { ok: true };
  } catch (err) {
    console.error("Google OAuth exchange error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Fehler beim Token-Austausch: ${msg}` };
  }
}

// ─── TEST CALL ────────────────────────────────────────────────────────────

export async function getTestCallConfig(): Promise<{
  ok: boolean;
  assistantId?: string;
  assistantName?: string;
  error?: string;
}> {
  const orgId = await requireOrgId();
  const db = createServiceClient();

  const { data: pa } = await db
    .from("phone_assistants")
    .select("provider_assistant_id, name, status")
    .eq("organization_id", orgId)
    .single();

  if (!pa?.provider_assistant_id) {
    return { ok: false, error: "Assistent ist nicht bei Vapi registriert." };
  }
  if (pa.status !== "active") {
    return { ok: false, error: "Assistent ist pausiert. Bitte zuerst aktivieren." };
  }

  return { ok: true, assistantId: pa.provider_assistant_id, assistantName: pa.name ?? undefined };
}
