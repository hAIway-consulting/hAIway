-- Migration: agent_tools_and_audit
-- Central agent-tool registry + per-org toggles + per-call audit trail.
-- Mirrors the integration_providers / organization_integrations pattern
-- (see 20260404100000_plan_tiers_and_integration_registry.sql).
--
-- The TS registry (apps/web/src/lib/ai/tools/*) is the *executable* source of
-- truth (Zod schema + handler). These tables are the *catalog* (display in the
-- Berater cockpit) + per-org enablement + the strategy-mandated audit trail.

-- ─── AGENT TOOLS (central catalog) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_tools (
  key           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('knowledge', 'crm', 'connector', 'artifact')),
  input_schema  JSONB NOT NULL DEFAULT '{}',
  feature_key   TEXT REFERENCES public.feature_flags(key),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ORGANIZATION TOOLS (per-org toggle) ────────────────────────────────────
-- Absence of a row = enabled (default-on for read tools). The Berater turns a
-- tool OFF by upserting enabled=false.

CREATE TABLE IF NOT EXISTS public.organization_tools (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tool_key        TEXT NOT NULL REFERENCES public.agent_tools(key) ON DELETE CASCADE,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  config          JSONB NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, tool_key)
);

CREATE INDEX IF NOT EXISTS idx_org_tools_org ON public.organization_tools(organization_id);

DROP TRIGGER IF EXISTS set_updated_at_org_tools ON public.organization_tools;
CREATE TRIGGER set_updated_at_org_tools
  BEFORE UPDATE ON public.organization_tools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── AGENT TOOL CALLS (audit trail — "every action leaves a trace") ─────────

CREATE TABLE IF NOT EXISTS public.agent_tool_calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id  UUID REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  message_id       UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  user_id          UUID,
  step_index       INT NOT NULL DEFAULT 0,
  tool_key         TEXT NOT NULL,
  category         TEXT,
  input            JSONB NOT NULL DEFAULT '{}',
  output_summary   JSONB,
  status           TEXT NOT NULL CHECK (status IN ('ok', 'invalid_input', 'error', 'unknown_tool')),
  error_message    TEXT,
  latency_ms       INT,
  model            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_org  ON public.agent_tool_calls(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_conv ON public.agent_tool_calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_tool ON public.agent_tool_calls(organization_id, tool_key, created_at DESC);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_tools         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_tools  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_calls    ENABLE ROW LEVEL SECURITY;

-- Catalog is readable by everyone (like integration_providers).
DROP POLICY IF EXISTS "agent_tools_read" ON public.agent_tools;
CREATE POLICY "agent_tools_read" ON public.agent_tools
  FOR SELECT USING (TRUE);

-- Per-org toggles: org members read + write (the admin route gates the UI).
DROP POLICY IF EXISTS "org_tools_read" ON public.organization_tools;
CREATE POLICY "org_tools_read" ON public.organization_tools
  FOR SELECT USING (public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS "org_tools_write" ON public.organization_tools;
CREATE POLICY "org_tools_write" ON public.organization_tools
  FOR ALL USING (public.is_member_of_org(organization_id))
  WITH CHECK (public.is_member_of_org(organization_id));

-- Audit trail: org members read (KPI/cockpit), org members insert (server path
-- runs as the signed-in user via createUserClient).
DROP POLICY IF EXISTS "agent_tool_calls_read" ON public.agent_tool_calls;
CREATE POLICY "agent_tool_calls_read" ON public.agent_tool_calls
  FOR SELECT USING (public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS "agent_tool_calls_insert" ON public.agent_tool_calls;
CREATE POLICY "agent_tool_calls_insert" ON public.agent_tool_calls
  FOR INSERT WITH CHECK (public.is_member_of_org(organization_id));

-- ─── SEED: read-only tools (PR 1) ───────────────────────────────────────────
-- input_schema here is for catalog display only; runtime validation runs from
-- the Zod schema in the TS registry.

INSERT INTO public.agent_tools (key, name, description, category, feature_key, sort_order, input_schema) VALUES
  ('search_knowledge', 'Wissenssuche',
   'Durchsucht die Wissensbasis (Dokumente, Transkripte, CRM) per Hybrid-Suche und gibt Quellen-Snippets zurück.',
   'knowledge', 'chat', 10,
   '{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer"}},"required":["query"]}'),
  ('find_entities', 'Entitäten finden',
   'Sucht in den operativen Tabellen (Firmen, Kontakte, Projekte) nach passenden Einträgen.',
   'crm', 'chat', 20,
   '{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}'),
  ('list_entities_by_status', 'Entitäten nach Status',
   'Listet Firmen/Kontakte/Projekte gefiltert nach Status (z.B. alle aktiven Kunden, offene Projekte).',
   'crm', 'chat', 30,
   '{"type":"object","properties":{"types":{"type":"array","items":{"type":"string"}},"statuses":{"type":"array","items":{"type":"string"}}},"required":["types","statuses"]}'),
  ('get_company', 'Firmendetails',
   'Liefert die Stammdaten einer Firma anhand ihrer ID.',
   'crm', 'companies', 40,
   '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}'),
  ('get_contact', 'Kontaktdetails',
   'Liefert die Stammdaten eines Kontakts anhand seiner ID.',
   'crm', 'contacts', 50,
   '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}')
ON CONFLICT (key) DO NOTHING;
