"use client";

import { recordCrmLaunch } from "./actions";

/**
 * Opens Twenty in a new browser tab. window.open must run synchronously in
 * the click handler (popup blockers) — the audit log call follows after.
 */
export function CrmLaunchButton({ url }: { url: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.open(url, "_blank", "noopener,noreferrer");
        void recordCrmLaunch();
      }}
      className="min-h-[44px] px-5 rounded-xl text-sm font-semibold self-start"
      style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
    >
      CRM öffnen ↗
    </button>
  );
}
