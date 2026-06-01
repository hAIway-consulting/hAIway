import { requireOrgId } from "@/lib/db/org-context";
import { createServiceClient } from "@/lib/db/supabase-server";

export const dynamic = "force-dynamic";

interface ShopwareConfig {
  provisioning?: string;
  claim_token?:  string;
  shop_id?:      string;
  shop_url?:     string;
}

const STEPS = [
  "App-Paket (ZIP) unten herunterladen (enthält deinen einmaligen Verknüpfungs-Token).",
  "Im Shopware-Admin: Erweiterungen → Meine Erweiterungen → Erweiterung hochladen → die heruntergeladene ZIP-Datei wählen.",
  "Die App installieren und aktivieren — Shopware verbindet sich dann automatisch mit hAIway.",
  "Diese Seite neu laden: Der Status wechselt nach erfolgreicher Installation auf „Verbunden“.",
];

export default async function ShopwareAppPage() {
  const orgId = await requireOrgId();
  const db = createServiceClient();
  const { data } = await db
    .from("organization_integrations")
    .select("config, status")
    .eq("organization_id", orgId)
    .eq("provider_id", "shopware")
    .maybeSingle<{ config: ShopwareConfig; status: string }>();

  const status = data?.status ?? "none";
  const isActive      = status === "active";
  const isConfiguring = status === "configuring"; // registration started, awaiting confirmation
  const shopUrl       = data?.config?.shop_url;

  const statusLabel =
    isActive      ? "Verbunden" :
    isConfiguring ? "Registrierung läuft …" :
    status === "pending" ? "Wartet auf Installation im Shop" :
                    "Noch nicht eingerichtet";
  const statusColor =
    isActive      ? "var(--color-success)" :
    isConfiguring ? "var(--color-warning)" :
                    "var(--color-placeholder)";

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Integrationen · Shopware · App-System
        </span>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Shopware per App verbinden
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Empfohlener Weg: Der Kunde installiert eine hAIway-App in seinem Shop. Shopware tauscht
          die Zugangsdaten dann automatisch und sicher aus (App-System-Handshake) — kein manuelles
          Kopieren von Client-ID und Secret nötig.
        </p>
      </header>

      <div
        className="rounded-xl p-4 flex items-center justify-between gap-3"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
      >
        <span className="text-[13px] font-medium" style={{ color: "var(--color-text)" }}>
          Status
        </span>
        <span className="text-[13px] font-semibold" style={{ color: statusColor }}>
          {statusLabel}{isActive && shopUrl ? ` · ${shopUrl}` : ""}
        </span>
      </div>

      {!isActive && (
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold"
                style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
              >
                {i + 1}
              </span>
              <span className="text-[13px] pt-0.5" style={{ color: "var(--color-text)" }}>{step}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-col gap-3 rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
        <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-placeholder)" }}>
          App-Paket
        </span>
        <a
          href="/api/shopware/app/manifest"
          className="self-start min-h-[44px] px-5 inline-flex items-center rounded-lg text-sm font-semibold"
          style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
        >
          App-Paket (ZIP) herunterladen
        </a>
        <span className="text-[11px]" style={{ color: "var(--color-placeholder)" }}>
          Das ZIP enthält die Manifest-Datei mit einem einmaligen Token, der den Shop mit dieser Org verknüpft. Nicht weitergeben.
        </span>
      </div>

      {isActive && (
        <div className="rounded-xl p-4" style={{ background: "var(--color-accent-soft)", border: "1px solid var(--color-line)" }}>
          <p className="text-sm" style={{ color: "var(--color-success)" }}>
            Shopware ist über das App-System verbunden. Du kannst die App jederzeit im Shop deinstallieren,
            um die Verbindung zu trennen.
          </p>
        </div>
      )}

      <div className="flex items-center gap-4">
        <a href="/admin/integrationen" className="text-[12px]" style={{ color: "var(--color-muted)", textDecoration: "underline" }}>
          ← Zurück zur Übersicht
        </a>
        <a href="/admin/integrationen/shopware/setup" className="text-[12px]" style={{ color: "var(--color-muted)", textDecoration: "underline" }}>
          Alternativ: manuell mit Client-ID/Secret verbinden
        </a>
      </div>
    </div>
  );
}
