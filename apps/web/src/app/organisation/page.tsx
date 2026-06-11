import { notFound, redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { getMemberRole, requireOrgId, ORG_MANAGER_ROLES } from "@/lib/db/org-context";
import { getUser } from "@/lib/db/supabase-server";
import { getOrganizationAdmin, listPlanTiers, getOrgIntegrations } from "@/lib/db/queries/admin";
import { roleOptionsFor } from "@/lib/org-roles";
import { updateOrganization } from "../admin/actions";
import { FeatureToggle } from "../admin/kunden/[id]/feature-toggle";
import { InviteForm } from "../admin/kunden/[id]/invite-form";
import { RoleSelect } from "./role-select";
import { changeMemberRole, inviteOrgMember } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Organisationseinstellungen der eigenen (aktiven) Org — erreichbar über das
 * Profil-Dropdown in der Top-Bar. Team- und Rollenverwaltung für Inhaber/Admins;
 * Stammdaten, Features und Integrationen zusätzlich für Platform-Admins.
 */
export default async function OrganisationPage() {
  const [platformAdmin, role, user] = await Promise.all([
    isPlatformAdmin().catch(() => false),
    getMemberRole().catch(() => null),
    getUser(),
  ]);

  const canManage = platformAdmin || (role !== null && ORG_MANAGER_ROLES.includes(role));
  if (!canManage) redirect("/");

  const orgId = await requireOrgId();
  const [org, planTiers, integrations] = await Promise.all([
    getOrganizationAdmin(orgId),
    listPlanTiers(),
    getOrgIntegrations(orgId),
  ]);
  if (!org) notFound();

  const plan = org.plan_id ?? "standard";
  const roleOptions = roleOptionsFor(org.is_platform);
  const updateAction = updateOrganization.bind(null, org.id);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
          Organisationseinstellungen
        </h2>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {org.name} — Team einladen, Rollen verteilen
          {platformAdmin ? ", Features schalten und Integrationen pflegen" : ""}.
        </p>
      </div>

      {/* Stammdaten — editierbar nur für Platform-Admins */}
      <section
        className="rounded-xl p-5"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
      >
        <h3 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>
          Stammdaten
        </h3>
        {platformAdmin ? (
          <form action={updateAction} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
                  Name
                </label>
                <input
                  name="name"
                  defaultValue={org.name}
                  required
                  className="min-h-[44px] px-3 rounded-lg text-sm"
                  style={{
                    border: "1px solid var(--color-line)",
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
                  Slug
                </label>
                <input
                  value={org.slug}
                  disabled
                  className="min-h-[44px] px-3 rounded-lg text-sm font-mono opacity-60"
                  style={{
                    border: "1px solid var(--color-line)",
                    background: "var(--color-bg-elevated)",
                    color: "var(--color-muted)",
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
                  Status
                </label>
                <select
                  name="status"
                  defaultValue={org.status}
                  className="min-h-[44px] px-3 rounded-lg text-sm"
                  style={{
                    border: "1px solid var(--color-line)",
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                  }}
                >
                  <option value="active">Aktiv</option>
                  <option value="inactive">Inaktiv</option>
                  <option value="suspended">Gesperrt</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
                  Plan
                </label>
                <select
                  name="plan"
                  defaultValue={plan}
                  className="min-h-[44px] px-3 rounded-lg text-sm"
                  style={{
                    border: "1px solid var(--color-line)",
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                  }}
                >
                  {planTiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <button
                type="submit"
                className="min-h-[44px] px-6 rounded-lg text-sm font-medium gradient-accent"
                style={{ color: "var(--color-accent-text)" }}
              >
                Speichern
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="font-medium" style={{ color: "var(--color-text-secondary)" }}>
                Name
              </dt>
              <dd className="mt-1" style={{ color: "var(--color-text)" }}>
                {org.name}
              </dd>
            </div>
            <div>
              <dt className="font-medium" style={{ color: "var(--color-text-secondary)" }}>
                Slug
              </dt>
              <dd className="mt-1 font-mono" style={{ color: "var(--color-muted)" }}>
                {org.slug}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* Team & Rollen */}
      <section
        className="rounded-xl p-5"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
      >
        <h3 className="text-base font-semibold mb-1" style={{ color: "var(--color-text)" }}>
          Team &amp; Rollen ({org.members.length})
        </h3>
        <p className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>
          {org.is_platform
            ? "Admin = volle Plattform-Sicht · Manager = Übersicht + Verwaltung · Berater = Arbeitsbereich (Cockpit)."
            : "Inhaber und Berater verwalten die Organisation, Mitglieder sehen den Workspace."}
        </p>

        {org.members.length > 0 && (
          <ul className="flex flex-col gap-2 mb-4">
            {org.members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 min-h-[44px] px-3 py-1.5 rounded-lg"
                style={{ background: "var(--color-bg)" }}
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {m.profile.full_name ?? "—"}
                  </span>
                  <span className="text-xs ml-2 break-all" style={{ color: "var(--color-muted)" }}>
                    {m.profile.email}
                  </span>
                </div>
                <RoleSelect
                  current={m.role}
                  options={roleOptions}
                  action={changeMemberRole.bind(null, org.id, m.id)}
                  disabled={m.user_id === user?.id}
                  disabledHint="Die eigene Rolle kann nur ein anderer Admin ändern."
                />
              </li>
            ))}
          </ul>
        )}

        <InviteForm orgId={org.id} roles={roleOptions} action={inviteOrgMember} />
      </section>

      {/* Features — nur Platform-Admin */}
      {platformAdmin && (
        <section
          className="rounded-xl p-5"
          style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
        >
          <h3 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>
            Features
          </h3>
          <ul className="flex flex-col gap-2">
            {org.features.map((f) => (
              <FeatureToggle key={f.feature_key} orgId={org.id} feature={f} />
            ))}
          </ul>
        </section>
      )}

      {/* Integrationen — nur Platform-Admin */}
      {platformAdmin && (
        <section
          className="rounded-xl p-5"
          style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
        >
          <h3 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>
            Integrationen
          </h3>
          {integrations.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Keine Integrationen konfiguriert.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {integrations.map((integration) => (
                <li
                  key={integration.id}
                  className="flex items-center justify-between min-h-[44px] px-3 rounded-lg"
                  style={{ background: "var(--color-bg)" }}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                      {integration.provider_name}
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                      {integration.category} ·{" "}
                      {integration.credential_mode === "customer" ? "Eigener Key" : "Platform-Key"}
                    </span>
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background:
                        integration.status === "active"
                          ? "var(--color-success-soft, var(--color-accent-soft))"
                          : "var(--color-bg-elevated)",
                      color:
                        integration.status === "active"
                          ? "var(--color-success, var(--color-accent))"
                          : "var(--color-muted)",
                    }}
                  >
                    {integration.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
