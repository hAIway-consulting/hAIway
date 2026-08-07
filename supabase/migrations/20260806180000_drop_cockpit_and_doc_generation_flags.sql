-- Migration: drop the unread feature flags 'cockpit' and 'doc_generation'
-- (audit 2026-08-06)
--
-- DEPLOY NOTE: committed but NOT pushed automatically, same as the other
-- 20260806* migrations.
--
-- Both were seeded by 20260611122000:7-10 and mapped onto plan tiers at
-- :16-27. Neither is read anywhere. Verified by grep over apps/web/src,
-- supabase, scripts and e2e: `hasFeature()` (apps/web/src/lib/features/
-- flags.ts) is only ever called with 'crm_workspace' (app/crm/page.tsx,
-- lib/features/crm.ts), 'phone_assistant' (app/layout.tsx) and 'agent_mode'
-- (_workspace/home.tsx, chat/[id]/page.tsx). The SQL side is just as unused:
-- no RLS policy, no RPC and no integration_providers.feature_key row
-- references either key.
--
-- Effect today: both showed up as switchable toggles in the generic feature
-- lists of /admin/kunden/[id] and /organisation, where a consultant could
-- flip them without anything happening.
--
--   cockpit        — is_core = TRUE, meant to gate the cockpit navigation
--                    once /search was retired (see the comment in
--                    20260611122000). /search became a redirect to /chat and
--                    the navigation never gained the gate, so the flag never
--                    got a reader. The cockpit itself is core and stays
--                    unconditionally visible — dropping the row changes no
--                    rendered UI.
--   doc_generation — premium+ toggle for a PPTX/XLSX/DOCX/PDF worker that was
--                    never built. docs/spec-cockpit.md §14 is marked as
--                    "Entfallen" in the same commit.
--
-- Both FKs (plan_tier_features.feature_key, organization_features.feature_key)
-- are ON DELETE CASCADE — the DELETEs are spelled out so the migration
-- documents itself. kpi_events.feature_key is ON DELETE SET NULL, so historic
-- KPI rows survive with a NULL feature.

DELETE FROM public.plan_tier_features    WHERE feature_key IN ('cockpit', 'doc_generation');
DELETE FROM public.organization_features WHERE feature_key IN ('cockpit', 'doc_generation');
DELETE FROM public.feature_flags         WHERE key         IN ('cockpit', 'doc_generation');
