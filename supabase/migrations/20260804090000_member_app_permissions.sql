-- Migration: member_app_permissions
--
-- Generic per-user tool access levels. First consumer: the Twenty CRM
-- workspace (app_key = 'crm'). Future external tools reuse the same table
-- with a new app_key — no schema change needed.
--
-- Level values are intentionally NOT constrained by a CHECK: they are
-- validated at write time against the config-driven role mapping stored in
-- organization_integrations.config.role_map, so new levels can be added by
-- a berater in the admin UI without a migration.
--
-- "No access" is represented by the absence of a row.

-- Role-checked auth helper: org admin/owner or platform admin. Deliberately
-- stricter than is_member_of_org — write access to permission grants must
-- never be available to regular members.
CREATE OR REPLACE FUNCTION public.is_org_admin(target_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = target_org_id
      AND m.user_id = (SELECT auth.uid())
      AND m.role IN ('admin', 'owner')
  ) OR public.is_platform_admin();
$$;

CREATE TABLE IF NOT EXISTS public.member_app_permissions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  app_key                TEXT NOT NULL,
  level                  TEXT NOT NULL,
  config                 JSONB NOT NULL DEFAULT '{}',
  -- Sync state towards the external tool
  sync_status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'synced', 'error', 'revoking', 'manual_required')),
  external_member_id     TEXT,
  external_invite_status TEXT,
  last_synced_at         TIMESTAMPTZ,
  sync_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id, app_key)
);

CREATE INDEX IF NOT EXISTS idx_member_app_permissions_org_app
  ON public.member_app_permissions (organization_id, app_key);
CREATE INDEX IF NOT EXISTS idx_member_app_permissions_user
  ON public.member_app_permissions (user_id);

CREATE TRIGGER set_updated_at_member_app_permissions
  BEFORE UPDATE ON public.member_app_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.member_app_permissions ENABLE ROW LEVEL SECURITY;

-- Read: the member themselves (to render their own access state) plus org
-- admins/owners and platform admins.
CREATE POLICY "member or org admin read member_app_permissions"
  ON public.member_app_permissions FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_org_admin(organization_id)));

-- Write: org admin/owner or platform admin only.
CREATE POLICY "org admin insert member_app_permissions"
  ON public.member_app_permissions FOR INSERT
  WITH CHECK ((SELECT public.is_org_admin(organization_id)));

CREATE POLICY "org admin update member_app_permissions"
  ON public.member_app_permissions FOR UPDATE
  USING ((SELECT public.is_org_admin(organization_id)))
  WITH CHECK ((SELECT public.is_org_admin(organization_id)));

CREATE POLICY "org admin delete member_app_permissions"
  ON public.member_app_permissions FOR DELETE
  USING ((SELECT public.is_org_admin(organization_id)));

-- Feature flag for the Twenty CRM workspace. Distinct from 'crm_integration'
-- (customer CRM connectors like HubSpot/Pipedrive) — this flag gates the
-- internal CRM tool tab + permission sync.
INSERT INTO public.feature_flags (key, name, description, is_core) VALUES
  ('crm_workspace', 'CRM-Arbeitsplatz',
   'Selbst gehostetes Twenty CRM als Arbeitsoberflaeche inkl. automatischem Berechtigungs-Sync',
   FALSE)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.plan_tier_features (plan_id, feature_key) VALUES
  ('premium', 'crm_workspace'),
  ('enterprise', 'crm_workspace')
ON CONFLICT DO NOTHING;
