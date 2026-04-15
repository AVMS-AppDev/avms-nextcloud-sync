import { createReadStream, existsSync, readFileSync } from "fs";
import http, { type IncomingMessage, type ServerResponse } from "http";
import { dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";
import type {
  ConflictDecision,
  ConflictItem,
  JobRecord,
  RunRequest,
  SyncProfile,
  ValidateRequest,
} from "@avms-appsuite/nextcloud-sync-contracts";
import { listRemoteTree, normalizeShare } from "@avms-appsuite/nextcloud-sync-dav-client";
import { buildPullMirrorPlan, executePlan, scanLocalTree, type LocalFileInfo } from "@avms-appsuite/nextcloud-sync-core";
import { dataRootDir } from "./paths.js";
import { deleteProfile, getProfile, listProfiles, saveProfile } from "./profileStore.js";
import { loadPlan, persistPlan } from "./planStore.js";
import { appendJobLog, listJobs, loadJob, persistLogLine, readJobLogs, saveJob } from "./jobStore.js";
import { checkLocalPath, resolveLocalRoot } from "./localPath.js";
import { loadSyncState, saveSyncState, toRemoteStateMap } from "./syncStateStore.js";
import { validateShareRequest } from "./validateShare.js";
import { loadLastValidation, persistLastValidation } from "./validationStore.js";
import { buildLocalPathForDavFromSegmentMap, parseBrandLocalSegmentMap } from "./brandMapping.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_VERSION = "0.1.0";

function json(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.end(JSON.stringify(body));
}

function cors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const ch of req) {
    chunks.push(ch as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function dashboardDir(): string {
  return process.env.AVMS_NEXTCLOUD_SYNC_DASHBOARD_DIR ?? join(MODULE_DIR, "..", "..", "dashboard", "dist");
}

function serveDashboardStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): void {
  const _base = dashboardDir();
  let rel = urlPath.replace(/^\/dashboard\/?/, "") || "index.html";
  if (rel === "" || rel.endsWith("/")) rel = "index.html";
  const root = resolve(_base);
  const filePath = resolve(join(_base, rel));
  if (!filePath.startsWith(root)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (!existsSync(filePath)) {
    const idx = join(_base, "index.html");
    if (existsSync(idx)) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("access-control-allow-origin", "*");
      res.end(readFileSync(idx, "utf8"));
      return;
    }
    res.statusCode = 404;
    res.end();
    return;
  }
  const ext = extname(filePath);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };
  res.statusCode = 200;
  res.setHeader("content-type", types[ext] ?? "application/octet-stream");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "no-store");
  createReadStream(filePath).pipe(res);
}

export interface ServerState {
  activeJobId: string | null;
  lastCompletedJobAt: string | null;
  readonly abortControllers: Map<string, AbortController>;
}

function toLastRunSummary(jobs: readonly JobRecord[]): Record<string, unknown> | null {
  const completed = jobs.find((j) => j.finishedAt !== null);
  if (!completed) return null;
  return {
    jobId: completed.jobId,
    profileId: completed.profileId,
    state: completed.state,
    startedAt: completed.startedAt,
    finishedAt: completed.finishedAt,
    result: completed.result,
    summary: completed.planSummary,
    progress: completed.progress,
    errors: completed.errors,
    warnings: completed.warnings,
  };
}

function classifyRun(job: JobRecord): "success" | "failed" | "aborted" | "running" {
  if (job.state === "running" || job.state === "queued" || job.state === "awaiting_decision") return "running";
  if (job.state === "completed") return "success";
  const msg = job.result?.message?.toLowerCase() ?? "";
  if (msg.includes("aborted") || msg.includes("cancel")) return "aborted";
  return "failed";
}

function summarizeCounters(job: JobRecord | null): Record<string, number> | null {
  if (!job?.planSummary) return null;
  return {
    discoveredFiles: job.planSummary.downloadFiles + job.planSummary.replaceFiles + job.planSummary.skipped,
    downloadedOrReplaced: job.planSummary.downloadFiles + job.planSummary.replaceFiles,
    skipped: job.planSummary.skipped,
    failed: job.errors.length,
    deletedLocal: job.planSummary.deleteLocalFiles,
  };
}

