# docs/tasks — Operative Task-Infrastruktur

Operative Übergabeschicht für laufende Aufgaben zwischen ChatGPT, Claude und Cursor.

## Unterschied zu docs/reviews

- `docs/tasks/T-xxxx_<name>/` = operative Arbeit (Brief, Scope, Impl-Report, Validation-Report)
- `docs/reviews/` = kanonische repo-spezifische Reviews und Audits

## Standard-Dateien pro Task

| Datei | Ersteller | Inhalt |
|-------|-----------|--------|
| `00_brief.md` | ChatGPT | Was, Warum, Kontext |
| `01_scope.md` | ChatGPT/Claude | In/Out Scope |
| `02_done_when.md` | ChatGPT | Checkliste |
| `03_constraints.md` | ChatGPT/Claude | Regeln |
| `04_impl_report.md` | Claude | Implementierungsreport |
| `05_validation_report.md` | Cursor | Validierungsreport |

## Ablauf
1. Task-Ordner anlegen
2. Brief/Scope/Done-When/Constraints füllen
3. Implementierer → `04_impl_report.md`
4. Validator → `05_validation_report.md`
