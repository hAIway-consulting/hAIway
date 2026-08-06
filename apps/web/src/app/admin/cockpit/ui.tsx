// Shared presentational pieces for the Berater-Cockpit tabs
// (docs/spec-berater-dashboard.md §8). Deliberately local: the markup
// follows /admin/integrationen, but that page stays untouched — no
// cross-imports.

export type PillTone = "success" | "warning" | "danger" | "accent" | "muted";

const PILL_STYLES: Record<PillTone, { background: string; color: string }> = {
  success: { background: "var(--color-success-soft)", color: "var(--color-success)" },
  warning: { background: "var(--color-warning-soft)", color: "var(--color-warning)" },
  danger:  { background: "var(--color-danger-soft)",  color: "var(--color-danger)" },
  accent:  { background: "var(--color-accent-soft)",  color: "var(--color-accent)" },
  muted:   { background: "var(--color-bg-elevated)",  color: "var(--color-muted)" },
};

export function Pill({ label, tone }: { label: string; tone: PillTone }) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium leading-tight whitespace-nowrap"
      style={PILL_STYLES[tone]}
    >
      {label}
    </span>
  );
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4 md:p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
      <h2 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "warn" | "success";
}) {
  const isWarn = tone === "warn" && typeof value === "number" && value > 0;
  return (
    <div className="rounded-xl p-4 md:p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
      <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
        {label}
      </p>
      <p
        className="text-xl md:text-2xl font-bold mt-1"
        style={{
          fontFamily: "var(--font-display)",
          color: isWarn ? "var(--color-danger)" : tone === "success" ? "var(--color-success)" : "var(--color-text)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <p className="text-sm" style={{ color: "var(--color-muted)" }}>
      {text}
    </p>
  );
}

export function truncate(text: string | null | undefined, max = 80): string {
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
