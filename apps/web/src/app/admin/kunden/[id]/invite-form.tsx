"use client";

import { useRef, useTransition } from "react";
import { inviteMember } from "../../actions";
import type { RoleOption } from "@/lib/org-roles";

const DEFAULT_ROLES: RoleOption[] = [
  { value: "member", label: "Mitglied" },
  { value: "owner", label: "Inhaber" },
];

export function InviteForm({
  orgId,
  roles = DEFAULT_ROLES,
  action,
}: {
  orgId: string;
  roles?: RoleOption[];
  /** Custom invite action (z. B. org-scoped auf /organisation) — default: Platform-Admin-Action. */
  action?: (orgId: string, formData: FormData) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  const inviteAction = (action ?? inviteMember).bind(null, orgId);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await inviteAction(formData);
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex gap-2">
      <input
        name="email"
        type="email"
        required
        placeholder="email@beispiel.de"
        className="flex-1 min-h-[44px] px-3 rounded-lg text-sm"
        style={{
          border: "1px solid var(--color-line)",
          background: "var(--color-bg)",
          color: "var(--color-text)",
        }}
      />
      <select
        name="role"
        defaultValue="member"
        className="min-h-[44px] px-3 rounded-lg text-sm"
        style={{
          border: "1px solid var(--color-line)",
          background: "var(--color-bg)",
          color: "var(--color-text)",
        }}
      >
        {roles.map((role) => (
          <option key={role.value} value={role.value}>
            {role.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="min-h-[44px] min-w-[44px] px-4 rounded-lg text-sm font-medium gradient-accent"
        style={{ color: "var(--color-accent-text)", opacity: isPending ? 0.6 : 1 }}
      >
        {isPending ? "..." : "Einladen"}
      </button>
    </form>
  );
}
