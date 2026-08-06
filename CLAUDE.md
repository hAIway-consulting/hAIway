# TimeKeeper — AI Foundation Platform

## Projekt

Wiederverwendbare AI Foundation Platform. Eigenes Startup = erster Tenant. Gleiches Datenmodell später für externe Kunden. Ziel: standardisiertes Betriebsmodell für KI-fähige Unternehmensdaten.

**Infra:** GitHub · Supabase (DB + Auth + Storage) · Vercel (Hosting)

## Stack

| Schicht | Technologie |
|---------|-------------|
| Runtime | Next.js 16 (App Router, Server Components, Server Actions) |
| UI | React 19, TypeScript 5.9 |
| Styling | Tailwind v4 + CSS-Tokens in `globals.css` |
| DB | Supabase PostgreSQL + pgvector + RLS |
| Storage | Supabase Storage (Bucket `source-files`) |
| Validation | Zod 4 |
| Monorepo | npm workspaces (`apps/web`) |

## Regeln (nicht verhandelbar)

1. **Lokales Testen Pflicht** — TypeCheck + Lint vor jedem Push. Build + Dev-Server bei Bedarf. Production nur via PR-Merge nach `main`. **Niemals direkt auf `main` pushen.**
2. **Tokens only + Dark Mode** — Farben/Radii nur aus `globals.css`. Keine Ad-hoc-Farben (`#fff`, `bg-white` etc.). Dark Mode ist aktiv — alle neuen Features müssen mit Light- und Dark-Tokens funktionieren.
3. **Mobile-first ab 360px** — Breakpoints: `md:` 768px · `lg:` 1024px. Kein horizontaler Scroll.
4. **Touch: 44px** — `min-h-[44px] min-w-[44px]` auf allen interaktiven Elementen.
5. **Safe Area** — Bottom-Elemente: `pb-[env(safe-area-inset-bottom)]`
6. **UI-Texte Deutsch**, Code + Kommentare Englisch.
7. **DB-Änderungen** nur via `supabase/migrations/` mit RLS.
8. **Business-Logik** in DB-Functions / Edge Functions, nicht in der App.
9. **Card-Radius: `rounded-xl`** (16px). `rounded-2xl` nur für Modals/Bottom-Sheets.

## Strategy Gate (Pflicht vor jeder Plan-/Implementierungsphase)

Vor Planung oder Umsetzung jeder nicht-trivialen Aufgabe:

1. `docs/strategie.md` lesen.
2. Aufgabe gegen die fünf **Strategischen Filterfragen** prüfen (Orchestrator-vs-Klon · Ergebnis-vs-Feature · Multi-Tenant-fähig · baut auf bestehende Bausteine · Berater im Lead).
3. Wenn die Aufgabe **klar passt** → normal weitermachen und im Plan einen kurzen Abschnitt **Strategy Fit** (1–2 Sätze) ergänzen, der begründet warum.
4. Wenn die Aufgabe **nicht klar passt oder widerspricht** → NICHT bauen. Stattdessen den User per Rückfrage konfrontieren: welcher Teil der Strategie ist betroffen, welche Alternativen gibt es.

Trivial = Bugfix, Typo, Style-Token-Korrektur, reine Doku-Edits. Alles andere durchläuft das Gate.

## Deployment — Workflow

**Grundprinzip:** Ein Feature = ein Branch = ein Worktree = ein PR = eine Vercel-Preview.
`main` ist heilig — dort landet Code ausschliesslich per PR-Merge nach User-Freigabe.

### Worktree-Konvention

- Hauptrepo (`C:\Users\thoma\Desktop\Coding\Time keeper`) bleibt **immer auf `main`**.
- Pro Feature ein eigener Worktree unter:
  `C:\Users\thoma\Desktop\Coding\Time keeper.worktrees\<branch-name>`
- Branch-Naming: `feature/<kurz-name>` · `fix/<kurz-name>` · `chore/<kurz-name>`
- Worktree-Lifecycle:
  ```
  git worktree add ../Time\ keeper.worktrees/<branch> -b <branch> origin/main
  # ... arbeiten, committen, pushen, PR mergen ...
  git worktree remove ../Time\ keeper.worktrees/<branch>
  git branch -d <branch>
  ```
- Bei jedem neuen Feature fragt Claude den User: *"Neuer Worktree fuer dieses Feature?"* — und legt ihn nur nach Bestaetigung an.

### Entwicklung (Claude fuehrt aus)

