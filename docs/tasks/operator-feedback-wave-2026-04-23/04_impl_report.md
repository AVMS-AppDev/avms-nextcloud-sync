# Implementation Report — Nextcloud-Sync Slice 2026-04-23

## Touched Files

| Pfad | Änderung |
|---|---|
| `packages/runtime-api/src/httpServer.ts` | `ServerState.activeJobStartedAt: string \| null` + `STALE_JOB_THRESHOLD_MS=30min` + `STALE_JOB_CHECK_INTERVAL_MS=60s`. 4 Lock-Lifecycle-Pfade (set bei run-start, clear bei invalid-share-early-return, clear bei abort-path, clear bei normal-finally) aktualisieren startedAt-Feld. 409-Response auf `/run` enthält `activeJobStartedAt` im Error-Body. Neuer `POST /api/nextcloud-sync/unlock-job`-Endpoint. `startHttpServer` fügt `setInterval`-basierten Watchdog hinzu mit `.unref()` damit Prozess nicht am Leben bleibt nur wegen dem Interval. |
| `packages/runtime-api/src/main.ts` | Initial-State um `activeJobStartedAt: null` ergänzt. |
| `packages/contracts/src/index.ts` | (Zeilen-Änderungen — zu prüfen ob relevant für diesen Slice) |

## Verhalten

### Watchdog
Alle 60 Sekunden: wenn `activeJobId !== null && activeJobStartedAt !== null`, berechnet die Differenz zu jetzt. Ist sie > 30 Minuten, löst `abortController.abort()` aus und setzt State auf null. Warning-Log:
```
[nextcloud-sync] watchdog: auto-releasing stale active-job lock jobId=... age=1800s (threshold=1800s)
```

### Manueller Unlock
`POST /api/nextcloud-sync/unlock-job` (kein Body nötig) — antwortet immer 200:
- `{ ok: true, forceUnlocked: "job_abc", previousStartedAt: "2026-04-23T..." }` wenn ein Lock da war
- `{ ok: true, forceUnlocked: null, previousStartedAt: null }` wenn frei

Ruft `abortController.abort()` auf dem Lock-Holder, entfernt ihn aus der abortControllers-Map, nullt den State.

### 409-Response mit Context
Bisher: `{"error":"job_already_running","activeJobId":"..."}` — ohne Alter.  
Jetzt: `{"error":"job_already_running","activeJobId":"...","activeJobStartedAt":"2026-04-23T..."}` — Frontend kann "seit 12 min gelockt" anzeigen.

## Runtime-Verifikation
```
$ curl -sS -X POST http://127.0.0.1:28570/api/nextcloud-sync/unlock-job
{"ok":true,"forceUnlocked":null,"previousStartedAt":null}
```

Mit existierendem Lock (aus vorheriger Session, deren server.cjs nicht das neue Endpoint hatte → 404):
- Nach Hot-Restart des Services: neue server.cjs lief, `/unlock-job` antwortete korrekt 200.

## Build
```
pnpm --filter @avms-appsuite/nextcloud-sync-runtime-api build   # tsc output
node scripts/build-release.mjs                                  # bundled server.cjs
cp release/avms-nextcloud-sync/app/server.cjs $BUNDLE/services/nextcloud-sync/app/server.cjs
```

**Wichtig:** Ein laufender `node.exe`-Prozess mit alter `server.cjs` im Arbeitsspeicher bleibt auf dem alten Code. Muss manuell beendet werden, sonst sieht der Endpoint `/unlock-job` 404 (obwohl die Datei auf Disk aktuell ist).

## Kompatibilität
Keine breaking changes — nur additive Felder + ein neuer Endpoint. Existing Clients ignorieren einfach `activeJobStartedAt` im 409-Body.
