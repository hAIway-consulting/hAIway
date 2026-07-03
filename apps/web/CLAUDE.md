# apps/web — Frontend-Details

> Ergänzt Root `CLAUDE.md`. Gilt nur für Arbeit im `apps/web/` Verzeichnis.

## Rolle im Monorepo

`apps/web` ist die UI-Shell: Routes, Components, Server Actions und dünne
Next-Adapter. Geteilte Verträge (Queue-Messages, Automation-Definitionen)
kommen aus `@haiway/contracts` — dort definieren, nie hier duplizieren.

```
src/
  app/            Routes (deutsche Slugs) + Server Actions
    _workspace/   Persona-Dashboards (workspace / berater / haiway)
    admin/        Berater-Cockpit (requireBeraterRole)
    chat/, search/, quellen/, sources/, telefon-assistent/, auth/, ...
  components/     layout, phone, providers, ui
  lib/
    db/           supabase-server/browser + org-context (Next-gebunden:
                  cookies, react cache — bleiben hier), queries/
    ai/, content/, features/, constants/
```

- Neue Fachlogik ohne Next-Kopplung gehört perspektivisch nach
  `packages/core` (DI: `SupabaseClient` als Parameter), nicht in `lib/`.
- Kundenspezifik nie hier verdrahten — sie lebt in `customers/<slug>/`
  und erreicht die App als Daten (DB).

## Dark Mode

- Aktiv via `prefers-color-scheme` (System-Praeferenz) + `.dark` Klasse auf `<html>`
- Alle Farben via CSS Custom Properties in `globals.css` — Light-Tokens in `:root`, Dark-Tokens im `.dark` Selektor
- **Nie hardcoded Farben** (`#fff`, `#000`, `bg-white`, `text-black` etc.) — immer `var(--color-xxx)` oder Token-Klassen aus `table-classes.ts` verwenden
- Inline-Styles: `style={{ background: "var(--color-panel)" }}` statt `style={{ background: "#fff" }}`
- Neue Features muessen in Light UND Dark funktionieren — keine Farbe ohne Token
