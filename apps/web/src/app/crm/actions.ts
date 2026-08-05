"use server";

import { recordAppLaunch } from "@/app/_workspace/actions";

// Audit trail: every CRM launch lands in app_launch_events (kind 'external').
export async function recordCrmLaunch(): Promise<void> {
  await recordAppLaunch("crm-twenty", "external");
}
