-- Migration: Cockpit feature flags, plan quotas + registry seeds
-- (docs/spec-cockpit.md §4/§15, §9 "Ablösung der Stubs", §10).

-- ─── FEATURE FLAGS ──────────────────────────────────────────────────────

INSERT INTO public.feature_flags (key, name, description, is_core) VALUES
  ('cockpit',        'hAIway Cockpit',     'Cockpit sichtbar (ersetzt Chat + Suche in der Navigation)', TRUE),
  ('agent_mode',     'Agenten-Modus',      'Agenten-Modus + gespeicherte Agenten',                      FALSE),
  ('skills',         'Skills',             'Skill-Nutzung + geführter Anlage-Flow',                     FALSE),
  ('doc_generation', 'Dokument-Erzeugung', 'PPTX/XLSX/DOCX/PDF-Erzeugung im eigenen Worker',            FALSE)
ON CONFLICT (key) DO NOTHING;

-- Tier mapping (spec §15): cockpit explicit on all tiers (although core),
-- agent_mode + skills standard+, doc_generation premium+.
INSERT INTO public.plan_tier_features (plan_id, feature_key) VALUES
  ('basic',      'cockpit'),
  ('standard',   'cockpit'),
  ('standard',   'agent_mode'),
  ('standard',   'skills'),
  ('premium',    'cockpit'),
  ('premium',    'agent_mode'),
  ('premium',    'skills'),
  ('premium',    'doc_generation'),
  ('enterprise', 'cockpit'),
  ('enterprise', 'agent_mode'),
  ('enterprise', 'skills'),
  ('enterprise', 'doc_generation')
ON CONFLICT DO NOTHING;

-- ─── SEARCH/CHAT OVERRIDE MIGRATION (spec §4) ───────────────────────────
-- Orgs with an explicit override on chat or search get a cockpit override
-- via OR-merge: if either was enabled the cockpit must be enabled — an org
-- that disabled search but kept chat must not lose the cockpit. Manual
-- cockpit overrides win (ON CONFLICT DO NOTHING).

INSERT INTO public.organization_features (organization_id, feature_key, enabled)
SELECT
  org_id,
  'cockpit',
  bool_or(enabled)
FROM (
  SELECT organization_id AS org_id, enabled
  FROM public.organization_features
  WHERE feature_key IN ('chat', 'search')
) overrides
GROUP BY org_id
ON CONFLICT (organization_id, feature_key) DO NOTHING;

-- Mark the search flag as deprecated. Do NOT delete chat/search rows —
-- organization_features / integration_providers reference feature_flags.key;
-- cleanup happens once /search is fully removed and the nav gates on cockpit.
UPDATE public.feature_flags
SET description = 'DEPRECATED — ersetzt durch cockpit. ' || COALESCE(description, '')
WHERE key = 'search'
  AND description NOT LIKE 'DEPRECATED%';

-- ─── PLAN QUOTAS (spec §12.3) ───────────────────────────────────────────
-- Monthly AI token budgets in plan_tiers.limits (existing JSONB pattern).
-- enterprise = null → unlimited.

UPDATE public.plan_tiers
SET limits = limits || jsonb_build_object(
  'max_ai_tokens_month',
  CASE id
    WHEN 'basic'      THEN to_jsonb(2000000)
    WHEN 'standard'   THEN to_jsonb(10000000)
    WHEN 'premium'    THEN to_jsonb(50000000)
    WHEN 'enterprise' THEN 'null'::jsonb
  END
)
WHERE id IN ('basic', 'standard', 'premium', 'enterprise')
  AND NOT (limits ? 'max_ai_tokens_month');

-- ─── SEED: AUTOMATIONS ──────────────────────────────────────────────────
-- One row per existing customer org for the shipped complaint orchestrator,
-- preserving today's UX where the code registry entry showed for every org.
-- New orgs get automations via consultant/template instantiation instead
-- (spec §10: "immer individuell entwickelt").

INSERT INTO public.automations
  (organization_id, key, name, description, workflow_ref, requires)
SELECT
  o.id,
  'shopware_complaint_to_trello',
  'Reklamations-Orchestrator',
  'Erstellt aus Shopware-Reklamationen automatisch Trello-Karten.',
  'orchestrator/run-complaint',
  ARRAY['shopware', 'trello']
FROM public.organizations o
WHERE o.is_platform = FALSE
ON CONFLICT (organization_id, key) DO NOTHING;

-- ─── SEED: SAVED AGENTS (replaces STUB_AGENTS) ──────────────────────────
-- The four hardcoded workspace agents become org-wide saved_agents rows
-- (created_by NULL = consultant-curated). Idempotent via NOT EXISTS.

INSERT INTO public.saved_agents
  (organization_id, name, description, prompt, visibility, status, ui)
SELECT o.id, s.name, s.description, s.prompt, 'org', 'active', s.ui
FROM public.organizations o
CROSS JOIN (
  VALUES
    (
      'Angebot entwerfen',
      'Erstellt einen Angebotsentwurf auf Basis der Kundendaten.',
      'Bitte entwirf ein Angebot. Frag mich zuerst, für welchen Kunden und welches Projekt — danach nutzt du die hinterlegten Stammdaten und vergleichbare frühere Angebote als Vorlage.',
      '{"accent": "teal", "icon": "draft"}'::jsonb
    ),
    (
      'Kunden-Briefing',
      'Fasst Status, letzte Aktivitäten und offene Punkte zusammen.',
      'Erstelle ein kurzes Briefing für ein Kundengespräch. Frag mich zuerst, um welchen Kunden es geht, dann fasse aus den Quellen zusammen: Status, letzte Aktivitäten, offene Themen, Risiken.',
      '{"accent": "violet", "icon": "briefing"}'::jsonb
    ),
    (
      'E-Mail-Antwort',
      'Schreibt eine professionelle Antwort auf eine E-Mail.',
      'Hilf mir, eine E-Mail zu beantworten. Ich gebe dir gleich den Text der eingehenden Mail — du formulierst eine professionelle, freundliche, deutsche Antwort und nutzt unsere bisherige Kommunikation als Kontext.',
      '{"accent": "sky", "icon": "mail"}'::jsonb
    ),
    (
      'Gespräch zusammenfassen',
      'Extrahiert Action Items aus einem Transkript.',
      'Fasse mir ein Gespräch zusammen. Sag mir gleich, welches Transkript oder Meeting du meinst — ich extrahiere die wichtigsten Punkte, Entscheidungen und Action Items mit Verantwortlichen.',
      '{"accent": "amber", "icon": "summary"}'::jsonb
    )
) AS s(name, description, prompt, ui)
WHERE o.is_platform = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM public.saved_agents sa
    WHERE sa.organization_id = o.id AND sa.name = s.name
  );
