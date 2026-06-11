-- Org-Rollen für die Plattform-Org (eigenes Unternehmen): 'manager' und
-- 'berater' ergänzen das bestehende Set. Bedeutung hängt vom Org-Typ ab:
--
-- Kunden-Org (is_platform = FALSE) — unverändert:
--   member  — end user, kuratierte Workspace-Sicht
--   admin   — Berater pro Kunden-Org, Berater-Cockpit
--   owner   — Org-Inhaber
--
-- Plattform-Org (is_platform = TRUE):
--   owner | admin — volle Plattform-Sicht (wie profiles.is_platform_admin)
--   manager       — Berater-Persona inkl. Verwaltung (Berechtigungen, Branding, Sync)
--   berater       — Berater-Arbeitsbereich (Übersicht, Cockpit, Automatisierungen, KPIs)
--   member        — kuratierte Workspace-Sicht

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_role_check;

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('member', 'admin', 'owner', 'manager', 'berater'));

-- is_platform_admin() deckt jetzt zusätzlich owner/admin der Plattform-Org ab,
-- damit Rollenvergabe (statt manuellem Profil-Flag) die volle Admin-Sicht
-- steuert. SECURITY DEFINER wie is_member_of_org — vermeidet RLS-Rekursion,
-- wenn Policies anderer Tabellen die Funktion auswerten.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT is_platform_admin FROM public.profiles WHERE id = auth.uid()),
    FALSE
  ) OR EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND o.is_platform = TRUE
      AND om.role IN ('owner', 'admin')
  );
$$;
