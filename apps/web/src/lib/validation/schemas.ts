import { z } from "zod";

// Upper bounds chosen to protect the embedding pipeline from DoS via giant payloads.
export const TITLE_MAX = 500;
export const DESCRIPTION_MAX = 5_000;
export const NOTES_MAX = 10_000;
export const RAW_TEXT_MAX = 500_000; // ~500 KB of text, plenty for a PDF or transcript
export const PDF_SIZE_MAX = 25 * 1024 * 1024; // 25 MB
export const AUDIO_SIZE_MAX = 50 * 1024 * 1024; // 50 MB

const uuid = z.string().uuid();
const trimmedNonEmpty = (max: number) => z.string().trim().min(1).max(max);
const trimmedOptional = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => v || null);

export const textSourceSchema = z.object({
  title: trimmedNonEmpty(TITLE_MAX),
  description: trimmedOptional(DESCRIPTION_MAX),
  rawText: z.string().trim().min(1).max(RAW_TEXT_MAX),
});

export const pdfSourceMetaSchema = z.object({
  title: trimmedNonEmpty(TITLE_MAX),
  description: trimmedOptional(DESCRIPTION_MAX),
});

export const recordingSourceSchema = z.object({
  title: trimmedNonEmpty(TITLE_MAX),
  description: trimmedOptional(DESCRIPTION_MAX),
  linkType: z.enum(["company", "contact", "project"]).optional().nullable(),
  linkId: uuid.optional().nullable(),
});

const ACTIVITY_TYPES = [
  "note",
  "call",
  "meeting",
  "email",
  "task",
  "visit",
  "other",
] as const;

export const activitySchema = z.object({
  title: trimmedNonEmpty(TITLE_MAX),
  description: trimmedOptional(NOTES_MAX),
  activityType: z.enum(ACTIVITY_TYPES),
  occurredAt: z.string().datetime().optional().nullable().transform((v) => v || null),
  durationMinutes: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v == null || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 24 * 60 * 7), {
      message: "Ungültige Dauer",
    }),
  linkType: z.enum(["company", "contact", "project"]).optional().nullable(),
  linkId: uuid.optional().nullable(),
});

const LINK_TYPES = ["company", "contact", "project"] as const;
export const linkTypeSchema = z.enum(LINK_TYPES);

export const importRowSchema = z.object({
  title: trimmedNonEmpty(TITLE_MAX),
  content: z.string().trim().min(1).max(RAW_TEXT_MAX),
  sourceType: z.string().trim().max(50).optional(),
  columnNames: z.array(z.string().max(200)).max(100).optional(),
  linkType: linkTypeSchema.optional(),
  linkId: uuid.optional(),
});

export const sourceLinkSchema = z.object({
  sourceId: uuid,
  linkedType: linkTypeSchema,
  linkedId: uuid,
});

export const processTemplateSchema = z.object({
  name: trimmedNonEmpty(TITLE_MAX),
  description: trimmedOptional(DESCRIPTION_MAX),
  category: trimmedOptional(100),
});

export const processTemplateStepSchema = z.object({
  name: trimmedNonEmpty(TITLE_MAX),
  description: z.string().trim().max(DESCRIPTION_MAX).optional(),
  expected_duration_days: z.number().int().min(0).max(3650).optional(),
  responsible_role: z.string().trim().max(200).optional(),
});

export const processInstanceSchema = z.object({
  templateId: uuid,
  name: trimmedNonEmpty(TITLE_MAX),
  projectId: uuid.optional().nullable(),
  companyId: uuid.optional().nullable(),
});

export const stepStatusSchema = z.enum(["pending", "in_progress", "completed", "skipped"]);

export const companySchema = z.object({
  name: trimmedNonEmpty(TITLE_MAX),
  website: trimmedOptional(500),
  status: z.string().trim().max(50).default("active"),
  notes: trimmedOptional(NOTES_MAX),
});

export const contactSchema = z.object({
  companyId: uuid.optional().nullable().transform((v) => v || null),
  firstName: trimmedNonEmpty(200),
  lastName: trimmedNonEmpty(200),
  email: z.string().trim().email().max(320).optional().nullable().transform((v) => v || null),
  phone: trimmedOptional(50),
  roleTitle: trimmedOptional(200),
  status: z.string().trim().max(50).default("active"),
  notes: trimmedOptional(NOTES_MAX),
});

export const projectSchema = z.object({
  companyId: uuid.optional().nullable().transform((v) => v || null),
  name: trimmedNonEmpty(TITLE_MAX),
  status: z.string().trim().max(50).default("active"),
  description: trimmedOptional(DESCRIPTION_MAX),
});

// ── CRM (Twenty) ──────────────────────────────────────────────────────
// Secret fields are optional: an empty submit keeps the stored value.
export const twentyConnectionSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => v.startsWith("mock://") || /^https?:\/\/.+/.test(v),
      { message: "Ungültige URL (z. B. https://crm.example.com)" },
    )
    .transform((v) => v.replace(/\/+$/, "")),
  apiKey: trimmedOptional(4000),
  serviceEmail: z
    .string()
    .trim()
    .max(320)
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || /.+@.+\..+/.test(v), { message: "Ungültige E-Mail" }),
  servicePassword: trimmedOptional(500),
});

// Level keys are config-driven (role_map); constrain the format, not the set.
export const crmLevelKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, {
    message: "Level-Name: 2–32 Zeichen, Kleinbuchstaben/Ziffern/-/_",
  });

export const crmSetLevelSchema = z.object({
  userId: uuid,
  level: z.union([z.literal("none"), crmLevelKeySchema]),
});

// ── File validation ────────────────────────────────────────────────────
const PDF_MIME_ALLOW = new Set(["application/pdf"]);
const AUDIO_MIME_ALLOW = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/x-m4a",
]);

export function validatePdfFile(file: File): { ok: true } | { ok: false; error: string } {
  if (file.size === 0) return { ok: false, error: "Datei ist leer" };
  if (file.size > PDF_SIZE_MAX) return { ok: false, error: "Datei ist zu groß (max. 25 MB)" };
  if (!PDF_MIME_ALLOW.has(file.type)) return { ok: false, error: "Nur PDF-Dateien erlaubt" };
  return { ok: true };
}

export function validateAudioFile(file: File): { ok: true } | { ok: false; error: string } {
  if (file.size === 0) return { ok: false, error: "Datei ist leer" };
  if (file.size > AUDIO_SIZE_MAX) return { ok: false, error: "Datei ist zu groß (max. 50 MB)" };
  if (!AUDIO_MIME_ALLOW.has(file.type)) return { ok: false, error: "Audio-Format wird nicht unterstützt" };
  return { ok: true };
}

// ── FormData helpers ──────────────────────────────────────────────────
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) continue;
    obj[key] = value === "" ? null : value;
  }
  return obj;
}
