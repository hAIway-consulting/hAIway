import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";

/**
 * /admin/kunden/* is cross-tenant throughout: the customer list, the customer
 * detail page (including member e-mail addresses) and the "new organization"
 * form. The soft gate in ../layout.tsx lets Berater roles through — legitimate
 * for /admin/integrationen or /admin/daten, but not here.
 *
 * The gate lives in the layout because /admin/kunden/neu is a client component
 * and cannot run a server-side check itself. The per-page checks stay in place
 * as a second line of defence.
 */
export default async function AdminKundenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isPlatformAdmin().catch(() => false))) redirect("/");
  return <>{children}</>;
}
