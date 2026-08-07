# apps/web — Frontend-Details

> Ergänzt Root `CLAUDE.md`. Gilt nur für Arbeit im `apps/web/` Verzeichnis.

## Verzeichnisstruktur

```
src/
  app/                    Next.js App Router
    layout.tsx            Root-Layout (Persona-Shell)
    page.tsx              Startseite (Workspace-Home)
    globals.css           Design-Tokens + Tailwind
    admin/                Berater-/Plattform-Bereich (Cockpit, Kunden, Integrationen,
                          CRM, Daten, AI-Keys/-Kosten/-Settings, Retrieval-Qualitaet)
    chat/  crm/  quellen/  sources/  papierkorb/  search/
    organisation/  berechtigungen/  telefon-assistent/
    auth/                 Login + OAuth-Callbacks
    api/                  Route Handler (inkl. dev-only /api/dev/test-login)
  components/
    layout/               Shell + Navigation (Persona-Varianten)
    ui/                   geteilte Primitives inkl. table-classes.ts
    phone/  providers/  audio-recorder.tsx
  lib/
    ai/                   Chat, Agent (Tool-Registry), Embeddings, Quota, Usage
    crm/                  Twenty-Sync-Dispatcher
    db/                   Supabase-Clients, org-context, queries/
    orchestrator/         Trello-Werkzeuge + Credential-Aufloesung
    features/  content/  constants/  validation/  app-url.ts  org-roles.ts
```

Konventionen: Seiten sind Server Components mit `export const dynamic = "force-dynamic"`,
Mutationen laufen ueber Server Actions in der jeweiligen `actions.ts`. Cross-mandantige
Admin-Seiten tragen einen harten `isPlatformAdmin()`-Gate — das weiche Gate in
`app/admin/layout.tsx` laesst Berater-Rollen bewusst durch.

## Dark Mode

- Aktiv via `prefers-color-scheme` (System-Praeferenz) + `.dark` Klasse auf `<html>`
- Alle Farben via CSS Custom Properties in `globals.css` — Light-Tokens in `:root`, Dark-Tokens im `.dark` Selektor
- **Nie hardcoded Farben** (`#fff`, `#000`, `bg-white`, `text-black` etc.) — immer `var(--color-xxx)` oder Token-Klassen aus `table-classes.ts` verwenden
- Inline-Styles: `style={{ background: "var(--color-panel)" }}` statt `style={{ background: "#fff" }}`
- Neue Features muessen in Light UND Dark funktionieren — keine Farbe ohne Token

## Status

Produktiv im Einsatz. Der Feature-Audit vom 2026-08-06 hat die nie durchdachten
Bereiche entfernt (Skills-Registry, Automatisierungs-Komplex, Orchestrator-
Connectoren ohne Runtime); was hier noch steht, wird benutzt. Neue Bereiche
werden gegen die bestehenden Bausteine gebaut, nicht daneben.
