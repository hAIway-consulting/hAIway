-- Migration: drop the skills registry (audit 2026-08-06)
--
-- The 2026-08-06 feature audit rated the skills registry as "neu aufrollen".
-- There never was an execution path: `skills` was only ever read/written by
-- two admin screens, `skill_runs` was never written by any code, and
-- `skill_review_events` was never touched at all. `skills.tool_refs` was
-- plain TEXT[] storage that was never resolved against the agent tool
-- registry. The corresponding pages (/admin/cockpit/skills,
-- /admin/bibliothek/skills) and queries (listLibrarySkills, the skill half
-- of runsDaily) are removed in the same change.
--
-- KEPT ON PURPOSE: public.is_org_admin() (shared with saved_agents and the
-- member app permissions), public.agent_runs + agent_runs_daily, and the
-- CHECK constraint ai_usage_events.purpose IN (…,'skill',…) — historical
-- usage rows must stay valid.

-- ─── VIEWS ──────────────────────────────────────────────────────────────
-- Dropped first: the view reads skill_runs.

DROP VIEW IF EXISTS public.skill_runs_daily;

-- ─── TABLES ─────────────────────────────────────────────────────────────
-- Children before parent: skill_review_events.skill_id and skill_runs.skill_id
-- both reference skills(id). CASCADE also removes the attached indexes, the
-- updated_at trigger and the RLS policies.

DROP TABLE IF EXISTS public.skill_review_events CASCADE;
DROP TABLE IF EXISTS public.skill_runs CASCADE;
DROP TABLE IF EXISTS public.skills CASCADE;

-- ─── FEATURE FLAG ASSIGNMENTS ───────────────────────────────────────────
-- Both FKs are ON DELETE CASCADE, so these DELETEs are redundant — they are
-- spelled out so the migration documents itself.

DELETE FROM public.plan_tier_features   WHERE feature_key = 'skills';
DELETE FROM public.organization_features WHERE feature_key = 'skills';

-- ─── FEATURE FLAG ───────────────────────────────────────────────────────
-- No code ever called hasFeature("skills"); the flag only showed up in the
-- generic feature lists of /admin/kunden/[id] and /organisation.

DELETE FROM public.feature_flags WHERE key = 'skills';
