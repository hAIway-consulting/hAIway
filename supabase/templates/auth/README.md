# Supabase Auth E-Mail-Templates (hAIway-consulting-Branding)

Die HTML-Dateien in diesem Ordner sind **Referenz-Vorlagen** für die Supabase-Auth-E-Mail-Templates. Sie werden **nicht vom Code geladen** — Supabase hält die aktiven Templates im Project-Dashboard vor. Wir versionieren sie hier, damit sie reviewbar und reproduzierbar sind.

## Aktualisieren im Supabase-Dashboard

1. Supabase Dashboard → **Authentication** → **Email Templates**
2. Pro Template (Magic Link, Invite User, Confirm Signup, Reset Password, Change Email Address) den Inhalt der entsprechenden `.html`-Datei einfügen.
3. Subject-Zeile manuell setzen (siehe Kommentar am Anfang jedes Templates).
4. Speichern und mit **Send Test Email** prüfen.

## Verfügbare Template-Variablen (Supabase)

| Variable | Beispiel |
|---|---|
| `{{ .ConfirmationURL }}` | Vollständiger Klick-Link inkl. Token — **nicht nutzen** (PKCE, scheitert cross-device) |
| `{{ .SiteURL }}` | Site-URL aus Supabase-Einstellungen — Basis für eigene Callback-URLs |
| `{{ .TokenHash }}` | Hash des Tokens — **Haupt-CTA** via `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>` |
| `{{ .Email }}` | E-Mail-Adresse des Empfängers |
| `{{ .Token }}` | 6-stelliger OTP-Code |
| `{{ .Data.full_name }}` | User-Metadata aus `signUp({ options: { data: ... } })` |

### Warum `TokenHash` statt `ConfirmationURL`?

`{{ .ConfirmationURL }}` führt über Supabases eigenen `/auth/v1/verify`-Endpoint
und generiert einen **PKCE**-Code, den die App nur mit einem im Browser
gespeicherten `code_verifier`-Cookie einlösen kann. Öffnet der User den
Magic-Link auf einem anderen Gerät / im Mail-Client mit externem Browser /
nach Cookie-Löschung, fehlt der `code_verifier` → Login scheitert stumm.

`{{ .SiteURL }}/auth/confirm?token_hash=…&type=…` geht direkt an unsere
`/auth/confirm`-Route, die `verifyOtp` auf dem Server aufruft — kein
Client-State nötig, funktioniert cross-device.

### Type-Parameter je Template

| Template | `type=` |
|---|---|
| Magic Link | `magiclink` |
| Invite User | `invite` |
| Confirm Signup | `signup` |
| Reset Password | `recovery` |
| Change Email | `email_change` |

## Design-Konventionen

- Table-basiertes Layout (Outlook-kompatibel), max 600px Breite.
- Farben hart kodiert als Hex (keine CSS-Variablen — Mail-Clients ignorieren sie).
- Akzentfarbe: `#0d9488` (Teal, light) / `#14b8a6` (teal-500, dark).
- Dark-Mode per `@media (prefers-color-scheme: dark)` — greift in Apple Mail, Gmail iOS/Android, Outlook iOS. Outlook Desktop bleibt im Light-Mode (akzeptabel).
- Logo: `https://app.haiway-consulting.com/brand/email-logo.png` (Quelle: `apps/web/public/brand/email-logo.png`, 192×192 für 96px-Retina-Anzeige, schwarzer Hintergrund → funktioniert in Light & Dark identisch). Bei Logo-Änderung Asset ersetzen UND Templates erneut in Supabase einspielen.
- Footer enthält Impressum-Link + Absender-Hinweis.

## Checkliste nach Template-Änderungen

- [ ] Test-Mail an eigene Adresse + an Gmail/Apple/Outlook-Konto senden.
- [ ] Visuell prüfen: Light + Dark (System-Theme umschalten beim Öffnen).
- [ ] Klick-Ziel prüfen (Magic-Link loggt korrekt ein).
- [ ] Spam-Test: https://www.mail-tester.com/
