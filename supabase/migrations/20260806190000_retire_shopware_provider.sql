-- Migration: retire the Shopware provider (audit 2026-08-06)
--
-- DEPLOY NOTE: committed but NOT pushed automatically, same as the other
-- 20260806* migrations.
--
-- Shopware lost its runtime in the audit cleanup: supabase/functions/
-- connector-shopware, supabase/functions/_shared/shopware.ts,
-- apps/web/src/lib/orchestrator/shopware.ts and getShopwareConfig() are gone,
-- and so is the complaint orchestrator that was the only consumer of the
-- credentials. What stayed behind was the entry surface — the provider row was
-- still is_active = TRUE, so /admin/integrationen kept rendering a "Shopware
-- verbinden" card that led into a wizard which validated client credentials
-- against the live shop and stored them for nobody to read.
--
-- 20260806100000 PART A retired 'imap_inbox' and 'generic_webhook' for exactly
-- this reason ("a provider without a runtime renders as a dead card") but did
-- not include 'shopware'. This migration applies the same treatment. The
-- wizard under apps/web/src/app/admin/integrationen/shopware/setup, its
-- provider-meta.ts entry and e2e/shopware-setup.spec.ts are removed in the
-- same commit.
--
-- DELIBERATELY NO DELETE, same reasoning as 20260524130000 and 20260806100000:
-- the integration_providers row and every organization_integrations row stay.
-- Deleting them would destroy stored customer credentials, and raw_events /
-- integration_runs reference integration_providers with ON DELETE RESTRICT.
-- is_active = FALSE is enough — /admin/integrationen only lists active
-- providers, and onboard_organization_v2 only seeds pending rows for active
-- ones.
--
-- TRELLO IS NOT INCLUDED — CHECKED: unlike Shopware, Trello still has live
-- consumers in apps/web. apps/web/src/lib/ai/agent/registry.ts registers the
-- trello_* agent tools on top of apps/web/src/lib/orchestrator/trello.ts,
-- which resolves its token from organization_integrations. Retiring the
-- provider would hide /admin/integrationen/trello/setup and break those tools,
-- so 'trello' stays is_active = TRUE together with its setup wizard.

UPDATE public.integration_providers
SET is_active = FALSE
WHERE id = 'shopware';
