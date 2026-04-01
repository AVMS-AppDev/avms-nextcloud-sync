import { join } from "path";

export function dataRootDir(): string {
  return process.env.AVMS_NEXTCLOUD_SYNC_DATA_DIR ?? join(process.cwd(), "Data", "nextcloud-sync");
}

export function logsRootDir(): string {
  return process.env.AVMS_NEXTCLOUD_SYNC_LOGS_DIR ?? join(process.cwd(), "Logs", "nextcloud-sync");
}

export function profilesDir(): string {
  return join(dataRootDir(), "profiles");
}

export function jobsDir(): string {
  return join(dataRootDir(), "jobs");
}

export function plansDir(): string {
  return join(dataRootDir(), "plans");
}