1. **Worktree + Feature-Branch anlegen** (ausserhalb des Hauptrepos, von `origin/main`). `.env.local` aus Hauptrepo in den Worktree kopieren (sie ist gitignored und wandert nicht automatisch mit).
2. **Code schreiben + aendern** im Worktree.
3. **Autonomer Dev-Loop bis Smoke-Test gruen** (siehe naechster Abschnitt). Pflicht vor jedem Push:
   - `npm run typecheck --workspace apps/web`
   - `npm run lint --workspace apps/web`
   - Dev-Server starten und Smoke-Test laufen lassen (Login + golden path)
   - Bei Fehlern: lesen, fixen, re-run — bis zu den Eskalationsgrenzen
   - Bei groesseren Aenderungen zusaetzlich `npm run build --workspace apps/web`
   - Security-Check
4. **Commit + Push auf den Feature-Branch** (`git push -u origin <branch>`). **Niemals auf `main`.**
5. **PR oeffnen** via `gh pr create --base main` mit Titel + Test-Plan-Checkliste.
6. **Vercel Preview-URL** (von Vercel automatisch pro PR) an den User melden — **erst dann uebernimmt der User**.
7. **User testet Preview** → gibt Freigabe oder Feedback.
8. Bei Feedback: zurueck zu Schritt 2 im selben Worktree.
9. **Nach User-Freigabe:** PR mergen (Squash empfohlen) → Vercel deployt automatisch nach Production.
10. **Auto-Cleanup (immer):** Worktree entfernen, lokalen Branch loeschen, im Hauptrepo `git pull` auf `main`. User-Bestaetigung dafuer ist nicht noetig.

### Autonomer Dev-Loop (Schritt 3 in Detail)

**Ziel:** Bis zum PR ist der User raus. Claude iteriert selbst, bis der Smoke-Test gruen ist.

**Setup pro Worktree (einmalig):**
- Port-Vergabe: `node scripts/dev-loop/dev-port.mjs` → stabiler Port pro Branch (Hauptrepo `main` = 3000, alle Feature-Branches `3100..3999`).
- Dev-Server starten: `PORT=$(node scripts/dev-loop/dev-port.mjs) npm run dev --workspace apps/web` als Background-Task.
- Smoke-Test laufen: `DEV_PORT=$(node scripts/dev-loop/dev-port.mjs) npx playwright test e2e/smoke.spec.ts`

**Test-Daten — Sandbox-Org `claude-test`:**
- Org-ID: `c20b8a68-363c-4df9-9409-bbf1a881b072` (Slug `claude-test`, Name `[CLAUDE-TEST] Sandbox`).
- Tester-Login: E-Mail und Passwort stehen ausschliesslich in `apps/web/.env.local` unter `TEST_LOGIN_CLAUDE_TESTER_EMAIL` / `TEST_LOGIN_CLAUDE_TESTER_PASSWORD` (Rolle `admin`, `is_default=true`). Niemals ins Repo schreiben.
- Setup neu/idempotent: `node --env-file=apps/web/.env.local scripts/dev-loop/setup-test-org.mjs`
- Aufraeumen nach jedem Iterationsblock: `node --env-file=apps/web/.env.local scripts/dev-loop/cleanup-test-org.mjs` — wischt alle org-gescopeten Tabellen, laesst Org/User/Profile/Member stehen.
- **Niemals gegen `time-keeper` (Prod-Org) testen.** Cleanup-Skript verweigert das aktiv.

**Login im Test:** `GET /api/dev/test-login?user=claude-tester&next=/<ziel>` setzt das Supabase-Cookie und redirected. Endpoint ist hard-disabled wenn `NODE_ENV !== "development"` (gibt 404). Fehlen die `TEST_LOGIN_*`-Variablen, antwortet der Endpoint mit 503 statt still auf ein bekanntes Passwort zurueckzufallen.

**Eskalation an User (Loop sofort stoppen, kurz melden):**
- Mehr als **5 Iterationen** fuer denselben Bug
- Mehr als **20 Minuten** ohne gruenen Smoke-Test
- TypeCheck nach Fix zweimal in Folge mit demselben Error
- Endpoint liefert 5xx (DB/Infra-Verdacht)
- Migration noetig (`supabase/migrations/*.sql`) — DB-Push immer User-bestaetigt
- Fehlende Env-Variable (z. B. `ANTHROPIC_API_KEY` ist lokal optional, fehlt aber bei Chat-Features)

### Supabase (separater Lifecycle)

