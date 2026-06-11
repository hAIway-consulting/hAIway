import { redirect } from "next/navigation";

/**
 * Die eigenständige Suche ist im hAIway Cockpit aufgegangen (spec-cockpit.md §4).
 * Alte Bookmarks/Links landen im Cockpit; die Such-RPCs bleiben als
 * Retrieval-Backend des Chat-Modus bestehen.
 */
export default function SearchPage() {
  redirect("/chat");
}
