import { getAdminStats, listOrganizations, getPlatformOrganization } from "@/lib/db/queries/admin";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  // Cross-tenant view: STRICT platform gate — the soft /admin layout gate lets
  // Berater/Org-Admins through and must not be relied on here. All three
  // queries below run on the service-role client and return every customer org.
  if (!(await isPlatformAdmin().catch(() => false))) redirect("/");

  const [stats, orgs, platformOrg] = await Promise.all([
    getAdminStats(),
    listOrganizations(),
    getPlatformOrganization(),
  ]);

  const recentOrgs = orgs.slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      {/* Mein Unternehmen */}
      {platformOrg && (
        <Link
          href="/organisation"
          className="rounded-xl p-5 flex items-center justify-between"
          style={{
            background: "var(--color-accent-soft)",
            border: "1px solid var(--color-accent)",
          }}
        >
          <div>
            <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: "var(--color-accent)" }}>
              Mein Unternehmen
            </p>
            <p
              className="text-lg font-semibold mt-1"
              style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
            >
              {platformOrg.name}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              {platformOrg.members.length} Team-Mitglieder · Interne Plattform-Org
            </p>
          </div>
          <span className="text-sm font-medium" style={{ color: "var(--color-accent)" }}>
            Verwalten →
          </span>
        </Link>
      )}

      {/* Stats — nur Kunden */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Kunden-Organisationen" value={stats.orgCount} />
        <StatCard label="Benutzer" value={stats.userCount} />
        <StatCard label="Quellen" value={stats.sourceCount} />
      </div>

      {/* Recent orgs */}
      <div
        className="rounded-xl p-5"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
            Letzte Kunden
          </h2>
          <Link
            href="/admin/kunden"
            className="text-sm font-medium"
            style={{ color: "var(--color-accent)" }}
          >
            Alle anzeigen
          </Link>
        </div>

        {recentOrgs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Noch keine Kunden vorhanden.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentOrgs.map((org) => (
              <li key={org.id}>
                <Link
                  href={`/admin/kunden/${org.id}`}
                  className="flex items-center justify-between min-h-[44px] px-3 rounded-lg"
                  style={{ background: "var(--color-bg)" }}
                >
                  <div>
                    <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                      {org.name}
                    </span>
                    <span className="text-xs ml-2" style={{ color: "var(--color-muted)" }}>
                      {org.slug}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                      {org.member_count} Mitglieder
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: org.status === "active" ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                        color: org.status === "active" ? "var(--color-accent)" : "var(--color-muted)",
                      }}
                    >
                      {org.status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        {label}
      </p>
      <p
        className="text-3xl font-semibold mt-1"
        style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
      >
        {value}
      </p>
    </div>
  );
}
