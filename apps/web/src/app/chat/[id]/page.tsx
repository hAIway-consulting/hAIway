import { notFound } from "next/navigation";
import { getConversation, listConversations, listMyConversations, getAvailableModels } from "../actions";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { getMemberRole, requireOrgId } from "@/lib/db/org-context";
import { hasFeature } from "@/lib/features/flags";
import { resolveAgentConfig } from "@/lib/ai/agent/config";
import { getPendingConfirmation } from "../agent-actions";
import ChatLayout from "../_components/chat-layout";

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

  // Agent mode is offered only when the feature flag is on AND a provider
  // is actually configured — explicit availability, no silent fallback
  // (spec-cockpit.md §12.1/§15).
  const [data, conversations, models, agentFlag, agentCfg, pendingConfirmation] = await Promise.all([
    getConversation(id),
    isWorkspace ? listMyConversations(50) : listConversations(50),
    getAvailableModels(),
    hasFeature("agent_mode").catch(() => false),
    requireOrgId().then((orgId) => resolveAgentConfig(orgId)).catch(() => ({ available: false })),
    // Reconstruct an open write confirmation after refresh (spec §12.2).
    getPendingConfirmation(id),
  ]);

  if (!data) notFound();
  const agentAvailable = agentFlag && agentCfg.available;

  return (
    <ChatLayout
      activeId={id}
      conversation={data.conversation}
      messages={data.messages}
      conversations={conversations}
      models={models}
      isAdmin={admin}
      variant={isWorkspace ? "workspace" : "default"}
      agentAvailable={agentAvailable}
      pendingConfirmation={pendingConfirmation}
    />
  );
}
