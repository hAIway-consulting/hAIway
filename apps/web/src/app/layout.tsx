import type { Metadata, Viewport } from "next";
import { Fraunces, DM_Sans } from "next/font/google";
import "./globals.css";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { NavWorkspace } from "@/components/layout/nav-workspace";
import { NavBerater } from "@/components/layout/nav-berater";
import { NavHaiway } from "@/components/layout/nav-haiway";
import { AuthProvider } from "@/components/providers/auth-provider";
import { createUserClient, getSession } from "@/lib/db/supabase-server";
import { getOrgBranding, getOrganization, isPlatformAdmin } from "@/lib/db/queries/organization";
import { getMemberRole } from "@/lib/db/org-context";
import { hasFeature } from "@/lib/features/flags";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "hAIway",
  description: "AI-Ready Knowledge & Operations Platform",
};

type Persona = "haiway" | "berater" | "workspace";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  const user = session?.user ?? null;

  let branding = undefined;
  let persona: Persona = "workspace";
  let userName: string | null = null;
  let contextLabel: string | null = null;
  let hasPhoneAssistant = false;
  let beraterNavVariant: "manager" | "berater" = "manager";
  let canManageOrg = false;

  if (user) {
    try {
      const [b, platformAdmin, role, phoneFlag] = await Promise.all([
        getOrgBranding(),
        isPlatformAdmin(),
        getMemberRole(),
        hasFeature("phone_assistant"),
      ]);
      branding = b;
      hasPhoneAssistant = phoneFlag;
      canManageOrg = platformAdmin || role === "admin" || role === "owner";

      if (platformAdmin) {
        persona = "haiway";
      } else if (role === "admin" || role === "owner" || role === "manager" || role === "berater") {
        persona = "berater";
        // Rolle 'berater' arbeitet im Cockpit, verwaltet aber nicht (System-Gruppe).
        beraterNavVariant = role === "berater" ? "berater" : "manager";
      } else {
        persona = "workspace";
      }

      const db = await createUserClient();
      const { data } = await db.from("profiles").select("full_name").eq("id", user.id).single();
      userName = data?.full_name ?? null;

      if (persona === "berater") {
        const org = await getOrganization().catch(() => null);
        contextLabel = org?.name?.replace(/^\[[^\]]+\]\s*/, "").trim() || null;
      } else if (persona === "haiway") {
        contextLabel = "Intern";
      }
    } catch {
      // User has no org membership yet (onboarding)
    }
  }

  const sidebar =
    persona === "haiway" ? (
      <NavHaiway />
    ) : persona === "berater" ? (
      <NavBerater hasPhoneAssistant={hasPhoneAssistant} variant={beraterNavVariant} />
    ) : (
      <NavWorkspace hasPhoneAssistant={hasPhoneAssistant} />
    );

  return (
    <html lang="de" className={`${fraunces.variable} ${dmSans.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;var t=localStorage.getItem('theme')||'system';var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);d.classList.toggle('dark',dark);d.classList.toggle('light',!dark)}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <AuthProvider initialUser={user}>
          {!user ? (
            children
          ) : (
            <WorkspaceShell
              branding={branding}
              userName={userName}
              userEmail={user.email ?? null}
              contextLabel={contextLabel}
              sidebar={sidebar}
              orgSettingsHref={canManageOrg ? "/organisation" : null}
            >
              {children}
            </WorkspaceShell>
          )}
        </AuthProvider>
      </body>
    </html>
  );
}
