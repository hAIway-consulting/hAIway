"use client";

import { useTransition } from "react";
import type { RoleOption } from "@/lib/org-roles";

export function RoleSelect({
  current,
  options,
  action,
  disabled,
  disabledHint,
}: {
  current: string;
  options: RoleOption[];
  action: (formData: FormData) => Promise<void>;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      defaultValue={current}
      disabled={disabled || isPending}
      title={disabled ? disabledHint : undefined}
      onChange={(e) => {
        const formData = new FormData();
        formData.set("role", e.target.value);
        startTransition(async () => {
          await action(formData);
        });
      }}
      className="min-h-[44px] px-3 rounded-lg text-sm"
      style={{
        border: "1px solid var(--color-line)",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        opacity: disabled || isPending ? 0.6 : 1,
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
