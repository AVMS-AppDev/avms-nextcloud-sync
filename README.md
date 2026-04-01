# avms-nextcloud-sync

Standalone-first NextGen module: sync a **Nextcloud public share** to a local content folder (Showcase Kiosk / Cloud Sync). V1 is **manual** (validate → preview → run); no background autosync.

## Requirements

- Node.js 20+
- pnpm 9+

## Run (development)

```bash
pnpm install
pnpm --filter @avms-appsuite/nextcloud-sync-dashboard build
pnpm start
```

- API + embedded dashboard: `http://127.0.0.1:28570/dashboard/` (default port **28570**).
- Override: `AVMS_NEXTCLOUD_SYNC_PORT`, `AVMS_NEXTCLOUD_SYNC_HOST`, `AVMS_NEXTCLOUD_SYNC_DATA_DIR`, `AVMS_NEXTCLOUD_SYNC_LOGS_DIR`, `AVMS_NEXTCLOUD_SYNC_DASHBOARD_DIR`.

## Optional: Showcase content rescan

After a successful sync, POST to the Showcase app’s content pipeline:

```text
AVMS_SHOWCASE_RESCAN_URL=http://127.0.0.1:<showcase-port>/api/content/rescan
```

Enable **triggerShowcaseReindex** on the sync profile (`postSync.triggerShowcaseReindex`).

## API

See package `packages/contracts` for types. Surface:

- `GET /api/nextcloud-sync/status`
- `GET|POST /api/nextcloud-sync/profiles` … `PUT|DELETE /api/nextcloud-sync/profiles/{id}`
- `POST /api/nextcloud-sync/validate`
- `POST /api/nextcloud-sync/plan`
- `POST /api/nextcloud-sync/run`
- `POST /api/nextcloud-sync/cancel/{jobId}`
- `GET /api/nextcloud-sync/jobs` … `GET /api/nextcloud-sync/jobs/{jobId}`
- `GET /api/nextcloud-sync/logs/{jobId}`

## Showcase integration

The Showcase Kiosk admin panel includes a **Cloud Sync** tab (iframe to this service). Build the Showcase app with `VITE_NEXTCLOUD_SYNC_BASE` if the sync service is not on the default URL.

## License

UNLICENSED — AVMS internal.
