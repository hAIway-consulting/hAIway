import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { listOrganizations } from "@/lib/db/queries/admin";
import {
  listAllAutomations,
  automationHealth,
  listTemplates,
  listOrgProviderConnections,
  type PlatformAutomation,
  type AutomationTemplate,
} from "@/lib/db/queries/admin-cockpit";
import { createTemplate, updateTemplate, instantiateTemplate } from "./actions";

export const dynamic = "force-dynamic";

// Cross-tenant view (admin spec §3): STRICT platform gate — the soft /admin
// layout gate lets org admins through and must not be relied on here.

const CONNECTED_STATUSES = new Set(["connected", "active"]);

export default async function AutomationLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  if (!(await isPlatformAdmin().catch(() => false))) redirect("/");

  const sp = await searchParams;
  const [automations, health, templates, orgs, connections] = await Promise.all([
    listAllAutomations(),
    automationHealth(14),
    listTemplates(),
    listOrganizations(),
    listOrgProviderConnections(),
  ]);

  // Group instances by key — the same automation rolled out to many tenants.
  const byKey = new Map<string, PlatformAutomation[]>();
  for (const a of automations) {
    const list = byKey.get(a.key) ?? [];
    list.push(a);
    byKey.set(a.key, list);
  }

  const connectedProviders = new Set(
    connections
      .filter((c) => CONNECTED_STATUSES.has(c.status))
      .map((c) => `${c.organization_id}:${c.provider_id}`),
  );
  const healthByInstance = new Map(
    health.map((h) => [`${h.organization_id}:${h.workflow_key}`, h] as const),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Bibliothek · Automatisierungen
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Automatisierungs-Bibliothek (cross-tenant)
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Alle Automatisierungen über alle Kunden, gruppiert nach Key — plus Templates als
          Startpunkt für neue Instanzen. Jede Instanz bleibt tenant-scoped und individuell.
        </p>
      </header>

      {sp.error && <Notice tone="danger" text={sp.error} />}
      {sp.ok && <Notice tone="ok" text={sp.ok} />}

      {/* ── Katalog ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Katalog ({automations.length} Instanzen · {byKey.size} Keys)
        </h2>

        {byKey.size === 0 ? (
          <Panel>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Noch keine Automatisierungen — erscheint, sobald die Cockpit-Migrationen gepusht
              und erste Instanzen angelegt sind.
            </p>
          </Panel>
        ) : (
          [...byKey.entries()].map(([key, instances]) => (
            <Panel key={key}>
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <div className="flex items-baseline gap-2 min-w-0">
                  <h3 className="text-base font-semibold truncate" style={{ color: "var(--color-text)" }}>
                    {instances[0].name}
                  </h3>
                  <code className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg-elevated)", color: "var(--color-muted)" }}>
                    {key}
                  </code>
                </div>
                <span className="text-xs shrink-0" style={{ color: "var(--color-muted)" }}>
                  {instances.length} {instances.length === 1 ? "Kunde" : "Kunden"}
                </span>
              </div>

              <ul className="flex flex-col gap-2">
                {instances.map((a) => {
                  const h = healthByInstance.get(`${a.organization_id}:${a.key}`);
                  return (
                    <li
                      key={a.id}
                      className="rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4 min-h-[44px]"
                      style={{ background: "var(--color-bg)" }}
                    >
                      <StatusPill status={a.status} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                          {a.org_name}
                        </div>
                        <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                          Berater: {a.owner_name ?? "—"}
                          {a.template_id ? " · aus Template" : ""}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {a.requires.length === 0 ? (
                          <span className="text-xs" style={{ color: "var(--color-placeholder)" }}>
                            Keine Provider nötig
                          </span>
                        ) : (
                          a.requires.map((provider) => {
                            const blocked = !connectedProviders.has(`${a.organization_id}:${provider}`);
                            return (
                              <span
                                key={provider}
                                title={blocked ? "Provider nicht verbunden — Blocker" : "Provider verbunden"}
                                className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full"
                                style={{
                                  background: blocked ? "var(--color-danger-soft, var(--color-bg-elevated))" : "var(--color-bg-elevated)",
                                  color: blocked ? "var(--color-danger)" : "var(--color-muted)",
                                }}
                              >
                                {provider}
                                {blocked ? " ⚠" : ""}
                              </span>
                            );
                          })
                        )}
                      </div>
                      <div className="text-xs shrink-0" style={{ color: h && h.failed > 0 ? "var(--color-danger)" : "var(--color-muted)" }}>
                        {h ? `${h.failed}/${h.total} fehlgeschlagen (14 T.)` : "Keine Läufe (14 T.)"}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))
        )}
      </section>

      {/* ── Templates ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Templates ({templates.length})
        </h2>

        {templates.length === 0 && (
          <Panel>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Noch keine Templates — lege unten das erste an.
            </p>
          </Panel>
        )}

        {templates.map((t) => (
          <Panel key={t.id}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2 min-w-0">
                <h3 className="text-base font-semibold truncate" style={{ color: "var(--color-text)" }}>
                  {t.name}
                </h3>
                <code className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg-elevated)", color: "var(--color-muted)" }}>
                  {t.key}
                </code>
              </div>
              <span className="text-xs shrink-0" style={{ color: "var(--color-muted)" }}>
                v{t.version}
                {t.industry_tag ? ` · ${t.industry_tag}` : ""}
              </span>
            </div>
            {t.description && (
              <p className="text-[13px] mt-1" style={{ color: "var(--color-muted)" }}>
                {t.description}
              </p>
            )}
            {t.requires.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {t.requires.map((p) => (
                  <span
                    key={p}
                    className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={{ background: "var(--color-bg-elevated)", color: "var(--color-muted)" }}
                  >
                    {p}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-col md:flex-row md:items-center gap-3 mt-4 pt-3 border-t" style={{ borderColor: "var(--color-line-soft, var(--color-line))" }}>
              <form action={instantiateTemplate.bind(null, t.id)} className="flex items-center gap-2 flex-wrap">
                <select
                  name="organization_id"
                  required
                  defaultValue=""
                  className="min-h-[44px] rounded-lg px-3 text-sm"
                  style={{ background: "var(--color-panel-strong, var(--color-bg))", border: "1px solid var(--color-line)", color: "var(--color-text)" }}
                >
                  <option value="" disabled>
                    Kunde wählen …
                  </option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="min-h-[44px] px-4 rounded-lg text-sm font-medium"
                  style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
                >
                  Für Kunde instanziieren
                </button>
              </form>
              <span className="text-[11px]" style={{ color: "var(--color-placeholder)" }}>
                Instanz wird gestoppt angelegt — Aktivierung übernimmt der Berater.
              </span>
            </div>

            <details className="mt-3">
              <summary className="text-sm font-medium cursor-pointer min-h-[44px] flex items-center" style={{ color: "var(--color-accent)" }}>
                Template bearbeiten
              </summary>
              <TemplateForm action={updateTemplate.bind(null, t.id)} template={t} submitLabel="Speichern" />
            </details>
          </Panel>
        ))}

        <Panel>
          <details>
            <summary className="text-sm font-medium cursor-pointer min-h-[44px] flex items-center" style={{ color: "var(--color-accent)" }}>
              Neues Template anlegen
            </summary>
            <TemplateForm action={createTemplate} submitLabel="Template anlegen" />
          </details>
        </Panel>
      </section>
    </div>
  );
}

function TemplateForm({
  action,
  template,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  template?: AutomationTemplate;
  submitLabel: string;
}) {
  const inputStyle = {
    background: "var(--color-panel-strong, var(--color-bg))",
    border: "1px solid var(--color-line)",
    color: "var(--color-text)",
  } as const;

  return (
    <form action={action} className="flex flex-col gap-3 mt-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Key">
          <input name="key" required defaultValue={template?.key ?? ""} placeholder="reklamations-orchestrator" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
        </Field>
        <Field label="Name">
          <input name="name" required defaultValue={template?.name ?? ""} placeholder="Reklamations-Orchestrator" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
        </Field>
      </div>
      <Field label="Beschreibung">
        <input name="description" defaultValue={template?.description ?? ""} placeholder="Was die Automatisierung für den Kunden erledigt" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Benötigte Provider (Komma-getrennt)">
          <input name="requires" defaultValue={template?.requires.join(", ") ?? ""} placeholder="shopware, trello" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
        </Field>
        <Field label="Branchen-Tag (optional)">
          <input name="industry_tag" defaultValue={template?.industry_tag ?? ""} placeholder="e-commerce" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
        </Field>
      </div>
      <Field label="Default-Konfiguration (JSON-Objekt)">
        <textarea
          name="default_config"
          rows={5}
          defaultValue={template ? JSON.stringify(template.default_config, null, 2) : ""}
          placeholder='{ "board": "Reklamationen" }'
          className="w-full rounded-lg px-3 py-2.5 text-sm font-mono"
          style={inputStyle}
        />
      </Field>
      <button
        type="submit"
        className="self-start min-h-[44px] px-4 rounded-lg text-sm font-medium"
        style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
      >
        {submitLabel}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-placeholder)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span
      className="text-xs px-2 py-1 rounded-full font-medium self-start"
      style={{
        background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
        color: active ? "var(--color-accent)" : "var(--color-muted)",
      }}
    >
      {active ? "aktiv" : "gestoppt"}
    </span>
  );
}

function Notice({ tone, text }: { tone: "danger" | "ok"; text: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: tone === "danger" ? "var(--color-danger-soft, var(--color-bg-elevated))" : "var(--color-accent-soft)",
        border: "1px solid var(--color-line)",
      }}
    >
      <p className="text-sm" style={{ color: tone === "danger" ? "var(--color-danger)" : "var(--color-success, var(--color-accent))" }}>
        {text}
      </p>
    </div>
  );
}
