import { notFound } from "next/navigation";
import { getConversation, listConversations, listMyConversations, getAvailableModels, getDefaultAgentModel } from "../actions";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { getMemberRole } from "@/lib/db/org-context";
import ChatLayout from "../_components/chat-layout";

// Der Agent-Modus fährt einen Multi-Step-Tool-Loop — gib Server-Actions dieser
// Route mehr Zeit (Vercel Pro). Betrifft auch den RAG-Pfad unschädlich.
export const maxDuration = 300;

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Workspace-Persona (End-User) bekommt den minimalen Chat-Look ohne Sidebar
  // — die "Letzte Chats"-Liste lebt schon auf der Home. Berater + HAIway
  // sehen weiterhin die volle Sidebar-Variante mit Audit-Sicht.
  const [admin, role] = await Promise.all([
    isPlatformAdmin().catch(() => false),
    getMemberRole().catch(() => null),
  ]);
  const isWorkspace = !admin && role !== "admin" && role !== "owner";

  const [data, conversations, models, defaultAgentModel] = await Promise.all([
    getConversation(id),
    isWorkspace ? listMyConversations(50) : listConversations(50),
    getAvailableModels(),
    getDefaultAgentModel().catch(() => undefined),
  ]);

  if (!data) notFound();

  return (
    <ChatLayout
      activeId={id}
      conversation={data.conversation}
      messages={data.messages}
      conversations={conversations}
      models={models}
      defaultAgentModel={defaultAgentModel}
      isAdmin={admin}
      variant={isWorkspace ? "workspace" : "default"}
    />
  );
}
