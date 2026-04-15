import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { LocalFileInfo } from "@avms-appsuite/nextcloud-sync-core";
import type { RemoteFileEntry } from "@avms-appsuite/nextcloud-sync-dav-client";
import { dataRootDir } from "./paths.js";

export interface StoredRemoteFileState {
  readonly path: string;
  readonly etag?: string;
  readonly size: number;
  readonly lastModified?: string;
}

export interface ProfileSyncState {
  readonly profileId: string;
  readonly updatedAt: string;
  readonly remote: readonly StoredRemoteFileState[];
  readonly local: readonly {
    readonly path: string;
    readonly size: number;
    readonly mtimeMs: number;
  }[];
}

function stateDir(): string {
  return join(dataRootDir(), "sync-state");
}

function statePath(profileId: string): string {
  return join(stateDir(), `${profileId}.json`);
}

export async function loadSyncState(profileId: string): Promise<ProfileSyncState | null> {
  try {
    const raw = await readFile(statePath(profileId), "utf8");
    return JSON.parse(raw) as ProfileSyncState;
  } catch {
    return null;
  }
}

export async function saveSyncState(
  profileId: string,
  remote: readonly RemoteFileEntry[],
  local: readonly LocalFileInfo[],
): Promise<void> {
  const payload: ProfileSyncState = {
    profileId,
    updatedAt: new Date().toISOString(),
    remote: remote.map((r) => ({
      path: r.relativePath,
      etag: r.etag ?? undefined,
      size: r.size,
      lastModified: r.lastModified ?? undefined,
    })),
    local: local.map((l) => ({
      path: l.relativePath,
      size: l.size,
      mtimeMs: l.mtimeMs,
    })),
  };
  await mkdir(stateDir(), { recursive: true });
  await writeFile(statePath(profileId), JSON.stringify(payload, null, 2), "utf8");
}

export function toRemoteStateMap(
  state: ProfileSyncState | null,
): ReadonlyMap<string, { etag?: string; size: number; lastModified?: string }> {
  const map = new Map<string, { etag?: string; size: number; lastModified?: string }>();
  if (!state) return map;
  for (const f of state.remote) {
    map.set(f.path, { etag: f.etag, size: f.size, lastModified: f.lastModified });
  }
  return map;
}
