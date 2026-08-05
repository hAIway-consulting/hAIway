-- Three-dashboard rollout: introduce 'admin' role for berater (customer-admin)
-- between 'member' (end user) and 'owner' (org owner).
--
-- Existing organization_members.role has no CHECK constraint today; this adds
-- one to make the allowed set explicit and prevent typos.
--
-- Allowed values: 'member' | 'admin' | 'owner'
--   member  — end user, kuratierte Workspace-Sicht
--   admin   — Berater pro Kunden-Org, Berater-Cockpit
--   owner   — Org-Inhaber

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_role_check;

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('member', 'admin', 'owner'));
