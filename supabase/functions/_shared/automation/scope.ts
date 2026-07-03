// Run scope helpers: dot-path lookup, "{{...}}" template interpolation and
// structured step guards. No eval — conditions are data, not code.

import type { StepCondition } from "@haiway/contracts/automations";

export interface RunScope {
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  trigger: Record<string, unknown>;
}

export function getPath(scope: unknown, path: string): unknown {
  let current: unknown = scope;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

// Replaces every "{{ path.to.value }}" occurrence with the scope value.
// Non-string lookups are JSON-stringified; missing paths become "".
export function resolveTemplate(template: string, scope: RunScope): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = getPath(scope, path);
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

// Recursively resolves templates in every string value of a params object.
export function resolveParams(
  params: Record<string, unknown>,
  scope: RunScope,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      out[key] = resolveTemplate(value, scope);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = resolveParams(value as Record<string, unknown>, scope);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function conditionHolds(when: StepCondition | undefined, scope: RunScope): boolean {
  if (!when) return true;
  const value = getPath(scope, when.path);
  if (when.exists !== undefined) {
    const exists = value !== undefined && value !== null;
    if (exists !== when.exists) return false;
  }
  if (when.equals !== undefined && value !== when.equals) return false;
  if (when.not_equals !== undefined && value === when.not_equals) return false;
  return true;
}
