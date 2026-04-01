# Smoke test and operator handoff — avms-nextcloud-sync

## 1. Start the service

From the repo root:

```bash
pnpm install
pnpm --filter @avms-appsuite/nextcloud-sync-dashboard build
pnpm start
```

Expect log: `[nextcloud-sync] http://127.0.0.1:28570  dashboard: /dashboard/`

## 2. Status

```bash
curl -s http://127.0.0.1:28570/api/nextcloud-sync/status
```

Expect JSON with `"service": "avms-nextcloud-sync"` and `"healthy": true`.

## 3. Validate (real DAV)

Use a public share URL (example from the final-build package):

```bash
curl -s -X POST http://127.0.0.1:28570/api/nextcloud-sync/validate ^
  -H "content-type: application/json" ^
  -d "{\"shareUrl\":\"https://nextcloud.omed-chat.xyz/s/zko2W74EsZzRCFd\",\"localRoot\":\"content/mocon\"}"
```

PowerShell:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:28570/api/nextcloud-sync/validate -Method POST -ContentType 'application/json' -Body '{"shareUrl":"https://nextcloud.omed-chat.xyz/s/zko2W74EsZzRCFd","localRoot":"content/mocon"}'
```

Expect `"ok": true` and a normalized `publicDavBaseUrl` when the share is reachable and the local path is writable.

## 4. Create a profile

```json
{
  "id": "showcase-main",
  "name": "Showcase Main Content",
  "shareUrl": "https://nextcloud.omed-chat.xyz/s/zko2W74EsZzRCFd",
  "localRoot": "content/mocon",
  "mode": "pull-mirror",
  "deletePolicy": "none",
  "conflictPolicy": "remote-wins",
  "excludePatterns": ["**/.DS_Store", "**/Thumbs.db"],
  "postSync": { "triggerShowcaseReindex": false },
  "safety": { "requirePreviewBeforeRun": false, "maxDeleteCountWithoutExtraConfirm": 25 }
}
```

POST to `/api/nextcloud-sync/profiles`.

## 5. Plan and run

1. `POST /api/nextcloud-sync/plan` with `{ "profileId": "showcase-main" }` — note `planId`.
2. `POST /api/nextcloud-sync/run` with `{ "profileId": "showcase-main", "planId": "<id>", "confirmDeletes": true }` if the plan includes deletes; otherwise `confirmDeletes` can be omitted/false.

Inspect jobs: `GET /api/nextcloud-sync/jobs` and logs: `GET /api/nextcloud-sync/logs/<jobId>`.

## 6. Known limits (V1)

- Password-protected public shares need extra auth handling beyond Basic.
- Pull mirror with `deletePolicy: mirror-delete-local` is destructive; always review the plan first.
- `AVMS_SHOWCASE_RESCAN_URL` must point at the running Showcase host (same machine as the operator).

## 7. Showcase operator UI

Open the Showcase Kiosk config (gear), tab **Cloud Sync**. Ensure this service is running; iframe uses `http://127.0.0.1:28570/dashboard/` by default or `VITE_NEXTCLOUD_SYNC_BASE` at build time.
