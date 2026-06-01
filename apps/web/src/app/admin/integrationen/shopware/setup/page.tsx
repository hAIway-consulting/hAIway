import { requireOrgId } from "@/lib/db/org-context";
import { createServiceClient } from "@/lib/db/supabase-server";
import { saveShopwareCredentials } from "./actions";

export const dynamic = "force-dynamic";

interface ShopwareCredentials {
  base_url?:      string;
  client_id?:     string;
  client_secret?: string;
}

export default async function ShopwareSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; base_url?: string; client_id?: string }>;
}) {
  const sp = await searchParams;
  const orgId = await requireOrgId();
  const db = createServiceClient();

  const { data } = await db
    .from("organization_integrations")
    .select("credentials, status")
    .eq("organization_id", orgId)
    .eq("provider_id", "shopware")
    .maybeSingle<{ credentials: ShopwareCredentials; status: string }>();

  const isConnected = data?.status === "active";
  // Query-string values (from a failed submit) win over stored values so the
  // user keeps what they just typed; the secret is intentionally never echoed.
  const baseUrl  = sp.base_url  ?? data?.credentials?.base_url  ?? "";
  const clientId = sp.client_id ?? data?.credentials?.client_id ?? "";

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Integrationen · Shopware
        </span>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Shopware verbinden
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Lege in Shopware unter <span style={{ color: "var(--color-text)" }}>Einstellungen → System → Integrationen</span> eine
          Integration an und trage hier Shop-URL, Access Key ID und Secret Access Key ein. hAIway
          authentifiziert sich darüber serverseitig (client_credentials) — Shopware bietet keinen
          interaktiven Login-OAuth.
        </p>
      </header>

      {isConnected && (
        <div className="rounded-xl p-4" style={{ background: "var(--color-accent-soft)", border: "1px solid var(--color-line)" }}>
          <p className="text-sm" style={{ color: "var(--color-success)" }}>
            Shopware ist bereits verbunden. Du kannst die Zugangsdaten unten neu setzen — sie werden
            vor dem Speichern erneut getestet.
          </p>
        </div>
      )}

      {sp.error && (
        <div className="rounded-xl p-4" style={{ background: "var(--color-danger-soft, var(--color-bg-elevated))", border: "1px solid var(--color-line)" }}>
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            {sp.error}
          </p>
        </div>
      )}

      <form action={saveShopwareCredentials} className="flex flex-col gap-4 rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-placeholder)" }}>
            Shop-URL
          </span>
          <input
            type="url"
            name="base_url"
            required
            defaultValue={baseUrl}
            placeholder="https://shop.example.com"
            inputMode="url"
            autoComplete="off"
            className="min-h-[44px] rounded-lg px-3 text-sm"
            style={{ background: "var(--color-bg)", border: "1px solid var(--color-line)", color: "var(--color-text)" }}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-placeholder)" }}>
            Access Key ID
          </span>
          <input
            type="text"
            name="client_id"
            required
            defaultValue={clientId}
            placeholder="SWIA…"
            autoComplete="off"
            className="min-h-[44px] rounded-lg px-3 text-sm"
            style={{ background: "var(--color-bg)", border: "1px solid var(--color-line)", color: "var(--color-text)" }}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-placeholder)" }}>
            Secret Access Key
          </span>
          <input
            type="password"
            name="client_secret"
            required
            placeholder={isConnected ? "Zum Ändern neu eingeben" : "••••••••"}
            autoComplete="off"
            className="min-h-[44px] rounded-lg px-3 text-sm"
            style={{ background: "var(--color-bg)", border: "1px solid var(--color-line)", color: "var(--color-text)" }}
          />
          <span className="text-[11px]" style={{ color: "var(--color-placeholder)" }}>
            Wird nur serverseitig gespeichert und beim Speichern direkt gegen den Shop getestet.
          </span>
        </label>

        <button
          type="submit"
          className="self-start min-h-[44px] px-5 rounded-lg text-sm font-semibold"
          style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
        >
          Verbindung testen + speichern
        </button>
      </form>

      <a
        href="/admin/integrationen"
        className="text-[12px]"
        style={{ color: "var(--color-muted)", textDecoration: "underline" }}
      >
        ← Zurück zur Übersicht
      </a>
    </div>
  );
}
