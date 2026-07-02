# Vault Context

Dieses Vault ist das zweite Gehirn von Alex Drachenberg.

## Über mich

Alex Drachenberg, System- und Netzwerkadministrator (50 J.). Entwickelt iXevora — ein kognitives Trainings-OS mit EEG, Gamification, Schach und Sprachlesen. Jobsuche (Koblenz / Schweiz) läuft parallel. Ausführliches Profil: [[00 Kontext/Über mich]].

## Vault-Sprache

Russisch (primär) + Deutsch (bestehende Dokumente bleiben wie sie sind)

## Vault-Struktur

- **00 Kontext/**: Persönliches Profil (Über mich, Schreibstil, Fokus). Lies diese Dateien bei Content-Aufgaben, Mails oder Entscheidungen.
- **01 Inbox/**: Schnelle Gedanken, unverarbeitete Notizen. Alles ohne festen Platz landet hier.
- **02 Projekte/**: Aktive Projekte mit konkretem Ziel.
  - [[02 Projekte/iXevora/🧠 Ixevora — Hauptseite|iXevora]] — Mental Performance OS (Phase 1 ✅ / Phase 2 ⏳)
  - [[02 Projekte/Unity Practice App|Unity Practice App]]
- **03 Bereiche/**: Laufende Themen ohne Enddatum.
  - [[03 Bereiche/Gehirntraining/Gehirntraining|Gehirntraining]] — Techniken, Methoden, Neuroplastizität
- **04 Ressourcen/**: Referenzmaterial und Wissen.
  - [[04 Ressourcen/Gehirnjoggingtechniken/Gehirnjoggingtechniken|Gehirnjoggingtechniken]]
- **05 Daily Notes/**: Tägliches Logbuch. Format: YYYY-MM-DD.md
- **06 Archiv/**: Abgeschlossene Projekte und inaktive Bereiche.
- **07 Anhänge/**: Bilder, PDFs, Medien.

## Vault-Regeln

- [[Wikilinks]] für Verknüpfungen zwischen Notizen
- Neue Notizen ohne klaren Platz → 01 Inbox/
- YAML Frontmatter nutzen: tags, status (aktiv/abgeschlossen/pausiert), date
- Dateinamen mit Leerzeichen: Beschreibender Name.md
- "Merk dir das" → in die passende Kontext-Datei speichern
- Dateien löschen oder überschreiben → erst fragen

## Session-Routinen

### Session-Start
01 Inbox/ prüfen. Zeige was drin liegt und biete Einsortieren an.

### Kontext-Briefing
Bei "Was war aktuell?" oder "Wo war ich?": letzte 2–3 Daily Notes + aktive Projektdateien lesen.

### Session-Ende
Anbieten: Daily Note erstellen, neue Erkenntnisse speichern, Inbox aufräumen.

## Aktive Projekte

| Projekt | Status | Pfad |
|---|---|---|
| iXevora | Phase 1 ✅ / Phase 2 ⏳ | [[02 Projekte/iXevora/🧠 Ixevora — Hauptseite]] |
| Jobsuche Koblenz/CH | Aktiv | — |




## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Projekt: Unity Practice — Website

Statische Marketing-Website (kein Framework/Build-Step) für die Unity-Practice-App.
Jede Unterseite ist eine eigenständige HTML-Datei mit Inline-`<style>` und Inline-`<script>`.

**Mehrsprachigkeit:** DE/RU/EN/ES über ein `T`-Objekt pro Seite, Texte per
`data-i18n="key"`-Attribut markiert, angewendet über `applyLang(lang)`. Neue/geänderte
Texte immer in allen 4 Sprachblöcken parallel pflegen.

**Marken-Terminologie (Russisch):** In russischem Fließtext heißt die Praxis
**„Практика Единства"** (nicht „Unity Practice", nicht „Единая практика").
Ausnahme: `index.html` behält aktuell noch 4 Altstellen mit „Единая практика" im
Fließtext (bewusst offen gelassen, Stand 2026-07-01) — Meta-Tags (`<title>`,
`description`, `og:*`, `twitter:*`) auf `index.html` sind bereits auf
„Практика Единства" umgestellt.

**Assets:** Bilder als echte Dateien unter `/assets/` referenzieren, keine
Base64-Data-URIs mehr neu einbetten (Performance).

**Git:** Nach größeren, verifizierten Änderungen automatisch committen und pushen
(keine explizite Freigabe pro Mal mehr nötig). Klare, beschreibende Commit-Message
verwenden. Keine destruktiven Git-Operationen (force-push, reset --hard etc.) ohne
Rückfrage.

**Vault-Doku:** Entscheidungen und offene Punkte zu diesem Projekt werden zusätzlich
im Obsidian-Vault festgehalten (nicht nur im Chat):
- Entscheidungen: `C:\Users\alexd\Documents\Knowledge\Apps\Unity Practice\02-Entscheidungen.md`
- Offene Punkte/Baustellen: `C:\Users\alexd\Documents\Knowledge\Apps\Unity Practice\06-Offene-Punkte.md`
Format: ein Abschnitt pro Eintrag (Datum + Kurztitel), auf Russisch, anhängen statt überschreiben.

**Verifikation:** Änderungen im Preview-Browser testen (Sprachumschaltung, Konsole
auf Fehler prüfen), bevor sie als erledigt gemeldet werden.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---