function classifyAuthFailureMessage(message: string): { code: string; message: string } | null {
  const lower = message.toLowerCase();
  if (lower.includes("propfind 401") || lower.includes("get 401") || lower.includes("unauthorized")) {
    return {
      code: "auth_failed",
      message:
        "Share authentication failed. For password-protected public shares, provide sharePassword and ensure shareUrl contains the /s/{token}.",
    };
  }
  return null;
}

interface ConflictDetectionContext {
  readonly currentLocal: ReadonlyMap<string, LocalFileInfo>;
  readonly previousLocal: ReadonlyMap<string, { size: number; mtimeMs: number }>;
}

interface JobConflictSession {
  readonly jobId: string;
  readonly conflicts: ConflictItem[];
  nextIndex: number;
  pending: ConflictItem | null;
  applyToRemainingDecision: ConflictDecision | null;
  waiter: ((value: { decision: ConflictDecision; applyToRemaining: boolean }) => void) | null;
}

function toPreviousLocalMap(state: Awaited<ReturnType<typeof loadSyncState>>): ReadonlyMap<string, { size: number; mtimeMs: number }> {
  const map = new Map<string, { size: number; mtimeMs: number }>();
  if (!state) return map;
  for (const f of state.local) {
    map.set(f.path, { size: f.size, mtimeMs: f.mtimeMs });
  }
  return map;
}

function detectConflicts(
  plan: Awaited<ReturnType<typeof buildPullMirrorPlan>>,
  ctx: ConflictDetectionContext,
): ConflictItem[] {
  const conflicts: ConflictItem[] = [];
  for (const action of plan.actions) {
    if (action.kind !== "replace-file") continue;
    const local = ctx.currentLocal.get(action.path);
    const baseline = ctx.previousLocal.get(action.path);
    if (!local || !baseline) continue;
    const locallyDrifted = local.size !== baseline.size || Math.abs(local.mtimeMs - baseline.mtimeMs) > 1000;
    if (!locallyDrifted) continue;
    conflicts.push({
      id: action.path,
      path: action.path,
      reason: "local_drift_from_baseline",
      baseline,
      local: { size: local.size, mtimeMs: local.mtimeMs },
      remote: action.remote
        ? {
            size: action.remote.size,
            etag: action.remote.etag,
            lastModified: action.remote.lastModified,
          }
        : undefined,
    });
  }
  return conflicts;
}

