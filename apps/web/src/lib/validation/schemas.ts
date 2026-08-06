import { z } from "zod";

// Upper bounds chosen to protect the embedding pipeline from DoS via giant payloads.
export const TITLE_MAX = 500;
export const DESCRIPTION_MAX = 5_000;
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

// ── CRM (Twenty) ──────────────────────────────────────────────────────
// Secret fields are optional: an empty submit keeps the stored value.
//
// "mock://" is the inline sandbox transport (lib/crm/twenty-sync.ts): it
// bypasses the real Twenty API and simulates every grant/revoke. It must not be
// selectable in production — a customer who saved "mock://anything" would get a
// CRM that only pretends to provision access.
const ALLOW_MOCK_TRANSPORT = process.env.NODE_ENV !== "production";

export const twentyConnectionSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) =>
        (ALLOW_MOCK_TRANSPORT && v.startsWith("mock://")) || /^https?:\/\/.+/.test(v),
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

// ── AI settings (/admin/ai-settings) ───────────────────────────────────
//
// settings.ai.agent.base_url decides where lib/ai/agent/config.ts sends every
// agent request — including the resolved API key (tenant key, otherwise the
// platform key). An unvalidated value is therefore a key-exfiltration and
// SSRF primitive: "http://attacker.example" leaks the key in cleartext,
// "http://169.254.169.254/…" or "http://10.0.0.5/…" points the server at
// infrastructure the browser could never reach.
//
// Outside production the field stays permissive on purpose — a local model on
// http://localhost:11434/v1 is the documented development setup.
const ALLOW_LOCAL_AGENT_ENDPOINT = process.env.NODE_ENV !== "production";

export const SYSTEM_PROMPT_MAX = 4_000;
export const AGENT_MODEL_MAX = 200;
export const AGENT_BASE_URL_MAX = 500;

/** Loopback, private, link-local (incl. cloud metadata) and CGNAT ranges. */
function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host === "::"
  ) {
    return true;
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd]/.test(host) || host.startsWith("fe80")) return true;

  return false;
}

export const agentBaseUrlSchema = z
  .string()
  .trim()
  .max(AGENT_BASE_URL_MAX)
  .transform((v) => v.replace(/\/+$/, ""))
  .superRefine((value, ctx) => {
    if (value === "") return; // empty = platform default

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ungültige Base-URL (z. B. https://api.example.com/v1).",
      });
      return;
    }

    const httpAllowed = ALLOW_LOCAL_AGENT_ENDPOINT && url.protocol === "http:";
    if (url.protocol !== "https:" && !httpAllowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Die Base-URL muss mit https:// beginnen.",
      });
      return;
    }

    if (!ALLOW_LOCAL_AGENT_ENDPOINT && isInternalHost(url.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Interne oder lokale Adressen sind als Agent-Endpunkt nicht erlaubt.",
      });
    }
  });

export const aiSettingsSchema = z.object({
  system_prompt: z.string().trim().max(SYSTEM_PROMPT_MAX, {
    message: `Der System-Prompt darf höchstens ${SYSTEM_PROMPT_MAX} Zeichen lang sein.`,
  }),
  tone: z.enum(["formal", "casual", "neutral"]),
  agent_provider: z.enum(["", "anthropic", "openai-compatible"]),
  agent_model: z.string().trim().max(AGENT_MODEL_MAX, {
    message: `Der Modell-Name darf höchstens ${AGENT_MODEL_MAX} Zeichen lang sein.`,
  }),
  agent_base_url: agentBaseUrlSchema,
});

export type AiSettingsInput = z.input<typeof aiSettingsSchema>;

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
