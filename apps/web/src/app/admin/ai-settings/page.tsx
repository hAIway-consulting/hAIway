import { redirect } from "next/navigation";
import { createUserClient, getUser } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import AiSettingsForm from "./form";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .single();

  const ai = ((data?.settings as Record<string, unknown> | null)?.ai ?? {}) as {
    system_prompt?: string;
    tone?: string;
    language?: string;
    agent?: { provider?: string; model?: string; base_url?: string };
  };
  const agent = ai.agent ?? {};
  const agentProvider =
    agent.provider === "anthropic" || agent.provider === "openai-compatible" ? agent.provider : "";

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6 lg:p-8 max-w-3xl">
      <div>
        <h1
          className="text-xl md:text-2xl font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
        >
          KI-Einstellungen
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Eigener System-Prompt fuer den Chat. Wird vor jeder Antwort an das LLM
          uebergeben — zusaetzlich zu den fixen Plattform-Regeln (kein
          Halluzinieren, Quellen zitieren).
        </p>
      </div>
      <AiSettingsForm
        initialPrompt={ai.system_prompt ?? ""}
        initialTone={(ai.tone as "formal" | "casual" | "neutral") ?? "neutral"}
        initialLanguage={(ai.language as "de" | "en") ?? "de"}
        initialAgentProvider={agentProvider}
        initialAgentModel={agent.model ?? ""}
        initialAgentBaseUrl={agent.base_url ?? ""}
      />
    </div>
  );
}
