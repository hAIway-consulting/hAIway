import { createUserClient } from "../supabase-server";
import { requireOrgId } from "../org-context";

export type PhoneAssistant = {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  provider: string;
  provider_assistant_id: string | null;
  system_prompt: string | null;
  greeting_de: string | null;
  greeting_en: string | null;
  voice_id_de: string | null;
  voice_id_en: string | null;
  language_mode: string;
  max_chunks: number;
  boost_factor: number;
  max_call_duration_seconds: number;
  business_hours_start: string | null;
  business_hours_end: string | null;
  business_hours_tz: string | null;
  after_hours_message: string | null;
  notification_email: string | null;
  notification_mode: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PhoneNumber = {
  id: string;
  organization_id: string;
  assistant_id: string;
  phone_number: string;
  display_name: string | null;
  provider_phone_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ActionItem = {
  task: string;
  priority: string;
};

export type CallLog = {
  id: string;
  organization_id: string;
  assistant_id: string;
  phone_number_id: string | null;
  provider_call_id: string | null;
  caller_number: string | null;
  called_number: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  summary: string | null;
  detected_language: string | null;
  recording_url: string | null;
  source_id: string | null;
  activity_id: string | null;
  contact_id: string | null;
  cost_cents: number | null;
  action_items: ActionItem[];
  auto_tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CallStats = {
  total_calls: number;
  completed_calls: number;
  missed_calls: number;
  avg_duration_seconds: number | null;
  total_duration_seconds: number;
  calls_de: number;
  calls_en: number;
  calls_other: number;
  total_cost_cents: number;
};

export type CalendarIntegration = {
  id: string;
  organization_id: string;
  provider: string;
  calendar_id: string;
  refresh_token: string | null;
  settings: {
    default_duration_minutes: number;
    buffer_minutes: number;
    working_hours_start: string;
    working_hours_end: string;
    timezone: string;
  };
  status: string;
  created_at: string;
  updated_at: string;
};

// Re-export constants
export {
  VOICE_OPTIONS,
  LANGUAGE_MODES,
  ASSISTANT_STATUS_LABELS,
  CALL_STATUS_LABELS,
  PHONE_NUMBER_STATUS_LABELS,
} from "@/lib/constants/phone-assistant";

// ─── ASSISTANT CONFIG ──────────────────────────────────────────────────

export async function getAssistant(): Promise<PhoneAssistant | null> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("phone_assistants")
    .select("*")
    .eq("organization_id", orgId)
    .single();
  if (error) return null;
  return data;
}

// ─── PHONE NUMBERS ─────────────────────────────────────────────────────

export async function listPhoneNumbers(): Promise<PhoneNumber[]> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("phone_numbers")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── CALL LOGS ─────────────────────────────────────────────────────────

export async function listCallLogs(limit = 50): Promise<CallLog[]> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("call_logs")
    .select("*")
    .eq("organization_id", orgId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getCallLogById(id: string): Promise<CallLog | null> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("call_logs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();
  if (error) return null;
  return data;
}

// ─── CALENDAR INTEGRATION ─────────────────────────────────────────────

export async function getCalendarIntegration(): Promise<CalendarIntegration | null> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("calendar_integrations")
    .select("*")
    .eq("organization_id", orgId)
    .single();
  if (error) return null;
  return data;
}

// ─── STATS ─────────────────────────────────────────────────────────────

export async function getCallStats(days = 30): Promise<CallStats | null> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db.rpc("get_call_stats", {
    p_org_id: orgId,
    p_days: days,
  });
  if (error) return null;
  return (data?.[0] ?? null) as CallStats | null;
}

// ─── CALL CATEGORIES ─────────────────────────────────────────────────

export type CallCategoryStat = {
  tag: string;
  call_count: number;
};

export async function getCallCategoryStats(days = 30): Promise<CallCategoryStat[]> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db.rpc("get_call_category_stats", {
    p_org_id: orgId,
    p_days: days,
  });
  if (error) return [];
  return (data ?? []) as CallCategoryStat[];
}
