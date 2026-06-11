import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { BERATER_ROLES, getMemberRole } from "@/lib/db/org-context";
import { WorkspaceHome } from "./_workspace/home";
import { BeraterOverview } from "./_workspace/berater-overview";
import { HaiwayMission } from "./_workspace/haiway-mission";

// Persona-Switch fürs Root-Dashboard. Drei Personas, drei Cockpits:
//
//  HAIway-intern (Platform-Admin: Flag oder owner/admin    → Mission Control
//  der Plattform-Org)
//  Berater-Persona (role IN BERATER_ROLES)                 → Outcome-Cockpit
//  End-User (role='member')                                → Workspace-Home
//
// Stat-Reads sind günstig (head:true counts, kpi_event-Aggregat); 30s Cache
// reicht für ein lebendiges Cockpit-Gefühl ohne DB-Stress.
export const revalidate = 30;

export default async function HomePage() {
  const [admin, role] = await Promise.all([
    isPlatformAdmin().catch(() => false),
    getMemberRole().catch(() => null),
  ]);

  if (admin) return <HaiwayMission />;
  if (role && BERATER_ROLES.includes(role)) return <BeraterOverview />;
  return <WorkspaceHome />;
}