export function startHttpServer(host: string, port: number, state: ServerState): http.Server {
  const conflictSessions = new Map<string, JobConflictSession>();
  const server = http.createServer(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const path = url.pathname;

      if (req.method === "GET" && path.startsWith("/dashboard")) {
        return serveDashboardStatic(req, res, path);
      }

      if (req.method === "GET" && path === "/api/nextcloud-sync/status") {
        const profiles = await listProfiles();
        const jobs = await listJobs();
        const lastValidation = await loadLastValidation();
        const targets = profiles.map((p) => {
          const normalized = normalizeShare(p.shareUrl);
          return {
            profileId: p.id,
            name: p.name,
            shareUrl: p.shareUrl,
            shareToken: normalized?.shareToken ?? null,
            resolvedDavBaseUrl: normalized?.publicDavBaseUrl ?? null,
            localRoot: p.localRoot,
          };
        });
        const activeJob =
          state.activeJobId === null ? null : jobs.find((j) => j.jobId === state.activeJobId) ?? null;
        const lastSuccess = jobs.find((j) => j.state === "completed" && j.finishedAt !== null) ?? null;
        const lastNonSuccess =
          jobs.find((j) => j.finishedAt !== null && classifyRun(j) !== "success") ?? null;
        const lastRun = toLastRunSummary(jobs);
        const lastSuccessfulRunSummary = lastSuccess ? toLastRunSummary([lastSuccess]) : null;
        const lastNonSuccessRunSummary = lastNonSuccess ? toLastRunSummary([lastNonSuccess]) : null;
        return json(res, 200, {
          service: "avms-nextcloud-sync",
          version: SERVICE_VERSION,
          healthy: true,
          activeJobId: state.activeJobId,
          profilesCount: profiles.length,
          lastCompletedJobAt: state.lastCompletedJobAt,
          storageRoot: dataRootDir(),
          capabilities: {
            embeddedDashboard: true,
            manualSync: true,
            autoSync: false,
            twoWayExperimental: false,
          },
          targets,
          activeJob,
          lastRun,
          lastSuccessfulRun: lastSuccess && lastSuccessfulRunSummary
            ? {
                ...lastSuccessfulRunSummary,
                runClass: classifyRun(lastSuccess),
                counters: summarizeCounters(lastSuccess),
              }
            : null,
          lastNonSuccessRun: lastNonSuccess && lastNonSuccessRunSummary
            ? {
                ...lastNonSuccessRunSummary,
                runClass: classifyRun(lastNonSuccess),
                counters: summarizeCounters(lastNonSuccess),
              }
            : null,
          runClass: lastRun && jobs.length > 0 ? classifyRun(jobs[0]) : null,
          counters: summarizeCounters(jobs[0] ?? null),
          lastValidation,
        });
      }

      if (req.method === "GET" && path === "/api/nextcloud-sync/health") {
        return json(res, 200, {
          service: "avms-nextcloud-sync",
          healthy: true,
          activeJobId: state.activeJobId,
          lastCompletedJobAt: state.lastCompletedJobAt,
        });
      }

      if (req.method === "GET" && path === "/api/nextcloud-sync/profiles") {
        const profiles = await listProfiles();
        return json(res, 200, profiles);
      }

      if (req.method === "POST" && path === "/api/nextcloud-sync/profiles") {
        const body = (await readJson(req)) as Partial<SyncProfile>;
        if (!body.id || !body.name || !body.shareUrl || !body.localRoot) {
          return json(res, 422, { error: "id, name, shareUrl, localRoot required" });
        }
        const p: SyncProfile = {
          id: String(body.id),
          name: String(body.name),
          shareUrl: String(body.shareUrl),
          sharePassword: body.sharePassword,
          localRoot: String(body.localRoot),
          mode: body.mode === "pull-update-only" ? "pull-update-only" : "pull-mirror",
          deletePolicy: body.deletePolicy === "mirror-delete-local" ? "mirror-delete-local" : "none",
          conflictPolicy: "remote-wins",
          excludePatterns: Array.isArray(body.excludePatterns) ? body.excludePatterns : [],
          postSync: body.postSync,
          safety: body.safety,
        };
        await saveProfile(p);
        return json(res, 200, p);
      }

      {
        const m = /^\/api\/nextcloud-sync\/profiles\/([^/]+)\/?$/.exec(path);
        if (m && req.method === "PUT") {
          const id = decodeURIComponent(m[1] ?? "");
          const existing = await getProfile(id);
          if (!existing) return json(res, 404, { error: "not found" });
          const body = (await readJson(req)) as Partial<SyncProfile>;
          const merge: SyncProfile = {
            ...existing,
            ...body,
            id: existing.id,
            conflictPolicy: "remote-wins",
          };
          await saveProfile(merge);
          return json(res, 200, merge);
        }
        if (m && req.method === "DELETE") {
          const id = decodeURIComponent(m[1] ?? "");
          const ok = await deleteProfile(id);
          return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not found" });
        }
      }

      if (req.method === "POST" && path === "/api/nextcloud-sync/validate") {
        const body = (await readJson(req)) as ValidateRequest;
        const r = await validateShareRequest(body);
        await persistLastValidation(body, r);
        return json(res, 200, r);
      }

      if (req.method === "POST" && path === "/api/nextcloud-sync/brands") {
        const body = (await readJson(req)) as { shareUrl?: string; sharePassword?: string };
        if (!body.shareUrl?.trim()) return json(res, 422, { error: "shareUrl required" });
        const norm = normalizeShare(String(body.shareUrl));
        if (!norm) return json(res, 422, { error: "invalid share url" });
        const pwd = body.sharePassword?.trim() ? String(body.sharePassword) : undefined;
        let remote;
        try {
          remote = await listRemoteTree(norm.publicDavBaseUrl, {
            password: pwd,
            shareToken: norm.shareToken,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const auth = classifyAuthFailureMessage(msg);
          if (auth) {
            return json(res, 401, {
              error: auth.code,
              message: auth.message,
              diagnostics: { resolvedDavBaseUrl: norm.publicDavBaseUrl, hasSharePassword: Boolean(pwd) },
            });
          }
          return json(res, 502, { error: "remote_listing_failed", message: msg });
        }
        const roots = new Set<string>();
        for (const r of remote) {
          const seg = r.relativePath.split("/").filter(Boolean)[0];
          if (seg) roots.add(seg);
        }
        const brands = [...roots].sort((a, b) => a.localeCompare(b));
        return json(res, 200, {
          shareToken: norm.shareToken,
          resolvedDavBaseUrl: norm.publicDavBaseUrl,
          brands,
          remoteFileCount: remote.length,
        });
      }

      if (req.method === "POST" && path === "/api/nextcloud-sync/plan") {
        const body = (await readJson(req)) as {
          profileId?: string;
          brandAllowList?: string[];
          brandLocalSegmentMap?: unknown;
        };
        if (!body.profileId) return json(res, 422, { error: "profileId required" });
        const profile = await getProfile(body.profileId);
        if (!profile) return json(res, 404, { error: "profile not found" });
        const norm = normalizeShare(profile.shareUrl);
        if (!norm) return json(res, 422, { error: "invalid share url" });
        const localAbs = resolveLocalRoot(profile.localRoot);
        const lc = await checkLocalPath(localAbs);
        if (!lc.exists || !lc.isDirectory) {
          return json(res, 422, { error: "local root does not exist or is not a directory" });
        }
        const pwd = profile.sharePassword?.trim() ? profile.sharePassword : undefined;
        let remote;
        try {
          remote = await listRemoteTree(norm.publicDavBaseUrl, {
            password: pwd,
            shareToken: norm.shareToken,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const auth = classifyAuthFailureMessage(msg);
          if (auth) {
            return json(res, 401, {
              error: auth.code,
              message: auth.message,
              diagnostics: {
                shareUrl: profile.shareUrl,
                resolvedDavBaseUrl: norm.publicDavBaseUrl,
                hasSharePassword: Boolean(pwd),
              },
            });
          }
          return json(res, 502, {
            error: "remote_listing_failed",
            message: msg,
            diagnostics: {
              shareUrl: profile.shareUrl,
              resolvedDavBaseUrl: norm.publicDavBaseUrl,
              hasSharePassword: Boolean(pwd),
            },
          });
        }
        const allow = Array.isArray(body.brandAllowList)
          ? body.brandAllowList.map((s) => String(s).trim()).filter(Boolean)
          : [];
        const filteredRemote =
          allow.length > 0
            ? remote.filter((r) =>
                allow.some((b) => r.relativePath === b || r.relativePath.startsWith(`${b}/`)),
              )
            : remote;
        const parsedMap = parseBrandLocalSegmentMap(body.brandLocalSegmentMap);
        if (!parsedMap.ok) return json(res, 422, { error: parsedMap.error });
        const segmentMap = parsedMap.map;
        const localPathForDav =
          segmentMap.size > 0 ? buildLocalPathForDavFromSegmentMap(segmentMap) : undefined;
        const local = await scanLocalTree(localAbs, profile.excludePatterns);
        const previousState = await loadSyncState(profile.id);
        const plan = buildPullMirrorPlan(profile, filteredRemote, local, toRemoteStateMap(previousState), {
          localPathForDav,
        });
        await persistPlan(plan);
        return json(res, 200, {
          ...plan,
          diagnostics: {
            deltaComparison: "size-first, then remote etag/lastModified when previous remote state exists",
            previousStateSeenAt: previousState?.updatedAt ?? null,
            brandAllowList: allow.length ? allow : null,
            brandLocalSegmentMap: segmentMap.size > 0 ? Object.fromEntries(segmentMap) : null,
            remoteFileCountBeforeFilter: remote.length,
            remoteFileCountPlanned: filteredRemote.length,
          },
        });
      }

      if (req.method === "POST" && path === "/api/nextcloud-sync/run") {
        const body = (await readJson(req)) as RunRequest;
        if (!body.profileId || !body.planId) {
          return json(res, 422, { error: "profileId and planId required" });
        }
        const profile = await getProfile(body.profileId);
        if (!profile) return json(res, 404, { error: "profile not found" });
        const plan = await loadPlan(body.planId);
        if (!plan || plan.profileId !== profile.id) {
          return json(res, 404, { error: "plan not found" });
        }
        if (profile.safety?.requirePreviewBeforeRun && !body.planId) {
          return json(res, 422, { error: "preview required" });
        }
        const delCount = plan.summary.deleteLocalFiles;
        if (delCount > 0 && !body.confirmDeletes) {
          return json(res, 422, {
            error: "destructive_changes_require_confirm",
            deleteLocalFiles: delCount,
          });
        }
        if (state.activeJobId) {
          return json(res, 409, { error: "job_already_running", activeJobId: state.activeJobId });
        }

        const jobId = `job_${new Date().toISOString().replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`;
        const ac = new AbortController();
        state.abortControllers.set(jobId, ac);
        state.activeJobId = jobId;

        const job: JobRecord = {
          jobId,
          profileId: profile.id,
          state: "running",
          startedAt: new Date().toISOString(),
          finishedAt: null,
          planSummary: plan.summary,
          progress: {
            completedActions: 0,
            totalActions: plan.actions.filter((a) => a.kind !== "skip").length,
            bytesTransferred: 0,
            totalBytes: plan.summary.totalBytesToDownload,
            currentPath: null,
          },
          result: null,
          warnings: [...plan.warnings],
          errors: [],
        };
        await saveJob(job);

        const norm = normalizeShare(profile.shareUrl);
        if (!norm) {
          state.activeJobId = null;
          state.abortControllers.delete(jobId);
          return json(res, 500, { error: "invalid share" });
        }
        const localAbs = resolveLocalRoot(profile.localRoot);
        const pwd = profile.sharePassword?.trim() ? profile.sharePassword : undefined;
        const localNow = await scanLocalTree(localAbs, profile.excludePatterns);
        const previousState = await loadSyncState(profile.id);
        const conflicts = detectConflicts(plan, {
          currentLocal: new Map(localNow.map((f) => [f.relativePath, f])),
          previousLocal: toPreviousLocalMap(previousState),
        });
        const conflictSession: JobConflictSession = {
          jobId,
          conflicts,
          nextIndex: 0,
          pending: null,
          applyToRemainingDecision: null,
          waiter: null,
        };
        if (conflicts.length > 0) {
          conflictSessions.set(jobId, conflictSession);
        }

        void (async () => {
          const log = async (
            level: "info" | "warn" | "error",
            code: string,
            message: string,
            meta: Record<string, unknown>,
          ) => {
            const entry = {
              ts: new Date().toISOString(),
              level,
              code,
              message,
              meta,
              path: typeof meta.path === "string" ? meta.path : undefined,
            };
            appendJobLog(jobId, entry);
            await persistLogLine(jobId, JSON.stringify(entry));
          };

          await log("info", "JOB_START", "Sync job started", { profileId: profile.id, planId: plan.planId });

          try {
            const result = await executePlan({
              profile,
              plan,
              publicDavBaseUrl: norm.publicDavBaseUrl,
              shareToken: norm.shareToken,
              localRootAbs: localAbs,
              signal: ac.signal,
              log,
              conflictPaths: new Set(conflicts.map((c) => c.path)),
              resolveConflict: async (path, remote) => {
                const session = conflictSessions.get(jobId);
                if (!session) return { decision: "replace" as const };
                if (session.applyToRemainingDecision) {
                  return { decision: session.applyToRemainingDecision };
                }
                const next = session.conflicts[session.nextIndex];
                if (!next || next.path !== path) return { decision: "replace" as const };
                session.pending = {
                  ...next,
                  remote: {
                    size: remote.size,
                    etag: remote.etag,
                    lastModified: remote.lastModified,
                  },
                };
                job.state = "awaiting_decision";
                await saveJob(job);
                await log("warn", "CONFLICT_AWAITING_DECISION", "Run paused for conflict decision", {
                  path: next.path,
                });
                const decisionPayload = await new Promise<{ decision: ConflictDecision; applyToRemaining: boolean }>(
                  (resolveDecision) => {
                    session.waiter = resolveDecision;
                  },
                );
                if (decisionPayload.applyToRemaining) {
                  session.applyToRemainingDecision = decisionPayload.decision;
                }
                session.nextIndex += 1;
                session.pending = null;
                if (decisionPayload.decision !== "cancel_run") {
                  job.state = "running";
                  await saveJob(job);
                }
                await log("info", "CONFLICT_DECISION_APPLIED", "Conflict decision applied", {
                  path: next.path,
                  decision: decisionPayload.decision,
                  applyToRemaining: decisionPayload.applyToRemaining,
                });
                return { decision: decisionPayload.decision };
              },
              onProgress: (completed, total, bytes, totalBytes, currentPath) => {
                job.progress = {
                  completedActions: completed,
                  totalActions: total,
                  bytesTransferred: bytes,
                  totalBytes: totalBytes,
                  currentPath,
                };
                void saveJob(job);
              },
            });

            if (result.message === "cancelled") {
              job.state = "cancelled";
              job.finishedAt = new Date().toISOString();
              job.result = { ok: false, message: "cancelled" };
              await log("warn", "RUN_CANCELLED", "Sync job cancelled by operator request", {});
            } else {
              job.state = result.ok ? "completed" : "failed";
              job.finishedAt = new Date().toISOString();
              job.result = { ok: result.ok, message: result.message };
            }

            if (result.ok) {
              // Persist sync-state only after a successful run, so delta comparisons
              // are based on confirmed completed mirrors, not preview-only plan snapshots.
              const remoteAfter = await listRemoteTree(norm.publicDavBaseUrl, {
                password: pwd,
                shareToken: norm.shareToken,
              });
              const localAfter = await scanLocalTree(localAbs, profile.excludePatterns);
              await saveSyncState(profile.id, remoteAfter, localAfter);
            }

            if (result.ok && profile.postSync?.triggerShowcaseReindex) {
              const url = process.env.AVMS_SHOWCASE_RESCAN_URL?.trim();
              if (url) {
                try {
                  const r = await fetch(url, { method: "POST" });
                  await log("info", "SHOWCASE_REINDEX", r.ok ? "Reindex triggered" : "Reindex failed", {
                    status: r.status,
                  });
                } catch (e) {
                  await log("warn", "SHOWCASE_REINDEX_ERR", e instanceof Error ? e.message : String(e), {});
                }
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const aborted = ac.signal.aborted || msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("cancel");
            if (aborted) {
              await log("warn", "RUN_CANCELLED", "Sync job cancelled by operator request", {});
              job.state = "cancelled";
              job.finishedAt = new Date().toISOString();
              job.result = { ok: false, message: "cancelled" };
              job.errors.push({ code: "run_cancelled", message: "cancelled" });
              state.activeJobId = null;
              state.abortControllers.delete(jobId);
              state.lastCompletedJobAt = job.finishedAt;
              await saveJob(job);
              return;
            }
            const auth = classifyAuthFailureMessage(msg);
            if (auth) {
              await log("error", "RUN_AUTH_FAILED", auth.message, {});
              job.errors.push({ code: auth.code, message: auth.message });
              job.result = { ok: false, message: auth.message };
            } else {
              await log("error", "RUN_FAILED", msg, {});
              job.errors.push({ code: "run_failed", message: msg });
              job.result = { ok: false, message: msg };
            }
            job.state = "failed";
            job.finishedAt = new Date().toISOString();
          }

          state.activeJobId = null;
          state.abortControllers.delete(jobId);
          state.lastCompletedJobAt = job.finishedAt;
          conflictSessions.delete(jobId);
          await saveJob(job);
        })();

        return json(res, 200, { jobId, accepted: true, state: "queued" });
      }

      {
        const m = /^\/api\/nextcloud-sync\/cancel\/([^/]+)\/?$/.exec(path);
        if (m && req.method === "POST") {
          const jobId = decodeURIComponent(m[1] ?? "");
          const ac = state.abortControllers.get(jobId);
          if (ac) ac.abort();
          const session = conflictSessions.get(jobId);
          if (session?.waiter) {
            const waiter = session.waiter;
            session.waiter = null;
            session.pending = null;
            waiter({ decision: "cancel_run", applyToRemaining: false });
          }
          return json(res, 200, { ok: true });
        }
      }

      {
        const m = /^\/api\/nextcloud-sync\/conflicts\/([^/]+)\/?$/.exec(path);
        if (m && req.method === "GET") {
          const jobId = decodeURIComponent(m[1] ?? "");
          const j = await loadJob(jobId);
          if (!j) return json(res, 404, { error: "job_not_found" });
          const session = conflictSessions.get(jobId);
          return json(res, 200, {
            jobId,
            state: j.state,
            pendingCount: session ? session.conflicts.length - session.nextIndex : 0,
            current: session?.pending ?? null,
            applyToRemainingDecision: session?.applyToRemainingDecision ?? null,
          });
        }
      }

      {
        const m = /^\/api\/nextcloud-sync\/conflicts\/([^/]+)\/decision\/?$/.exec(path);
        if (m && req.method === "POST") {
          const jobId = decodeURIComponent(m[1] ?? "");
          const session = conflictSessions.get(jobId);
          if (!session) return json(res, 404, { error: "conflict_session_not_found" });
          if (!session.pending || !session.waiter) {
            return json(res, 409, { error: "no_pending_conflict" });
          }
          const body = (await readJson(req)) as { decision?: ConflictDecision; applyToRemaining?: boolean };
          const decision = body.decision;
          if (decision !== "replace" && decision !== "keep_local" && decision !== "cancel_run") {
            return json(res, 422, { error: "decision must be replace|keep_local|cancel_run" });
          }
          const applyToRemaining = Boolean(body.applyToRemaining);
          const waiter = session.waiter;
          session.waiter = null;
          const pending = session.pending;
          session.pending = null;
          waiter({ decision, applyToRemaining });
          return json(res, 200, {
            ok: true,
            jobId,
            resolvedConflictId: pending.id,
            decision,
            applyToRemaining,
          });
        }
      }

      if (req.method === "GET" && path === "/api/nextcloud-sync/jobs") {
        const jobs = await listJobs();
        return json(res, 200, jobs);
      }

      {
        const m = /^\/api\/nextcloud-sync\/jobs\/([^/]+)\/?$/.exec(path);
        if (m && req.method === "GET") {
          const jobId = decodeURIComponent(m[1] ?? "");
          const j = await loadJob(jobId);
          if (!j) return json(res, 404, { error: "not found" });
          return json(res, 200, j);
        }
      }

      {
        const m = /^\/api\/nextcloud-sync\/logs\/([^/]+)\/?$/.exec(path);
        if (m && req.method === "GET") {
          const jobId = decodeURIComponent(m[1] ?? "");
          const { entries, text } = await readJobLogs(jobId);
          return json(res, 200, { jobId, entries, text });
        }
      }

      json(res, 404, { error: "not_found", path });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  server.listen(port, host, () => {
    console.info(`[nextcloud-sync] http://${host}:${port}  dashboard: /dashboard/`);
  });
  return server;
}