- `supabase db push` und `supabase functions deploy` **nur nach expliziter User-Freigabe** und i. d. R. **erst nach PR-Merge**, weil sie auf die Prod-DB wirken.
- Migrations (`supabase/migrations/*.sql`) liegen im Feature-Branch und werden mit dem Code reviewed. Apply gegen Prod ist ein bewusster, separater Schritt.

## Sprachrichtlinie

- **UI-Texte** (Labels, Buttons, Platzhalter, Fehler): **Deutsch**
- **Code** (Variablen, Funktionen, Typen, Kommentare): **Englisch**
- `html lang="de"` im Root Layout

## Env-Variablen

Pflicht in `apps/web/.env.local` (per `npx vercel env pull` ziehbar):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000   # lokal IMMER localhost, sonst brechen Auth-Callbacks
DEFAULT_ORGANIZATION_SLUG=time-keeper
OPENAI_RESEARCH_TIMEKEEPER_KEY=             # bevorzugt; OPENAI_API_KEY ist Fallback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
NEXT_PUBLIC_VAPI_PUBLIC_KEY=
VAPI_API_KEY=
VAPI_SECRET=                # Shared Secret der Vapi-Webhooks. PFLICHT auch als
                            # Supabase-Secret (`supabase secrets set`) — die
                            # phone-assistant-Functions laufen mit
                            # verify_jwt=false und pruefen ausschliesslich
                            # dagegen. Fehlt es, lehnen sie seit dem Audit
                            # 2026-08-06 jeden Aufruf ab (vorher: fail-open).
VAPI_SERVER_URL=
```

Optional / situativ:

```
ANTHROPIC_API_KEY=          # in Vercel NICHT gesetzt; Edge-Functions ziehen ihn aus Supabase Secrets.
                            # Lokal nur fuer Chat-Features noetig — aus console.anthropic.com kopieren.
AI_KEYS_ENCRYPTION_SECRET=  # verschluesselt ai_provider_keys (AES-256-GCM). In Vercel UND Supabase
                            # Function Secrets identisch setzen. ACHTUNG: Verlust brickt gespeicherte
                            # Tenant-Keys (Env-Fallback haelt die Plattform am Leben, Keys neu erfassen).
```

Nur lokal (`apps/web/.env.local`) — **niemals in Vercel-Production und niemals ins Repo**.
Ohne sie antwortet `/api/dev/test-login` mit 503 und die e2e-Specs scheitern mit
klarer Meldung; `create-sandbox-org.mjs` bricht mit Hinweis ab.

```
TEST_LOGIN_CLAUDE_TESTER_EMAIL=     # Sandbox-Tester (Persona "berater")
TEST_LOGIN_CLAUDE_TESTER_PASSWORD=
TEST_LOGIN_MAX_EMAIL=               # Prod-Mitglied (Persona "workspace")
TEST_LOGIN_MAX_PASSWORD=
TEST_LOGIN_ANNA_EMAIL=              # Prod-Mitglied (Persona "workspace")
TEST_LOGIN_ANNA_PASSWORD=
SANDBOX_TESTER_PASSWORD=            # fuer scripts/ops/create-sandbox-org.mjs
```

## Agent-Workflow-Regeln

Diese Regeln gelten, wenn Claude über die GitHub Action (`@claude` in Issues/PRs
oder Label `claude`) autonom im Repo arbeitet:

- **Kleine, fokussierte PRs** — eine Aufgabe pro PR. Keine Sammel-Änderungen; lieber
  mehrere kleine PRs als einen grossen.
- **Niemals direkt auf `main` pushen** — Änderungen immer über einen Feature-Branch
  und PR. `main` bleibt heilig (siehe Deployment-Workflow oben).
- **Aussagekräftige Commit-Messages auf Englisch** — was und warum, nicht nur „fix".
  Conventional-Commit-Präfixe (`feat:`, `fix:`, `chore:` …) sind erwünscht.
- **Bei Unklarheiten nachfragen statt raten** — wenn ein Issue mehrdeutig ist oder
  Kontext fehlt, einen Klärungs-Kommentar im Issue hinterlassen und auf Antwort
  warten, statt eine Annahme zu implementieren.

## Sub-Dokumentation

- **Strategie / Nordstern** → `docs/strategie.md` (Pflichtlektüre via Strategy Gate · Präsentationsversion: `docs/strategie.html`)
- **Frontend-Details** → `apps/web/CLAUDE.md`
- **Datenbank / Migrations** → `supabase/CLAUDE.md`
