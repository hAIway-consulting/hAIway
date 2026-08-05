import { createServiceClient } from "@/lib/db/supabase-server";
import { requireOrgId, getMemberRole, ORG_MANAGER_ROLES } from "@/lib/db/org-context";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  saveTwentyConnection,
  testTwentyConnection,
  saveRoleMap,
  addRoleMapLevel,
  removeRoleMapLevel,
  setCrmLevel,
  reconcileCrm,
} from "./actions";

export const dynamic = "force-dynamic";

interface RoleMapEntry {
  twenty_role_id: string;
  label?: string;
}

interface DriftReport {
  checked_at: string;
  only_in_twenty: Array<{ email: string; workspace_member_id: string }>;
  missing_in_twenty: Array<{ email: string; level: string }>;
  role_mismatch: Array<{ email: string; expected_role_id: string; actual_role_id: string | null }>;
}

interface TwentyConfig {
  base_url?: string;
  role_map?: Record<string, RoleMapEntry>;
  available_roles?: Array<{ id: string; label: string }>;
  service_login_ok?: boolean;
  last_drift?: DriftReport;
}

interface MemberRow {
  user_id: string;
  role: string;
  profiles: { full_name: string | null; email: string | null } | null;
}

interface PermissionRow {
  user_id: string;
  level: string;
  sync_status: string;
  external_invite_status: string | null;
  sync_error: string | null;
  last_synced_at: string | null;
}

