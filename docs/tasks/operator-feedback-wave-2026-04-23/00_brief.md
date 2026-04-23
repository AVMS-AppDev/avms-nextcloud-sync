# Task Brief — Operator-Feedback-Wave 2026-04-23 (Nextcloud-Sync Slice)

## Titel
Sync-Lock Robustness — Watchdog + manueller Unlock-Endpoint.

## Kontext
Teil der Showcase-Operator-Feedback-Wave 2026-04-23. Hauptrepo-Doku liegt unter `avms-showcase-kiosk/docs/tasks/showcase/operator-feedback-wave-2026-04-23/`.

Operator-Feedback: "der Sync Button um die Nextcloud zu syncen ist defekt. Ich kann den Stand abrufen, er sagt mir 10 neue Files, dann gehe ich auf syncen, bekomme Fehlermeldung das dieser Vorgang schon läuft und nichts wird runtergeladen."

Ursache: `state.activeJobId` ist RAM-only und wird bei Launcher-Kill mid-sync nicht freigegeben. Nächster Start sieht den Lock nicht (frisches RAM), aber wenn innerhalb derselben Session ein Conflict-Wait unbeantwortet bleibt, hängt der Lock für die laufende Session.

## Ziel
1. Auto-Release stale Jobs über Watchdog-Timer (60s check, 30min threshold)
2. Manueller `POST /unlock-job`-Endpoint für Operator-Panel
3. 409-Responses liefern `activeJobStartedAt` damit Frontend "wie alt ist der Lock" zeigt

## Umfang
- `ServerState.activeJobStartedAt: string | null`
- Alle 4 Lock-Set/Release-Pfade aktualisieren das Feld
- `STALE_JOB_THRESHOLD_MS = 30 * 60_000`, `STALE_JOB_CHECK_INTERVAL_MS = 60_000`
- `staleLockWatchdog` setInterval in `startHttpServer` mit `.unref()`
- Neuer Endpoint `POST /api/nextcloud-sync/unlock-job`

## Nicht-Ziel
- Persistenz des Lock-State auf Disk (RAM-only bleibt)
- Sync-Stop-on-Unlock (Unlock = Lock-Release only, nicht Abort alle Worker)
- Multi-Instance-Lock-Koordination
