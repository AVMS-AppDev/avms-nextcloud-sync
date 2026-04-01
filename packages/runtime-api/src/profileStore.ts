import { mkdir, readdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import type { SyncProfile } from "@avms-appsuite/nextcloud-sync-contracts";
import { profilesDir } from "./paths.js";

async function ensureDir(): Promise<void> {
  await mkdir(profilesDir(), { recursive: true });
}

export async function listProfiles(): Promise<SyncProfile[]> {
  await ensureDir();
  const names = await readdir(profilesDir());
  const out: SyncProfile[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const raw = await readFile(join(profilesDir(), n), "utf8");
    out.push(JSON.parse(raw) as SyncProfile);
  }
  return out;
}

export async function getProfile(id: string): Promise<SyncProfile | null> {
  try {
    const raw = await readFile(join(profilesDir(), `${id}.json`), "utf8");
    return JSON.parse(raw) as SyncProfile;
  } catch {
    return null;
  }
}

export async function saveProfile(p: SyncProfile): Promise<void> {
  await ensureDir();
  await writeFile(join(profilesDir(), `${p.id}.json`), JSON.stringify(p, null, 2), "utf8");
}

export async function deleteProfile(id: string): Promise<boolean> {
  try {
    await unlink(join(profilesDir(), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
