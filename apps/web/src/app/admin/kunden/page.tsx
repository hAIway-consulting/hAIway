import { listOrganizations } from "@/lib/db/queries/admin";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";

export const dynamic = 'force-dynamic';

export default async function KundenPage() {
  // Cross-tenant view: STRICT platform gate — the soft /admin layout gate lets
  // Berater/Org-Admins through and must not be relied on here.
  if (!(await isPlatformAdmin().catch(() => false))) redirect("/");

  const orgs = await listOrganizations();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
          Kunden
        </h2>
        <Link
          href="/admin/kunden/neu"
          className="min-h-[44px] px-4 rounded-lg text-sm font-medium flex items-center gradient-accent"
          style={{ color: "var(--color-accent-text)" }}
        >
          Neuer Kunde
        </Link>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--color-line)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--color-bg-elevated)" }}>
              <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--color-text-secondary)" }}>Name</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell" style={{ color: "var(--color-text-secondary)" }}>Slug</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell" style={{ color: "var(--color-text-secondary)" }}>Plan</th>
              <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--color-text-secondary)" }}>Mitglieder</th>
              <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--color-text-secondary)" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => {
              const plan = (org.metadata as any)?.plan ?? "standard";
              return (
                <tr
                  key={org.id}
                  className="border-t"
                  style={{ borderColor: "var(--color-line)" }}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/kunden/${org.id}`}
                      className="font-medium"
                      style={{ color: "var(--color-accent)" }}
                    >
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell" style={{ color: "var(--color-muted)" }}>
                    {org.slug}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell" style={{ color: "var(--color-muted)" }}>
                    {plan}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--color-muted)" }}>
                    {org.member_count}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: org.status === "active" ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                        color: org.status === "active" ? "var(--color-accent)" : "var(--color-muted)",
                      }}
                    >
                      {org.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {orgs.length === 0 && (
          <div className="p-8 text-center" style={{ color: "var(--color-muted)" }}>
            Noch keine Kunden vorhanden.
          </div>
        )}
      </div>
    </div>
  );
}
