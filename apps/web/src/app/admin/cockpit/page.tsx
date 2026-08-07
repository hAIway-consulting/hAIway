import { redirect } from "next/navigation";

/** /admin/cockpit defaults to the Agenten & Runs tab (berater spec §8). */
export default function CockpitVerwaltungIndex() {
  redirect("/admin/cockpit/agenten");
}
