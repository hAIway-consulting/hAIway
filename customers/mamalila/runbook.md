# Runbook — mamalila

> Vorlage für weitere Kunden: Kopieren, anpassen. Dieses Dokument hält den
> Onboarding-Stand und die Besonderheiten des Kundenprojekts fest — alles,
> was nicht in `customer.json` (maschinenlesbar) steckt.

## Steckbrief

| | |
|---|---|
| Kunde | mamalila (Shopware-Händlerin, Tragejacken/Babytragen) |
| Prod-Org-Slug | `mamalila` |
| Sandbox-Org | `claude-test-mamalila` |
| Plan | standard |
| Cases | Reklamation (Retouren-Automation) · Support (Antwortentwürfe) |
| Out of scope | JTL-Anbindung |

## Aktive Automationen

| Template | Status | Hinweise |
|---|---|---|
| `shopware-reklamation` | draft — wartet auf Integrations-Setup | Retoure erst nach Berater-Freigabe (`human_approval`) |
| `shopware-support` | draft | Antwortentwurf landet als Trello-Karte, wird nie automatisch versendet |

## Setup-Stand / offene Schritte

- [ ] Prod-Org `mamalila` anlegen (`scripts/ops/create-customer-org.mjs`)
- [ ] Sandbox `claude-test-mamalila` anlegen (`scripts/ops/create-sandbox-org.mjs --for mamalila`)
- [ ] Shopware-Integration verbinden (Admin-API Client-Credentials der Händlerin)
- [ ] Trello-Integration verbinden + `trello_list_id` in `customer.json` eintragen
- [ ] Inbound-Mail-Webhook konfigurieren (Weiterleitung des Support-Postfachs)
- [ ] `sync-customer.mts --customer mamalila --org claude-test-mamalila --apply`
- [ ] Seeds einspielen + End-to-End-Test in der Sandbox
- [ ] Nach Abnahme: Sync gegen Prod-Org + Aktivierung im Berater-Cockpit

## Besonderheiten

- Prompts sind auf Deutsch, Sie-Form; Shop-Name in Antworten: "mamalila".
- Retourengrund-Default: "Kundenreklamation".
- Seeds in `seed/inbound-mails.json` sind anonymisierte, realistische Fälle
  (Reklamation mit Bestellnummer, Größenberatung, Falschlieferung,
  Lieferantenrechnung als Negativfall).

## Kontakte

- Berater: Thomas (thomas@bernwald.net)
