import { redirect } from "next/navigation";

/**
 * Organisationseinstellungen leben jetzt unter /organisation (Profil-Dropdown
 * in der Top-Bar). Redirect hält Bookmarks und alte Links am Leben.
 */
export default function MeinUnternehmenPage() {
  redirect("/organisation");
}
