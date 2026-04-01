import { readdir } from "fs/promises";
import { join } from "path";
import type { RemoteFileEntry } from "@avms-appsuite/nextcloud-sync-dav-client";
import { isExcluded } from "./excludes.js";

export interface LocalFileInfo {
  readonly relativePath: string;
  readonly size: number;
  readonly mtimeMs: number;
}

async function walk(
  rootAbs: string,
  relBase: string,
  excludePatterns: readonly string[],
  out: LocalFileInfo[],
): Promise<void> {
  const entries = await readdir(rootAbs, { withFileTypes: true });
  for (const ent of entries) {
    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
    const forward = rel.replace(/\\/g, "/");
    if (isExcluded(forward, excludePatterns)) continue;
    const full = join(rootAbs, ent.name);
    if (ent.isDirectory()) {
      await walk(full, rel, excludePatterns, out);
    } else if (ent.isFile()) {
      const st = await import("fs/promises").then((fs) => fs.stat(full));
      out.push({ relativePath: forward, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
}

export async function scanLocalTree(
  localRootAbs: string,
  excludePatterns: readonly string[],
): Promise<LocalFileInfo[]> {
  const out: LocalFileInfo[] = [];
  await walk(localRootAbs, "", excludePatterns, out);
  return out;
}

export function toRemoteLikeMap(files: LocalFileInfo[]): Map<string, Pick<RemoteFileEntry, "relativePath" | "size">> {
  const m = new Map<string, Pick<RemoteFileEntry, "relativePath" | "size">>();
  for (const f of files) {
    m.set(f.relativePath, { relativePath: f.relativePath, size: f.size });
  }
  return m;
}
