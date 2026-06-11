import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { Empty, Panel, Pill, truncate, type PillTone } from "../ui";

export const dynamic = "force-dynamic";

type SkillStatus = "draft" | "in_review" | "approved" | "active" | "rejected";

interface SkillRow {
  id: string;
  name: string;
  description: string;
  status: SkillStatus;
  version: number;
  review_comment: string | null;
  updated_at: string;
}

const STATUS_LABELS: Record<SkillStatus, string> = {
  draft: "Entwurf",
  in_review: "In Prüfung",
  approved: "Freigegeben",
  active: "Aktiv",
  rejected: "Abgelehnt",
};

const STATUS_TONES: Record<SkillStatus, PillTone> = {
  draft: "muted",
  in_review: "warning",
  approved: "accent",
  active: "success",
  rejected: "danger",
};

async function listOrgSkills(orgId: string): Promise<SkillRow[]> {
  try {
    const db = await createUserClient();
    const { data, error } = await db
      .from("skills")
      .select("id, name, description, status, version, review_comment, updated_at")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    return data as SkillRow[];
  } catch {
    return [];
  }
}

/**
 * Skill-Freigabe & -Verwaltung (berater spec §3) — v1 is the read-only
 * review queue: status, version, review comment. The guided review flow
 * (edit template, sandbox test, approve/reject) follows in a later phase.
 */
export default async function CockpitSkillsPage() {
  const orgId = await requireOrgId();
  const skills = await listOrgSkills(orgId);

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <Panel title="Skills der Organisation">
        {skills.length === 0 ? (
          <Empty text="Noch keine Skills — der geführte Anlage-Flow folgt in einer späteren Phase." />
        ) : (
          <ul className="flex flex-col gap-2">
            {skills.map((skill) => (
              <li
                key={skill.id}
                className="rounded-xl p-3 flex flex-col gap-1.5"
                style={{ background: "var(--color-bg)", border: "1px solid var(--color-line-soft)" }}
              >
                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                  <Pill label={STATUS_LABELS[skill.status]} tone={STATUS_TONES[skill.status]} />
                  <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                    {skill.name}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: "var(--color-placeholder)" }}>
                    v{skill.version} · {new Date(skill.updated_at).toLocaleDateString("de-DE")}
                  </span>
                </div>
                {skill.description && (
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {truncate(skill.description, 120)}
                  </span>
                )}
                {skill.review_comment && (
                  <span className="text-xs" style={{ color: "var(--color-warning)" }} title={skill.review_comment}>
                    Review-Kommentar: {truncate(skill.review_comment, 120)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
