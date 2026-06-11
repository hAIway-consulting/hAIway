import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import {
  listPlatformKeys,
  listTenantKeyAssignments,
} from "@/lib/db/queries/admin-cockpit";
import { table } from "@/components/ui/table-classes";
import { createPlatformKey, disableKey, rotatePlatformKey } from "./actions";

export const dynamic = "force-dynamic";

// Provider-/Key-Management (admin spec §5): STRICT platform gate — the soft
// /admin layout gate lets org admins through and must not be relied on here.
// Page props never contain key material: queries select key_hint only.

const KNOWN_PROVIDERS = ["anthropic", "openai"];

export default async function AiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  if (!(await isPlatformAdmin().catch(() => false))) redirect("/");

  const sp = await searchParams;
  const [platformKeys, assignments] = await Promise.all([
    listPlatformKeys(),
    listTenantKeyAssignments(),
  ]);

  const providers = [
    ...new Set([
      ...KNOWN_PROVIDERS,
      ...platformKeys.map((k) => k.provider),
      ...assignments.flatMap((a) => a.keys.map((k) => k.provider)),
    ]),
  ].sort();

  const activePlatformProviders = new Set(
    platformKeys.filter((k) => k.status === "active").map((k) => k.provider),
  );

  const inputStyle = {
    background: "var(--color-panel-strong, var(--color-bg))",
    border: "1px solid var(--color-line)",
    color: "var(--color-text)",
  } as const;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Plattform · AI-Keys
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Provider- &amp; Key-Management
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Plattform-Keys (Fallback für alle Tenants ohne eigene Zuweisung) plus die Übersicht,
          welcher Kunde über welchen Key läuft. Keys werden verschlüsselt gespeichert — hier ist
          nur der Hint sichtbar, der Klartext verlässt den Server nie.
        </p>
      </header>

      {sp.error && <Notice tone="danger" text={sp.error} />}
      {sp.ok && <Notice tone="ok" text={sp.ok} />}

      {/* ── Plattform-Keys ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Plattform-Keys ({platformKeys.length})
        </h2>

        <div className="rounded-xl overflow-hidden" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead>
                <tr style={{ background: "var(--color-bg-elevated)" }}>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Provider</th>
                  <th className={`${table.th} hidden md:table-cell`} style={{ color: "var(--color-text-secondary)" }}>Name</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Key</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Status</th>
                  <th className={`${table.th} hidden md:table-cell`} style={{ color: "var(--color-text-secondary)" }}>Rotiert am</th>
                  <th className={`${table.th} hidden md:table-cell`} style={{ color: "var(--color-text-secondary)" }}>Constraints</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {platformKeys.map((k) => (
                  <tr key={k.id} className={table.tr} style={{ borderColor: "var(--color-line)" }}>
                    <td className={`${table.td} text-sm font-medium`} style={{ color: "var(--color-text)" }}>
                      {k.provider}
                    </td>
                    <td className={`${table.td} hidden md:table-cell text-sm`} style={{ color: "var(--color-muted)" }}>
                      {k.name || "—"}
                    </td>
                    <td className={table.td}>
                      <code className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg-elevated)", color: "var(--color-muted)" }}>
                        {k.key_hint || "…"}
                      </code>
                    </td>
                    <td className={table.td}>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: k.status === "active" ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                          color: k.status === "active" ? "var(--color-accent)" : "var(--color-muted)",
                        }}
                      >
                        {k.status === "active" ? "aktiv" : "deaktiviert"}
                      </span>
                    </td>
                    <td className={`${table.td} hidden md:table-cell text-xs`} style={{ color: "var(--color-muted)" }}>
                      {k.rotated_at ? new Date(k.rotated_at).toLocaleString("de-DE") : "—"}
                    </td>
                    <td className={`${table.td} hidden md:table-cell`}>
                      <ConstraintBadges constraints={k.constraints} />
                    </td>
                    <td className={table.td}>
                      {k.status === "active" ? (
                        <div className="flex flex-col gap-2">
                          <details>
                            <summary className="text-xs font-medium cursor-pointer min-h-[44px] flex items-center" style={{ color: "var(--color-accent)" }}>
                              Rotieren
                            </summary>
                            <form action={rotatePlatformKey.bind(null, k.id)} className="flex items-center gap-2 mt-1">
                              <input
                                type="password"
                                name="raw_key"
                                required
                                autoComplete="off"
                                placeholder="Neuer Key"
                                className="min-h-[44px] rounded-lg px-3 text-sm w-44"
                                style={inputStyle}
                              />
                              <button
                                type="submit"
                                className="min-h-[44px] px-3 rounded-lg text-xs font-semibold"
                                style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
                              >
                                Rotieren
                              </button>
                            </form>
                          </details>
                          <form action={disableKey.bind(null, k.id)}>
                            <button
                              type="submit"
                              className="min-h-[44px] px-3 rounded-lg text-xs font-semibold"
                              style={{ background: "var(--color-bg-elevated)", color: "var(--color-danger)" }}
                            >
                              Deaktivieren
                            </button>
                          </form>
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--color-placeholder)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {platformKeys.length === 0 && (
            <div className="p-8 text-center text-sm" style={{ color: "var(--color-muted)" }}>
              Noch keine Plattform-Keys — Env-Keys bleiben als Fallback aktiv, bis hier Keys
              hinterlegt sind. (Tabelle erscheint nach dem Migrations-Push.)
            </div>
          )}
        </div>

        <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
          <details>
            <summary className="text-sm font-medium cursor-pointer min-h-[44px] flex items-center" style={{ color: "var(--color-accent)" }}>
              Neuen Plattform-Key anlegen
            </summary>
            <form action={createPlatformKey} className="flex flex-col gap-3 mt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Provider">
                  <input
                    name="provider"
                    required
                    list="provider-options"
                    placeholder="anthropic"
                    autoComplete="off"
                    className="min-h-[44px] w-full rounded-lg px-3 text-sm"
                    style={inputStyle}
                  />
                  <datalist id="provider-options">
                    {providers.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Name (optional)">
                  <input name="name" placeholder="Produktions-Key EU" className="min-h-[44px] w-full rounded-lg px-3 text-sm" style={inputStyle} />
                </Field>
              </div>
              <Field label="API-Key (wird verschlüsselt gespeichert, nie wieder angezeigt)">
                <input
                  type="password"
                  name="raw_key"
                  required
                  autoComplete="off"
                  placeholder="sk-…"
                  className="min-h-[44px] w-full rounded-lg px-3 text-sm"
                  style={inputStyle}
                />
              </Field>
              <Field label="Constraints (JSON-Objekt, optional)">
                <textarea
                  name="constraints"
                  rows={3}
                  placeholder='{ "eu_only": true }'
                  className="w-full rounded-lg px-3 py-2.5 text-sm font-mono"
                  style={inputStyle}
                />
              </Field>
              <button
                type="submit"
                className="self-start min-h-[44px] px-4 rounded-lg text-sm font-medium"
                style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
              >
                Key anlegen
              </button>
            </form>
          </details>
        </div>
      </section>

      {/* ── Tenant-Zuweisungen ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Tenant-Zuweisungen
        </h2>

        <div className="rounded-xl overflow-hidden" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead>
                <tr style={{ background: "var(--color-bg-elevated)" }}>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Kunde</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Default-Modell</th>
                  {providers.map((p) => (
                    <th key={p} className={table.th} style={{ color: "var(--color-text-secondary)" }}>
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.organization_id} className={table.tr} style={{ borderColor: "var(--color-line)" }}>
                    <td className={`${table.td} text-sm font-medium`} style={{ color: "var(--color-text)" }}>
                      {a.org_name}
                    </td>
                    <td className={`${table.td} text-xs`} style={{ color: "var(--color-muted)" }}>
                      {a.default_model ?? "Standard"}
                    </td>
                    {providers.map((p) => {
                      const tenantKey = a.keys.find((k) => k.provider === p && k.status === "active");
                      return (
                        <td key={p} className={table.td}>
                          {tenantKey ? (
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                              <code className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg-elevated)", color: "var(--color-text)" }}>
                                {tenantKey.key_hint || "…"}
                              </code>
                              <ConstraintBadges constraints={tenantKey.constraints} hideEmpty />
                            </span>
                          ) : activePlatformProviders.has(p) ? (
                            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                              Plattform
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: "var(--color-placeholder)" }}>
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {assignments.length === 0 && (
            <div className="p-8 text-center text-sm" style={{ color: "var(--color-muted)" }}>
              Keine Kunden gefunden.
            </div>
          )}
        </div>
        <p className="text-[11px]" style={{ color: "var(--color-placeholder)" }}>
          „Plattform“ = Tenant läuft über den aktiven Plattform-Key · „—“ = kein Key hinterlegt
          (Env-Fallback, sofern konfiguriert).
        </p>
      </section>
    </div>
  );
}

function ConstraintBadges({
  constraints,
  hideEmpty,
}: {
  constraints: Record<string, unknown>;
  hideEmpty?: boolean;
}) {
  const entries = Object.entries(constraints ?? {});
  if (entries.length === 0) {
    return hideEmpty ? null : <span className="text-xs" style={{ color: "var(--color-placeholder)" }}>—</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: "var(--color-bg-elevated)", color: "var(--color-warning, var(--color-muted))" }}
        >
          {value === true ? key : `${key}: ${String(value)}`}
        </span>
      ))}
    </span>
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
