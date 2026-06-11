import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { listOrganizations } from "@/lib/db/queries/admin";
import { listLibrarySkills } from "@/lib/db/queries/admin-cockpit";
import { table } from "@/components/ui/table-classes";
import { createLibrarySkill, assignSkillToOrg } from "./actions";

export const dynamic = "force-dynamic";

// Cross-tenant view (admin spec §4): STRICT platform gate — the soft /admin
// layout gate lets org admins through and must not be relied on here.

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  in_review: "In Prüfung",
  approved: "Freigegeben",
  active: "Aktiv",
  rejected: "Abgelehnt",
};

export default async function SkillLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  if (!(await isPlatformAdmin().catch(() => false))) redirect("/");

  const sp = await searchParams;
  const [skills, orgs] = await Promise.all([listLibrarySkills(), listOrganizations()]);

  const inputStyle = {
    background: "var(--color-panel-strong, var(--color-bg))",
    border: "1px solid var(--color-line)",
    color: "var(--color-text)",
  } as const;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Bibliothek · Skills
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Skill-Bibliothek (branchen-scoped)
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Wiederverwendbare Bausteine ohne Tenant-Bezug. Die Zuweisung an einen Kunden erzeugt
          eine tenant-scoped Kopie im Status Entwurf — Freigabe und Aktivierung bleiben beim
          Berater, der Rollout allein schaltet nichts frei.
        </p>
      </header>

      {sp.error && <Notice tone="danger" text={sp.error} />}
      {sp.ok && <Notice tone="ok" text={sp.ok} />}

      <div className="rounded-xl overflow-hidden" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead>
              <tr style={{ background: "var(--color-bg-elevated)" }}>
                <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Skill</th>
                <th className={`${table.th} hidden md:table-cell`} style={{ color: "var(--color-text-secondary)" }}>Branche</th>
                <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Version</th>
                <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Status</th>
                <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Rollout</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr key={s.id} className={table.tr} style={{ borderColor: "var(--color-line)" }}>
                  <td className={table.td}>
                    <div className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                      {s.name}
                    </div>
                    {s.description && (
                      <div className="text-xs mt-0.5 max-w-md" style={{ color: "var(--color-muted)" }}>
                        {s.description}
                      </div>
                    )}
                  </td>
                  <td className={`${table.td} hidden md:table-cell`} style={{ color: "var(--color-muted)" }}>
                    {s.industry_scope ?? "—"}
                  </td>
                  <td className={table.td} style={{ color: "var(--color-muted)" }}>
                    v{s.version}
                  </td>
                  <td className={table.td}>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: s.status === "active" ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                        color: s.status === "active" ? "var(--color-accent)" : "var(--color-muted)",
                      }}
                    >
                      {STATUS_LABELS[s.status] ?? s.status}
                    </span>
                  </td>
                  <td className={table.td}>
                    <form action={assignSkillToOrg.bind(null, s.id)} className="flex items-center gap-2 flex-wrap">
                      <select
                        name="organization_id"
                        required
                        defaultValue=""
                        className="min-h-[44px] rounded-lg px-3 text-sm"
                        style={inputStyle}
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
                        style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                      >
                        Zuweisen
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {skills.length === 0 && (
          <div className="p-8 text-center text-sm" style={{ color: "var(--color-muted)" }}>
            Noch keine Bibliotheks-Skills — lege unten den ersten an. (Erscheint erst nach dem
            Migrations-Push der Cockpit-Tabellen.)
          </div>
        )}
      </div>

      <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
        <details>
          <summary className="text-sm font-medium cursor-pointer min-h-[44px] flex items-center" style={{ color: "var(--color-accent)" }}>
            Neuen Bibliotheks-Skill anlegen
          </summary>
          <form action={createLibrarySkill} className="flex flex-col gap-3 mt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Name">
                <input name="name" required placeholder="Angebots-Zusammenfassung" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
              </Field>
              <Field label="Branchen-Scope (optional)">
                <input name="industry_scope" placeholder="e-commerce" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
              </Field>
            </div>
            <Field label="Beschreibung">
              <input name="description" placeholder="Was der Skill erledigt" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
            </Field>
            <Field label="Prompt-Template">
              <textarea
                name="prompt_template"
                required
                rows={5}
                placeholder="Du bist … Nutze {{input}} und erstelle …"
                className="w-full rounded-lg px-3 py-2.5 text-sm font-mono"
                style={inputStyle}
              />
            </Field>
            <Field label="Tool-Referenzen (Komma-getrennt, aus der Tool-Registry)">
              <input name="tool_refs" placeholder="search_documents, create_trello_card" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
            </Field>
            <button
              type="submit"
              className="self-start min-h-[44px] px-4 rounded-lg text-sm font-medium"
              style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
            >
              Skill anlegen (Entwurf)
            </button>
          </form>
        </details>
      </div>
    </div>
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