export default async function CrmAdminPage() {
  const orgId = await requireOrgId();
  const [platformAdmin, role] = await Promise.all([
    isPlatformAdmin().catch(() => false),
    getMemberRole().catch(() => null),
  ]);
  const canManage = platformAdmin || (!!role && ORG_MANAGER_ROLES.includes(role));

  const db = createServiceClient();
  const [{ data: integration }, { data: membersRaw }, { data: permissionsRaw }] =
    await Promise.all([
      db
        .from("organization_integrations")
        .select("status, error_message, last_synced_at, credentials, config")
        .eq("organization_id", orgId)
        .eq("provider_id", "twenty")
        .maybeSingle<{
          status: string;
          error_message: string | null;
          last_synced_at: string | null;
          credentials: Record<string, string>;
          config: TwentyConfig;
        }>(),
      db
        .from("organization_members")
        .select("user_id, role, profiles:user_id (full_name, email)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true }),
      db
        .from("member_app_permissions")
        .select("user_id, level, sync_status, external_invite_status, sync_error, last_synced_at")
        .eq("organization_id", orgId)
        .eq("app_key", "crm"),
    ]);

  const members = (membersRaw ?? []) as unknown as MemberRow[];
  const permissions = new Map(
    ((permissionsRaw ?? []) as PermissionRow[]).map((p) => [p.user_id, p] as const),
  );
  const config: TwentyConfig = integration?.config ?? {};
  const roleMap = config.role_map ?? {};
  const availableRoles = config.available_roles ?? [];
  const levelKeys = Object.keys(roleMap);
  const hasApiKey = !!integration?.credentials?.api_key;
  const hasServiceLogin =
    !!integration?.credentials?.service_email && !!integration?.credentials?.service_password;
  const drift = config.last_drift ?? null;
  const manualRows = ((permissionsRaw ?? []) as PermissionRow[]).filter(
    (p) => p.sync_status === "manual_required",
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span
          className="text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--color-placeholder)" }}
        >
          Berater · CRM
        </span>
        <h1
          className="text-2xl md:text-3xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
        >
          CRM-Zugänge (Twenty)
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Zentrale Zugriffsverwaltung für das selbst gehostete Twenty CRM. Berechtigungen werden
          automatisch synchronisiert — hAIway ist die Quelle der Wahrheit.
        </p>
      </header>

      {!canManage && (
        <Card>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Nur Admins und Owner der Organisation können CRM-Zugänge verwalten. Wende dich an
            deine Administratorin / deinen Administrator.
          </p>
        </Card>
      )}

      {/* Verbindung */}
      <Card title="Verbindung">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <StatusBadge
            tone={
              integration?.status === "active"
                ? "success"
                : integration?.status === "error"
                  ? "danger"
                  : "warning"
            }
            label={
              !integration
                ? "Nicht verbunden"
                : integration.status === "active"
                  ? "Verbunden"
                  : integration.status === "error"
                    ? "Fehler"
                    : "Setup unvollständig"
            }
          />
          {integration?.last_synced_at && (
            <span className="text-[11px]" style={{ color: "var(--color-placeholder)" }}>
              Letzter Abgleich: {new Date(integration.last_synced_at).toLocaleString("de-DE")}
            </span>
          )}
          {hasServiceLogin && config.service_login_ok === false && (
            <StatusBadge tone="warning" label="Service-Login fehlgeschlagen" />
          )}
        </div>
        {integration?.error_message && (
          <p className="text-[12px] mb-4" style={{ color: "var(--color-danger)" }}>
            {integration.error_message}
          </p>
        )}
        {canManage && (
          <>
            <form action={saveTwentyConnection} className="flex flex-col gap-4">
              <Field label="Twenty-URL">
                <input
                  type="text"
                  name="base_url"
                  required
                  defaultValue={config.base_url ?? ""}
                  placeholder="https://crm.example.com"
                  className="min-h-[44px] rounded-lg px-3 text-sm w-full"
                  style={inputStyle}
                />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label={hasApiKey ? "API Key (gesetzt — leer = unverändert)" : "API Key"}>
                  <input
                    type="password"
                    name="api_key"
                    placeholder={hasApiKey ? "••••••••" : "Aus Twenty: Settings → API"}
                    className="min-h-[44px] rounded-lg px-3 text-sm w-full"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Service-Login E-Mail (für Einladungen)">
                  <input
                    type="text"
                    name="service_email"
                    defaultValue={integration?.credentials?.service_email ?? ""}
                    placeholder="service@example.com"
                    className="min-h-[44px] rounded-lg px-3 text-sm w-full"
                    style={inputStyle}
                  />
                </Field>
                <Field
                  label={
                    hasServiceLogin
                      ? "Service-Login Passwort (leer = unverändert)"
                      : "Service-Login Passwort"
                  }
                >
                  <input
                    type="password"
                    name="service_password"
                    placeholder={hasServiceLogin ? "••••••••" : ""}
                    className="min-h-[44px] rounded-lg px-3 text-sm w-full"
                    style={inputStyle}
                  />
                </Field>
              </div>
              <p className="text-[11px]" style={{ color: "var(--color-placeholder)" }}>
                Ohne Service-Login können Einladungen nicht automatisch verschickt werden
                (Twenty-Einschränkung) — Zugänge erscheinen dann als „Manuell einladen“.
              </p>
              <div className="flex gap-2 flex-wrap">
                <SubmitButton label="Speichern & testen" pendingLabel="Teste Verbindung..." />
              </div>
            </form>
            {integration && (
              <form action={testTwentyConnection} className="mt-2">
                <button type="submit" className="min-h-[44px] px-4 rounded-lg text-sm font-medium" style={softButtonStyle}>
                  Verbindung erneut testen
                </button>
              </form>
            )}
          </>
        )}
      </Card>

      {/* Rollen-Mapping */}
      <Card title="Berechtigungsstufen → Twenty-Rollen">
        <p className="text-[12px] mb-4" style={{ color: "var(--color-muted)" }}>
          Jede Stufe wird auf eine Twenty-Rolle gemappt. Neue Stufen kannst du jederzeit ohne
          Code-Änderung ergänzen — sie erscheinen sofort in der Mitgliederliste.
        </p>
        {availableRoles.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-placeholder)" }}>
            Noch keine Rollen geladen — zuerst oben die Verbindung speichern & testen.
          </p>
        ) : canManage ? (
          <form action={saveRoleMap} className="flex flex-col gap-3">
            {levelKeys.map((level) => (
              <div key={level} className="flex items-center gap-2 flex-wrap">
                <input type="hidden" name="level_name" value={level} />
                <span
                  className="min-w-[120px] text-sm font-medium px-3 py-2 rounded-lg"
                  style={{ background: "var(--color-bg-elevated)", color: "var(--color-text)" }}
                >
                  {level}
                </span>
                <select
                  name="level_role"
                  defaultValue={roleMap[level]?.twenty_role_id}
                  className="min-h-[44px] rounded-lg px-3 text-sm flex-1 min-w-[160px]"
                  style={inputStyle}
                >
                  {availableRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  formAction={removeRoleMapLevel}
                  name="remove_level"
                  value={level}
                  title={`Stufe "${level}" entfernen (nur möglich, wenn niemand sie nutzt)`}
                  className="min-h-[44px] min-w-[44px] rounded-lg text-sm font-medium"
                  style={{ background: "var(--color-danger-soft)", color: "var(--color-danger)" }}
                >
                  ✕
                </button>
              </div>
            ))}
            <div
              className="flex items-center gap-2 flex-wrap pt-3 border-t"
              style={{ borderColor: "var(--color-line-soft)" }}
            >
              <input
                type="text"
                name="new_level_name"
                placeholder="neue-stufe (z. B. readonly)"
                className="min-h-[44px] rounded-lg px-3 text-sm min-w-[160px]"
                style={inputStyle}
              />
              <select
                name="new_level_role"
                className="min-h-[44px] rounded-lg px-3 text-sm flex-1 min-w-[160px]"
                style={inputStyle}
              >
                {availableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                formAction={addRoleMapLevel}
                className="min-h-[44px] px-4 rounded-lg text-sm font-medium"
                style={softButtonStyle}
              >
                Stufe hinzufügen
              </button>
            </div>
            {levelKeys.length > 0 && (
              <div>
                <SubmitButton label="Mapping speichern" pendingLabel="Speichere..." />
              </div>
            )}
          </form>
        ) : (
          <ul className="flex flex-col gap-1">
            {levelKeys.map((level) => (
              <li key={level} className="text-sm" style={{ color: "var(--color-text)" }}>
                {level} → {roleMap[level]?.label ?? roleMap[level]?.twenty_role_id}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Mitglieder */}
      <Card title="Mitglieder">
        {levelKeys.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-placeholder)" }}>
            Zuerst oben mindestens eine Berechtigungsstufe anlegen.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((member) => {
              const permission = permissions.get(member.user_id);
              const currentLevel = permission?.level ?? "none";
              return (
                <li
                  key={member.user_id}
                  className="rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4"
                  style={{ background: "var(--color-bg)" }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                      {member.profiles?.full_name ?? member.profiles?.email ?? member.user_id}
                    </div>
                    <div className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                      {member.profiles?.email} · Org-Rolle: {member.role}
                    </div>
                  </div>
                  {permission && <SyncBadge permission={permission} />}
                  {canManage ? (
                    <form action={setCrmLevel} className="flex items-center gap-2">
                      <input type="hidden" name="user_id" value={member.user_id} />
                      <select
                        name="level"
                        defaultValue={currentLevel}
                        className="min-h-[44px] rounded-lg px-3 text-sm"
                        style={inputStyle}
                      >
                        <option value="none">Kein Zugriff</option>
                        {levelKeys.map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                        {currentLevel !== "none" && !levelKeys.includes(currentLevel) && (
                          <option value={currentLevel}>{currentLevel} (Stufe entfernt)</option>
                        )}
                      </select>
                      <SubmitButton label="Übernehmen" pendingLabel="Synchronisiere..." />
                    </form>
                  ) : (
                    <span className="text-sm" style={{ color: "var(--color-muted)" }}>
                      {currentLevel === "none" ? "Kein Zugriff" : currentLevel}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {manualRows.length > 0 && (
          <div
            className="mt-4 rounded-lg p-3 text-[12px]"
            style={{ background: "var(--color-warning-soft)", color: "var(--color-warning)" }}
          >
            <strong>Manuell einladen:</strong> Für{" "}
            {manualRows.length === 1 ? "ein Mitglied" : `${manualRows.length} Mitglieder`} konnte
            keine automatische Einladung verschickt werden (kein funktionierender Service-Login).
            In Twenty unter Settings → Members einladen, danach „Jetzt abgleichen“ — die Rolle wird
            dann automatisch gesetzt.
          </div>
        )}
      </Card>

      {/* Abgleich */}
      <Card title="Abgleich mit Twenty">
        {canManage && (
          <form action={reconcileCrm} className="mb-4">
            <SubmitButton label="Jetzt abgleichen" pendingLabel="Gleiche ab..." />
          </form>
        )}
        {!drift ? (
          <p className="text-sm" style={{ color: "var(--color-placeholder)" }}>
            Noch kein Abgleich gelaufen.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[11px]" style={{ color: "var(--color-placeholder)" }}>
              Stand: {new Date(drift.checked_at).toLocaleString("de-DE")}
            </p>
            <DriftList
              title="In Twenty, aber ohne hAIway-Freigabe"
              tone="danger"
              items={drift.only_in_twenty.map((d) => d.email)}
              emptyText="Keine — alle Twenty-Mitglieder sind freigegeben."
            />
            <DriftList
              title="Freigegeben, aber nicht in Twenty"
              tone="warning"
              items={drift.missing_in_twenty.map((d) => `${d.email} (${d.level})`)}
              emptyText="Keine — alle Freigaben sind in Twenty angekommen."
            />
            <DriftList
              title="Rollen-Abweichungen (nicht automatisch korrigierbar)"
              tone="warning"
              items={drift.role_mismatch.map((d) => d.email)}
              emptyText="Keine Rollen-Abweichungen."
            />
          </div>
        )}
      </Card>
    </div>
  );
}

const inputStyle = {
  background: "var(--color-bg)",
  border: "1px solid var(--color-line)",
  color: "var(--color-text)",
} as const;

const softButtonStyle = {
  background: "var(--color-accent-soft)",
  color: "var(--color-accent)",
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium" style={{ color: "var(--color-muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl p-5"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      {title && (
        <h2 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function StatusBadge({ tone, label }: { tone: "success" | "warning" | "danger"; label: string }) {
  const color =
    tone === "success"
      ? "var(--color-success)"
      : tone === "warning"
        ? "var(--color-warning)"
        : "var(--color-danger)";
  const bg =
    tone === "success"
      ? "var(--color-success-soft)"
      : tone === "warning"
        ? "var(--color-warning-soft)"
        : "var(--color-danger-soft)";
  return (
    <span
      className="text-[11px] px-2 py-1 rounded-full font-medium"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

function SyncBadge({ permission }: { permission: PermissionRow }) {
  const map: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
    synced: { label: "Synchronisiert", tone: "success" },
    pending: {
      label: permission.external_invite_status === "invited" ? "Einladung offen" : "Ausstehend",
      tone: "warning",
    },
    manual_required: { label: "Manuell einladen", tone: "warning" },
    revoking: { label: "Wird entzogen", tone: "warning" },
    error: { label: "Fehler", tone: "danger" },
  };
  const entry = map[permission.sync_status] ?? { label: permission.sync_status, tone: "warning" as const };
  return (
    <span title={permission.sync_error ?? undefined}>
      <StatusBadge tone={entry.tone} label={entry.label} />
    </span>
  );
}

function DriftList({
  title,
  tone,
  items,
  emptyText,
}: {
  title: string;
  tone: "warning" | "danger";
  items: string[];
  emptyText: string;
}) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold mb-1" style={{ color: "var(--color-text)" }}>
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--color-placeholder)" }}>
          {emptyText}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item}
              className="text-[12px]"
              style={{ color: tone === "danger" ? "var(--color-danger)" : "var(--color-warning)" }}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
