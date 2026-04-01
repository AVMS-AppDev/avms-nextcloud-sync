import type {
  DeletePolicy,
  PlanAction,
  PlanResult,
  PlanSummary,
  SyncMode,
  SyncProfile,
} from "@avms-appsuite/nextcloud-sync-contracts";
import type { RemoteFileEntry } from "@avms-appsuite/nextcloud-sync-dav-client";
import type { LocalFileInfo } from "./localScan.js";
import { isExcluded } from "./excludes.js";
import { randomUUID } from "crypto";

function summarize(actions: PlanAction[]): PlanSummary {
  let createDirs = 0;
  let downloadFiles = 0;
  let replaceFiles = 0;
  let deleteLocalFiles = 0;
  let skipped = 0;
  let conflicts = 0;
  let totalBytesToDownload = 0;
  for (const a of actions) {
    switch (a.kind) {
      case "create-dir":
        createDirs++;
        break;
      case "download-file":
        downloadFiles++;
        totalBytesToDownload += a.remote?.size ?? 0;
        break;
      case "replace-file":
        replaceFiles++;
        totalBytesToDownload += a.remote?.size ?? 0;
        break;
      case "delete-local-file":
        deleteLocalFiles++;
        break;
      case "skip":
        skipped++;
        break;
      default:
        conflicts++;
    }
  }
  return {
    createDirs,
    downloadFiles,
    replaceFiles,
    deleteLocalFiles,
    conflicts,
    skipped,
    totalBytesToDownload,
  };
}

export function buildPullMirrorPlan(
  profile: SyncProfile,
  remote: readonly RemoteFileEntry[],
  local: readonly LocalFileInfo[],
): PlanResult {
  const mode: SyncMode = profile.mode;
  const deletePolicy: DeletePolicy = profile.deletePolicy;
  const excludes = profile.excludePatterns;

  const remoteMap = new Map<string, RemoteFileEntry>();
  for (const r of remote) {
    if (isExcluded(r.relativePath, excludes)) continue;
    remoteMap.set(r.relativePath, r);
  }

  const localMap = new Map<string, LocalFileInfo>();
  for (const l of local) {
    if (isExcluded(l.relativePath, excludes)) continue;
    localMap.set(l.relativePath, l);
  }

  const actions: PlanAction[] = [];
  const warnings: string[] = [];

  const dirsNeeded = new Set<string>();
  for (const path of remoteMap.keys()) {
    const parts = path.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      dirsNeeded.add(parts.slice(0, i + 1).join("/"));
    }
  }
  for (const d of [...dirsNeeded].sort()) {
    actions.push({ kind: "create-dir", path: d });
  }

  for (const [path, r] of remoteMap) {
    const loc = localMap.get(path);
    if (!loc) {
      actions.push({
        kind: "download-file",
        path,
        remote: { etag: r.etag ?? undefined, size: r.size, lastModified: r.lastModified ?? undefined },
      });
    } else if (loc.size !== r.size) {
      actions.push({
        kind: "replace-file",
        path,
        remote: { etag: r.etag ?? undefined, size: r.size, lastModified: r.lastModified ?? undefined },
      });
    } else {
      actions.push({ kind: "skip", path });
    }
  }

  if (mode === "pull-mirror" && deletePolicy === "mirror-delete-local") {
    for (const [path] of localMap) {
      if (!remoteMap.has(path)) {
        actions.push({ kind: "delete-local-file", path });
      }
    }
  }

  const summary = summarize(actions);
  const maxDel = profile.safety?.maxDeleteCountWithoutExtraConfirm ?? 25;
  if (summary.deleteLocalFiles > maxDel) {
    warnings.push(
      `Delete count (${summary.deleteLocalFiles}) exceeds threshold (${maxDel}). Extra confirmation recommended.`,
    );
  }

  return {
    profileId: profile.id,
    mode,
    summary,
    actions,
    warnings,
    planId: `plan_${randomUUID()}`,
  };
}
