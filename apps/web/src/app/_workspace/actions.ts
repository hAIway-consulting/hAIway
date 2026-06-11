"use server";

import { redirect } from "next/navigation";
import { createConversation, sendMessage } from "@/app/chat/actions";
import { sendAgentMessage } from "@/app/chat/agent-actions";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";

/**
 * Hero-Eingabe vom Workspace-Home: erstellt eine neue Konversation,
 * sendet die erste Frage und leitet auf /chat/{id} weiter.
 *
 * Optional kann ein agentPrompt vorangestellt werden — dann verhält sich
 * das Tile wie ein One-Click-Agent (Pre-Prompt + User-Frage).
 */
export async function startChat(formData: FormData): Promise<void> {
  const raw = (formData.get("question") as string | null) ?? "";
  const agentPrompt = (formData.get("agentPrompt") as string | null) ?? "";
  const mode = (formData.get("mode") as string | null) === "agent" ? "agent" : "chat";
  const question = raw.trim();
  if (!question) return;

  const composed = agentPrompt ? `${agentPrompt}\n\n${question}` : question;

  const id = await createConversation(mode);
  // Awaiting keeps the UX coherent — the chat page sees both messages.
  if (mode === "agent") {
    await sendAgentMessage(id, composed);
  } else {
    await sendMessage(id, composed);
  }
  redirect(`/chat/${id}`);
}

/**
 * One-Click-Agent: startet eine Konversation direkt mit dem Agent-Prompt
 * (ohne zusätzliche User-Frage). Der Agent übernimmt die Initiative.
 */
export async function startAgent(formData: FormData): Promise<void> {
  const agentPrompt = (formData.get("agentPrompt") as string | null) ?? "";
  const prompt = agentPrompt.trim();
  if (!prompt) return;

  const id = await createConversation();
  await sendMessage(id, prompt);
  redirect(`/chat/${id}`);
}

/**
 * Loggt einen App-Launch im HAIway-internen App-Inventar. Speist die
 * Mission-Control-Telemetrie ("zuletzt genutzt", "Top-Apps").
 *
 * RLS sichert: nur eigene User-ID, eigene Org. Mehr Felder kommen über
 * `metadata` rein, sobald wir echte Apps statt Stubs haben.
 */
export async function recordAppLaunch(
  appId: string,
  appKind: "no-code" | "typescript" | "external",
): Promise<void> {
  if (!appId) return;
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return;

  await db.from("app_launch_events").insert({
    organization_id: orgId,
    user_id: user.id,
    app_id: appId,
    app_kind: appKind,
  });
}

/**
 * Form-Action-Variante: loggt den Launch und navigiert zur App-Detail-Page.
 * Wird von den App-Cards in HAIway-Mission-Control als formAction genutzt.
 */
export async function launchApp(formData: FormData): Promise<void> {
  const appId = (formData.get("appId") as string | null) ?? "";
  const appKind = (formData.get("appKind") as string | null) ?? "no-code";
  if (!appId) return;
  const kind: "no-code" | "typescript" | "external" =
    appKind === "typescript" || appKind === "external" ? appKind : "no-code";

  await recordAppLaunch(appId, kind);
  redirect(`/haiway/apps/${appId}`);
}
