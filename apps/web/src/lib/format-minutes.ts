// Display helpers for the "eingesparte Zeit" KPI (spec-cockpit.md §10).
// Pure formatting — the value itself is minutes_saved_per_run × successful
// runs, computed by the callers from listAutomations().

/** "Xh Ym" above one hour, "Ym" below, em dash when nothing was saved. */
export function formatMinutesSaved(totalMinutes: number): string {
  const minutes = Math.round(totalMinutes);
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Per-run value for hints like "~5 Min pro Lauf" (strips trailing zeros). */
export function formatPerRunMinutes(minutes: number): string {
  return Number(minutes.toFixed(1)).toLocaleString("de-DE");
}
