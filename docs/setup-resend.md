# Resend + Supabase Auth — Setup-Anleitung

Schritte, damit gebrandete Login-/Invite-Mails aus TimeKeeper verschickt werden. Absender-Domain: `app.haiway-consulting.com`.

## 1. Resend-Konto und Domain

1. Account anlegen auf https://resend.com (falls noch nicht vorhanden).
2. **Domains → Add Domain** → `app.haiway-consulting.com` eintragen → Region wählen (EU, Frankfurt).
3. Resend zeigt DNS-Records an, die im Cloudflare-DNS von `haiway-consulting.com` einzutragen sind:
   - **MX** (`send.app`) — Receive bounces
   - **TXT** SPF (`send.app`) — z. B. `"v=spf1 include:amazonses.com ~all"`
   - **TXT** DKIM — `resend._domainkey.app`
   - Optional **TXT** DMARC auf der Root-Domain (`_dmarc.haiway-consulting.com`, `p=none`)
4. Nach DNS-Propagation (meist < 15 min) in Resend auf **Verify** klicken.

## 2. Resend-API-Key erstellen

1. Resend Dashboard → **API Keys** → **Create API Key**.
2. Name: `timekeeper-supabase-smtp`. Permission: **Sending access**. Domain: `app.haiway-consulting.com`.
3. Key kopieren (wird nur einmal angezeigt). Nirgends ins Repo einchecken.

## 3. Supabase SMTP einrichten

Supabase Dashboard → Project → **Project Settings** → **Authentication** → **SMTP Settings** → **Enable Custom SMTP**.

| Feld | Wert |
|---|---|
| Sender email | `noreply@app.haiway-consulting.com` |
| Sender name | `hAIway consulting` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Minimum interval | `60` (Sekunden — Standard) |
| Username | `resend` |
| Password | *(Resend-API-Key aus Schritt 2)* |

Speichern. Danach **Send Test Email** (unten auf derselben Seite) an deine eigene Adresse — die Mail sollte mit `From: TimeKeeper <noreply@app.haiway-consulting.com>` ankommen.

## 4. E-Mail-Templates importieren

Für jedes Template in `supabase/templates/auth/` denselben Schritt:

1. Supabase Dashboard → **Authentication** → **Email Templates** → entsprechenden Typ öffnen.
2. **Subject** setzen (Vorgabe im HTML-Kommentar oben):
   - Magic Link → `Ihr Anmelde-Link für hAIway consulting`
   - Invite user → `Sie wurden zu hAIway consulting eingeladen`
   - Confirm signup → `Bestätigen Sie Ihr Konto bei hAIway consulting`
   - Reset password → `hAIway consulting: Passwort zurücksetzen`
3. **Message (HTML)**: komplett durch den Inhalt der entsprechenden `.html`-Datei ersetzen.
4. Speichern → **Send Test Email** zur Prüfung.

Change-Email-Template ignorieren wir vorerst (wird nur bei E-Mail-Wechsel getriggert).

## 5. URL Configuration in Supabase

Supabase Dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: `https://<produktions-domain>` (z. B. `https://time-keeper.vercel.app` oder deine Custom-Domain).
- **Redirect URLs** (Whitelist, eine pro Zeile):
  - `https://<produktions-domain>/auth/confirm`
  - `https://<produktions-domain>/auth/callback`
  - `http://localhost:3000/auth/confirm`
  - `http://localhost:3000/auth/callback`
  - `https://*.vercel.app/auth/confirm`
  - `https://*.vercel.app/auth/callback`

`/auth/confirm` ist die primäre Route für den Token-Hash-Flow (cross-device-sicher).
`/auth/callback` bleibt als PKCE-Fallback.

Ohne diese Whitelist verweigert Supabase den OTP-Callback.

## 6. Migration anwenden

Vor dem Deploy die neue Migration auf Staging + Prod ausführen:

```bash
supabase db push
```

Die Migration `20260414130000_org_is_platform.sql` setzt `is_platform = TRUE` für die TimeKeeper-Org. Ohne die Migration schlagen die Admin-Queries fehl (`column organizations.is_platform does not exist`).

## 7. Ende-zu-Ende-Test

1. Einen Testuser in einem Inkognito-Fenster auf `/auth/anmelden` → E-Mail eingeben → Mail kommt an (Branding prüfen) → Link klicken → landet im Dashboard.
2. Als Admin in `/admin/mein-unternehmen` einen Kollegen via Invite-Formular einladen → Einladungs-Mail kommt an → Link führt ins Dashboard mit Mitgliedschaft in TK-Org.
3. `/admin` prüfen: „Mein Unternehmen"-Card oben sichtbar, TK erscheint **nicht** mehr in der Kunden-Liste.

## Kosten

Resend Free-Tier: 3.000 Mails/Monat, 100/Tag. Reicht für die Anfangsphase locker. Später „Pro" 20 USD/Monat für 50.000 Mails.
