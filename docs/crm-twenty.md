# CRM (Twenty) — Betriebs-Runbook

Selbst gehostetes [Twenty CRM](https://twenty.com) als interner CRM-Arbeitsplatz.
Architektur: Twenty läuft auf einem eigenen VPS (Docker Compose + Caddy/TLS), die
hAIway-Plattform steuert Zugriff und Rollen zentral über `/admin/crm`
(Berechtigungs-Sync via Twenty-API, Feature-Flag `crm_workspace`).

Infra-Dateien: `infra/twenty/` (Compose, Caddyfile, `.env.example`, `backup.sh`).

> **Kein iframe, kein SSO:** Twenty verbietet Einbettung per CSP; SAML/OIDC-SSO ist
> auch self-hosted ein Bezahl-Feature. Der Dashboard-Reiter „CRM" öffnet Twenty im
> neuen Browser-Tab; Nutzer melden sich dort mit E-Mail/Passwort oder Google an.

---

## 1. VPS provisionieren (Hetzner)

1. [console.hetzner.com](https://console.hetzner.com) → Projekt wählen → **Server hinzufügen**:
   - Standort: **Falkenstein** oder **Nürnberg** (EU/DSGVO)
   - Image: **Ubuntu 24.04**
   - Typ: **CX22** (2 vCPU / 4 GB RAM, ~4 €/Monat) — 2 GB sind Twenty-Minimum, 4 GB der sichere Betriebspunkt
   - SSH-Key hinterlegen (kein Passwort-Login)
2. Ersteinrichtung per SSH (`ssh root@<ip>`):

   ```bash
   apt-get update && apt-get -y upgrade
   # Docker (offizielles Install-Skript)
   curl -fsSL https://get.docker.com | sh
   # Firewall: nur SSH + HTTP/HTTPS
   ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
   # Unattended Upgrades für Security-Patches
   apt-get -y install unattended-upgrades
   ```

## 2. DNS

- Produktiv: A-Record `crm.<domain>` → VPS-IP setzen (beim Domain-Registrar).
- Übergangsweise ohne DNS-Zugriff funktioniert [sslip.io](https://sslip.io):
  Hostname `<ip-mit-bindestrichen>.sslip.io` (z. B. `203-0-113-10.sslip.io`) zeigt
  automatisch auf die IP — Caddy stellt auch dafür TLS aus. Bei späterem Wechsel
  auf die echte Domain: `.env` (`CRM_DOMAIN`, `SERVER_URL`) anpassen,
  `docker compose up -d`, danach die URL in `/admin/crm` aktualisieren.

## 3. Twenty installieren

```bash
mkdir -p /opt/twenty && cd /opt/twenty
# Dateien aus dem Repo-Ordner infra/twenty/ hierher kopieren (scp oder git)
cp .env.example .env
# .env füllen: CRM_DOMAIN, SERVER_URL, PG_DATABASE_PASSWORD,
# ENCRYPTION_KEY + APP_SECRET jeweils per: openssl rand -base64 32
docker compose up -d
docker compose ps       # server muss "healthy" werden (Erststart ~2-3 Min: DB-Migrationen)
```

Danach `https://<CRM_DOMAIN>` öffnen → Admin-Konto + Workspace anlegen
(Workspace-Name z. B. „hAIway", Logo unter Settings → Workspace hochladen).

## 4. Twenty für den Sync vorbereiten

1. **Rollen:** Settings → Roles — Standardrollen prüfen bzw. anlegen (mind. „Member",
   „Admin"). Die Rollen-IDs braucht man nicht manuell: `/admin/crm` lädt sie per
   „Rollen aus Twenty laden".
2. **API-Key:** Settings → API & Webhooks → **+ Create key** (Name `haiway-sync`).
   Key wird nur einmal angezeigt — direkt kopieren.
3. **Service-Login (empfohlen):** eigenes Konto `service@<domain>` als Workspace-Admin
   einladen. Es dient als Fallback für Einladungs-Mutationen, die einen User-Kontext
   verlangen (reine API-Keys dürfen `sendInvitations` je nach Version nicht aufrufen).
4. **E-Mail-Versand (optional, für Einladungs-Mails):** SMTP-Variablen in Compose
   ergänzen (`EMAIL_DRIVER`, `EMAIL_SMTP_*` — siehe Twenty-Doku). Ohne SMTP werden
   Einladungen als Link erzeugt, den `/admin/crm` zum Kopieren anzeigt.

## 5. In hAIway verbinden

1. `/admin/integrationen` → Karte **Twenty CRM** → verbinden.
2. `/admin/crm`: Twenty-URL + API-Key (+ optional Service-Login) eintragen →
   Verbindungstest → „Rollen aus Twenty laden" → Level-Mapping speichern
   (Standard: `member` → Member, `admin` → Admin; weitere Level jederzeit ergänzbar).
3. Feature-Flag `crm_workspace` für die Org aktivieren (`/admin/kunden/<org>` →
   Features), falls der Plan es nicht ohnehin enthält (Premium/Enterprise).
4. Mitgliedern unter `/admin/crm` ein Level zuweisen → Einladung läuft automatisch;
   Status-Badges zeigen `synced` / `pending` / `manual_required` / `error`.
   „Jetzt abgleichen" gleicht Rollen ab und deckt Drift auf.

## 6. Backup & Restore

- `backup.sh` nach `/opt/twenty/` kopieren, ausführbar machen, Cron einrichten:
  `0 3 * * * /opt/twenty/backup.sh >> /var/log/twenty-backup.log 2>&1`
  (nächtlicher `pg_dump`, 14 Tage Rotation in `/opt/twenty/backups`).
- Restore:

  ```bash
  cd /opt/twenty && docker compose stop server worker
  docker compose exec -T db pg_restore -U postgres -d default --clean --if-exists \
    < backups/twenty-<stamp>.dump
  docker compose start server worker
  ```

- Datei-Uploads liegen im Volume `server-local-data` — bei Bedarf zusätzlich per
  `docker run --rm -v twenty_server-local-data:/data -v /opt/twenty/backups:/out alpine tar czf /out/uploads-<stamp>.tgz /data` sichern.

## 7. Update

1. Release-Notes prüfen: <https://github.com/twentyhq/twenty/releases>
2. Vorher Backup laufen lassen (`./backup.sh`).
3. `TAG` in `/opt/twenty/.env` auf die neue Version setzen (immer pinnen, nie `latest`).
4. `docker compose pull && docker compose up -d` — der Server führt DB-Migrationen
   beim Start selbst aus.
5. Danach in hAIway: `/admin/crm` → Verbindungstest + „Jetzt abgleichen". Der Test
   prüft die vom Sync genutzten Endpunkte — schlägt er nach einem Update fehl, haben
   sich API-Namen geändert (bekanntes Risiko bei Major-Releases): Tag zurückdrehen
   und `supabase/functions/_shared/twenty.ts` anpassen.

## 8. Troubleshooting

| Symptom | Ursache / Abhilfe |
|---|---|
| Badge `manual_required` bei Vergabe | Weder API-Key noch Service-Login dürfen einladen → Nutzer manuell in Twenty einladen (Settings → Members), danach „Jetzt abgleichen" — die Rolle wird dann automatisch gesetzt |
| Badge `pending` bleibt lange | Einladung noch nicht angenommen. Ohne SMTP: Invite-Link aus Twenty kopieren und direkt schicken |
| Badge `error` | `sync_error`-Text auf der Zeile (Tooltip) lesen; Twenty-Erreichbarkeit prüfen (`docker compose ps`, `docker compose logs server`) |
| Drift „In Twenty ohne Freigabe" | Nutzer wurde direkt in Twenty angelegt → entweder in `/admin/crm` ein Level vergeben oder in Twenty entfernen |
| Rollen-Drift trotz Sync | hAIway ist Source of Truth — „Jetzt abgleichen" setzt die Twenty-Rolle zurück |
| Nutzer nutzt andere E-Mail in Twenty | Sync matched über E-Mail (lowercase). Konto in Twenty auf die hAIway-E-Mail umstellen oder manuell auflösen |
| Server unhealthy nach Neustart | `docker compose logs server` — meist fehlende/falsche `.env`-Secrets (`ENCRYPTION_KEY` niemals rotieren, sonst sind verschlüsselte Daten weg) |

## Sicherheits-Notizen

- Der Twenty-API-Key liegt in `organization_integrations.credentials` und wird
  ausschließlich serverseitig gelesen (Edge Function / Service-Client) — nie im Browser.
  Bekanntes plattformweites Follow-up: Credentials-Spalte ist für Org-Mitglieder
  row-lesbar (Bestandsmuster, betrifft auch Trello/Shopware).
- VPS: nur Ports 22/80/443 offen, SSH nur per Key, unattended-upgrades aktiv.
- `ENCRYPTION_KEY`/`APP_SECRET` nur in `/opt/twenty/.env` (Server) — nie ins Repo.
