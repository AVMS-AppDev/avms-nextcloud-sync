# AVMS Nextcloud Sync

Standalone Sync-Service: spiegelt Nextcloud Public-Shares auf lokale Content-Ordner für AVMS Kiosk-Systeme.

## Purpose

Manueller Pull-Mirror von Nextcloud-Shares auf lokale Festplatte. V1 ist **manual-first** (Validate → Plan/Preview → Run). Kein Background-Autosync. Sichere Sync-Operationen mit Conflict-Detection, Brand-Mapping und Safety-Gates.

## Owns

- Nextcloud WebDAV Client (PROPFIND, Share-Normalisierung, Basic Auth)
- Sync Planner (Pull-Mirror Plan, Conflict Detection)
- Sync Runner (atomare Datei-Operationen, Conflict Resolution)
- Profile Management (CRUD, Persistenz, Safety Policies)
- Job Management (Status-Tracking, Progress, Cancellation)
- Sync State / Baseline Tracking (Drift-Detection zwischen Syncs)
- Brand-to-Local Folder Mapping
- Embedded Vue Dashboard (`/dashboard/`)
- HTTP API (11+ Endpoints auf Port 28570)

## Does Not Own

- Content-Rendering / Viewer → `avms-app-mocon`
- Content-Tree Scanning → `avms-app-mocon` Backend
- Kiosk UI / Operator Dashboard → `avms-app-mocon`
- Nextcloud Server-Infrastruktur
- Watchdog / Health Monitoring → `avms-watchdog-service`
- Background Auto-Sync (nicht implementiert)

## Works With

| Dependency | Rolle |
|---|---|
| `avms-app-mocon` | Consumer: Cloud Sync Operator Panel spricht HTTP API an |
| Nextcloud Server | Datenquelle: WebDAV Public Shares |

## Consumes

- Nextcloud WebDAV — Public Share PROPFIND + GET (extern, read-only)
- `avms-app-mocon` — optional: POST an Content-Rescan-Endpoint nach Sync

## Consumed By

- `avms-app-mocon` — Cloud Sync Operator Panel (HTTP API Consumer)

## Related Repos

- `avms-app-mocon` — primärer Consumer (Showcase Kiosk Cloud Sync Tab)

## Typical Use Cases

- Messe-Content von Nextcloud-Share auf Kiosk-Maschine synchronisieren
- Brand-Ordner-Mapping: Remote `Dansensor/` → lokal `dansensor/`
- Vor-Ort-Operator: Preview → Confirm → Sync mit Conflict-Anzeige

## Not The Right Repo For

- Content-Darstellung → `avms-app-mocon`
- Background-/Auto-Sync → nicht implementiert (geplant)
- Andere Cloud-Provider (OneDrive, Google Drive) → nicht unterstützt

## Canonical Docs

- (keine separaten Kanon-Docs — README + module.json sind die Wahrheit)

## Current Status

**Active** — V0.1.0, manueller Sync production-ready. Brand-Mapping, Conflict-Handling, Auth-Hardening abgeschlossen.

## Protected Behaviors

- **No silent data loss** — Deletes nur mit `deletePolicy` + `confirmDeletes`, atomare Datei-Ops via Temp-Files
- **User-driven conflict resolution** — Lokale Änderungen erkennen, User entscheidet (replace/keep/cancel)
- **Sync baseline tracking** — Nach erfolgreichem Sync wird Baseline gespeichert für nächste Drift-Detection

---

## Requirements

- Node.js 20+
- pnpm 9+

## Run (development)

```bash
pnpm install
pnpm start        # HTTP server on port 28570
pnpm dev:dashboard # Vue dashboard dev server
```

## API

Default: `http://127.0.0.1:28570`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/nextcloud-sync/status` | Service status |
| GET | `/api/nextcloud-sync/health` | Health check |
| POST | `/api/nextcloud-sync/validate` | Validate share URL + credentials |
| POST | `/api/nextcloud-sync/brands` | List remote brands |
| POST | `/api/nextcloud-sync/plan` | Generate sync plan (preview) |
| POST | `/api/nextcloud-sync/run` | Execute sync |
| POST | `/api/nextcloud-sync/cancel/{jobId}` | Cancel job |
| GET | `/api/nextcloud-sync/jobs` | List jobs |

## Bundle

`node scripts/build-release.mjs` → `release/avms-nextcloud-sync/` mit bundled Node.js.
