import { createServiceClient, createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { setToolEnabled } from "./actions";
import { categoryMeta } from "./tool-meta";

export const dynamic = "force-dynamic";

interface ToolRow {
  key:         string;
  name:        string;
  description: string;
  category:    string;
  feature_key: string | null;
  sort_order:  number;
}

interface OrgToolRow {
  tool_key: string;
  enabled:  boolean;
}

export default async function AgentToolsAdminPage() {
  const orgId = await requireOrgId();
  const service = createServiceClient();
  const userClient = await createUserClient();

  const [{ data: tools }, { data: orgTools }] = await Promise.all([
    service
      .from("agent_tools")
      .select("key, name, description, category, feature_key, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    userClient
      .from("organization_tools")
      .select("tool_key, enabled")
      .eq("organization_id", orgId),
  ]);

  const toolRows: ToolRow[] = (tools ?? []) as ToolRow[];
  const orgToolRows: OrgToolRow[] = (orgTools ?? []) as OrgToolRow[];

  // Abwesenheit = aktiv; explizit enabled=false = deaktiviert.
  const disabled = new Set(orgToolRows.filter((t) => t.enabled === false).map((t) => t.tool_key));
  const activeCount = toolRows.filter((t) => !disabled.has(t.key)).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Agenten-Werkzeuge
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Tools für den Agent-Modus
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Welche Werkzeuge der Agent im Chat nutzen darf. Aktivierte Tools tauchen automatisch im Tool-Loop auf — {activeCount} von {toolRows.length} aktiv.
        </p>
      </header>

      <section>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {toolRows.map((t) => {
            const meta = categoryMeta(t.category);
            const isEnabled = !disabled.has(t.key);
            return (
              <div
                key={t.key}
                className="rounded-xl p-5 flex flex-col gap-3"
                style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[15px] font-semibold" style={{ color: "var(--color-text)" }}>
                      {t.name}
                    </span>
                    <span className="text-[12px] leading-snug" style={{ color: "var(--color-muted)" }}>
                      {t.description}
                    </span>
                  </div>
                  <span
                    className="self-start text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: `${meta.color}18`, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 mt-auto pt-2 border-t" style={{ borderColor: "var(--color-line-soft)" }}>
                  <span
                    className="text-[11px] font-medium"
                    style={{ color: isEnabled ? "var(--color-success)" : "var(--color-placeholder)" }}
                  >
                    {isEnabled ? "Aktiv" : "Deaktiviert"}
                  </span>
                  <form action={setToolEnabled}>
                    <input type="hidden" name="tool_key" value={t.key} />
                    <input type="hidden" name="enabled" value={(!isEnabled).toString()} />
                    <button
                      type="submit"
                      className="min-h-[44px] px-4 rounded-lg text-[12px] font-semibold"
                      style={{
                        background: isEnabled ? "var(--color-bg-elevated)" : "var(--color-accent)",
                        color:      isEnabled ? "var(--color-text)"        : "var(--color-accent-text)",
                        border:     isEnabled ? "1px solid var(--color-line)" : "none",
                      }}
                    >
                      {isEnabled ? "Deaktivieren" : "Aktivieren"}
                    </button>
                  </form>
                </div>

                {t.feature_key && (
                  <span className="text-[10px]" style={{ color: "var(--color-placeholder)" }}>
                    Feature-Gate: {t.feature_key}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {toolRows.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Noch keine Tools registriert. Migration anwenden, dann erscheinen sie hier.
          </p>
        )}
      </section>
    </div>
  );
}
