import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { BERATER_ROLES, getMemberRole } from "@/lib/db/org-context";

/**
 * /admin/* — Pages, die HAIway-internes Dashboard heute halten und parallel
 * vom Berater-Cockpit als Sub-Seiten genutzt werden (Integrationen,
 * Retrieval-Qualität, …). Gate auf Platform-Admin ODER Berater-Persona
 * (`role IN BERATER_ROLES`); End-User landen auf /.
 *
 * Layout selbst rendert nur das Gate. Die Top-Bar + Tabs kommen aus dem
 * Root-Layout über die Persona-spezifische `WorkspaceShell`-Variante; ein
 * eigenes Tab-Banner hier hätte sich doppelt mit der Shell-Navigation.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [admin, role] = await Promise.all([
    isPlatformAdmin().catch(() => false),
    getMemberRole().catch(() => null),
  ]);
  if (!admin && (!role || !BERATER_ROLES.includes(role))) {
    redirect("/");
  }

  return <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">{children}</div>;
}
