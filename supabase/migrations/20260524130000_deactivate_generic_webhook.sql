-- Migration: deactivate_generic_webhook
--
-- Deactivates the existing 'generic_webhook' provider (UI label "Webhook
-- (Zapier/Make/n8n)"). Strategic decision: hAIway is an orchestrator, not
-- a place where Zapier/Make/n8n flows terminate. Tenants who need iPaaS
-- bridges should keep using those tools end-to-end; we focus on direct,
-- first-party connectors. Hiding via is_active=false rather than DELETE
-- so any existing organization_integrations rows stay intact in case a
-- pilot already wired one up — they'll simply stop appearing in the
-- provider list and the connect wizard.

UPDATE public.integration_providers
SET is_active = FALSE
WHERE id = 'generic_webhook';
