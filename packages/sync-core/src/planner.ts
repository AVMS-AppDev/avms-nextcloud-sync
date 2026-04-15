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

export type LocalPathForDav = (davRelativePath: string) => string;

export function buildPullMirrorPlan(
  profile: SyncProfile,
  remote: readonly RemoteFileEntry[],
  local: readonly LocalFileInfo[],
  previousRemoteState?: ReadonlyMap<string, { etag?: string; size: number; lastModified?: string }>,
  opts?: { readonly localPathForDav?: LocalPathForDav },
): PlanResult {
  const mode: SyncMode = profile.mode;
  const deletePolicy: DeletePolicy = profile.deletePolicy;
  const excludes = profile.excludePatterns;
  const L: LocalPathForDav = opts?.localPathForDav ?? ((p) => p);

  /** Keys = DAV relative paths under the share (stable for sync-state). */
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

  const localSeen = new Map<string, string>();
  for (const dav of remoteMap.keys()) {
    const lp = L(dav);
    const prevDav = localSeen.get(lp);
    if (prevDav !== undefined && prevDav !== dav) {
      warnings.push(`brand_local_mapping_collision local="${lp}" remote="${prevDav}" vs "${dav}"`);
    }
    localSeen.set(lp, dav);
  }

  const dirsNeeded = new Set<string>();
  for (const dav of remoteMap.keys()) {
    const localPath = L(dav);
    const parts = localPath.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      dirsNeeded.add(parts.slice(0, i + 1).join("/"));
    }
  }
  for (const d of [...dirsNeeded].sort()) {
    actions.push({ kind: "create-dir", path: d });
  }

  for (const [davPath, r] of remoteMap) {
    const path = L(davPath);
    const loc = localMap.get(path);
    const prev = previousRemoteState?.get(davPath);
    const remoteMeta = { etag: r.etag ?? undefined, size: r.size, lastModified: r.lastModified ?? undefined };
    const davOpt = path !== davPath ? { remoteDavPath: davPath } : {};
    if (!loc) {
      actions.push({
        kind: "download-file",
        path,
        ...davOpt,
        remote: remoteMeta,
      });
    } else if (loc.size !== r.size) {
      actions.push({
        kind: "replace-file",
        path,
        ...davOpt,
        remote: remoteMeta,
      });
    } else if (prev && prev.size !== loc.size) {
      actions.push({
        kind: "replace-file",
        path,
        ...davOpt,
        remote: remoteMeta,
      });
    } else if (prev && r.etag && prev.etag && prev.etag !== r.etag) {
      actions.push({
        kind: "replace-file",
        path,
        ...davOpt,
        remote: remoteMeta,
      });
    } else if (prev && r.lastModified && prev.lastModified && prev.lastModified !== r.lastModified) {
      actions.push({
        kind: "replace-file",
        path,
        ...davOpt,
        remote: remoteMeta,
      });
    } else {
      actions.push({ kind: "skip", path });
    }
  }

  if (mode === "pull-mirror" && deletePolicy === "mirror-delete-local") {
    const expectedLocal = new Set<string>();
    for (const dav of remoteMap.keys()) {
      expectedLocal.add(L(dav));
    }
    for (const [path] of localMap) {
      if (!expectedLocal.has(path)) {
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
