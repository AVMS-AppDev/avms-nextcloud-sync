import { mkdir, rename, rm, writeFile, appendFile } from "fs/promises";
import { dirname, join } from "path";
import type { PlanAction, PlanResult, SyncProfile } from "@avms-appsuite/nextcloud-sync-contracts";
import { downloadFile } from "@avms-appsuite/nextcloud-sync-dav-client";
import type { LogFn } from "./types.js";

export interface RunContext {
  readonly profile: SyncProfile;
  readonly plan: PlanResult;
  readonly publicDavBaseUrl: string;
  /** Share token for DAV Basic auth (username) when sharePassword is set. */
  readonly shareToken: string;
  readonly localRootAbs: string;
  readonly signal: AbortSignal;
  readonly log: LogFn;
  readonly onProgress: (completed: number, total: number, bytes: number, totalBytes: number, current: string | null) => void;
  readonly conflictPaths?: ReadonlySet<string>;
  readonly resolveConflict?: (path: string, remote: { size: number; etag?: string; lastModified?: string }) => Promise<{
    decision: "replace" | "keep_local" | "cancel_run";
  }>;
}

function tmpPath(target: string): string {
  return `${target}.tmp.${process.pid}.${Date.now()}`;
}

export async function executePlan(ctx: RunContext): Promise<{ ok: boolean; message?: string }> {
  const { plan, localRootAbs, publicDavBaseUrl, shareToken, signal, log, onProgress } = ctx;
  const pwd = ctx.profile.sharePassword?.trim() ? ctx.profile.sharePassword : undefined;
  const davOpts = { password: pwd, shareToken, signal };

  const ordered: PlanAction[] = [];
  for (const a of plan.actions) {
    if (a.kind === "create-dir") ordered.push(a);
  }
  const downloads = plan.actions.filter((a) => a.kind === "download-file" || a.kind === "replace-file");
  for (const a of downloads) ordered.push(a);
  const deletes = plan.actions.filter((a) => a.kind === "delete-local-file");
  for (const a of deletes) ordered.push(a);

  const totalBytes = plan.summary.totalBytesToDownload;
  let bytesDone = 0;
  let step = 0;
  const totalSteps = ordered.length;

  for (const a of ordered) {
    if (signal.aborted) {
      await log("warn", "RUN_ABORTED", "Run cancelled", {});
      return { ok: false, message: "cancelled" };
    }
    const rel = a.path;
    const target = join(localRootAbs, ...rel.split("/"));

    if (a.kind === "create-dir") {
      await mkdir(target, { recursive: true });
      await log("info", "DIR_OK", `Created dir`, { path: rel });
    } else if (a.kind === "download-file" || a.kind === "replace-file") {
      const davRel = a.remoteDavPath ?? rel;
      if (a.kind === "replace-file" && ctx.conflictPaths?.has(rel) && ctx.resolveConflict) {
        const resolution = await ctx.resolveConflict(rel, {
          size: a.remote?.size ?? 0,
          etag: a.remote?.etag,
          lastModified: a.remote?.lastModified,
        });
        if (resolution.decision === "keep_local") {
          await log("warn", "CONFLICT_KEEP_LOCAL", "Kept local version for conflicted file", { path: rel });
          step++;
          onProgress(step, totalSteps, bytesDone, totalBytes, rel);
          continue;
        }
        if (resolution.decision === "cancel_run") {
          await log("warn", "RUN_CANCELLED", "Run cancelled from conflict decision", { path: rel });
          return { ok: false, message: "cancelled" };
        }
      }
      const buf = await downloadFile(publicDavBaseUrl, davRel, davOpts);
      bytesDone += buf.byteLength;
      await mkdir(dirname(target), { recursive: true });
      const t = tmpPath(target);
      await writeFile(t, Buffer.from(buf));
      await rename(t, target);
      await log("info", "DOWNLOAD_OK", `Downloaded file`, {
        path: rel,
        bytes: buf.byteLength,
      });
    } else if (a.kind === "delete-local-file") {
      await rm(target, { force: true });
      await log("info", "DELETE_LOCAL_OK", `Removed local file`, { path: rel });
    }
    step++;
    onProgress(step, totalSteps, bytesDone, totalBytes, rel);
  }

  return { ok: true };
}

export async function appendLogFile(logPath: string, line: string): Promise<void> {
  await appendFile(logPath, line + "\n", "utf8");
}
