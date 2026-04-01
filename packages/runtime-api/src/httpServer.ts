import { createReadStream, existsSync, readFileSync } from "fs";
import http, { type IncomingMessage, type ServerResponse } from "http";
import { dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";
import type { JobRecord, RunRequest, SyncProfile, ValidateRequest } from "@avms-appsuite/nextcloud-sync-contracts";
import { listRemoteTree, normalizeShare } from "@avms-appsuite/nextcloud-sync-dav-client";
import { buildPullMirrorPlan, executePlan, scanLocalTree } from "@avms-appsuite/nextcloud-sync-core";
import { dataRootDir } from "./paths.js";
import { deleteProfile, getProfile, listProfiles, saveProfile } from "./profileStore.js";
import { loadPlan, persistPlan } from "./planStore.js";
import { appendJobLog, listJobs, loadJob, persistLogLine, readJobLogs, saveJob } from "./jobStore.js";
import { checkLocalPath, resolveLocalRoot } from "./localPath.js";
import { validateShareRequest } from "./validateShare.js";

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

export function startHttpServer(host: string, port: number, state: ServerState): http.Server {
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
        return json(res, 200, r);
      }

      if (req.method === "POST" && path === "/api/nextcloud-sync/plan") {
        const body = (await readJson(req)) as { profileId?: string };
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
        const remote = await listRemoteTree(norm.publicDavBaseUrl, { password: pwd });
        const local = await scanLocalTree(localAbs, profile.excludePatterns);
        const plan = buildPullMirrorPlan(profile, remote, local);
        await persistPlan(plan);
        return json(res, 200, plan);
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
              localRootAbs: localAbs,
              signal: ac.signal,
              log,
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

            job.state = result.ok ? "completed" : "failed";
            job.finishedAt = new Date().toISOString();
            job.result = { ok: result.ok, message: result.message };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await log("error", "RUN_FAILED", msg, {});
            job.state = "failed";
            job.finishedAt = new Date().toISOString();
            job.result = { ok: false, message: msg };
            job.errors.push({ code: "run_failed", message: msg });
          }

          state.activeJobId = null;
          state.abortControllers.delete(jobId);
          state.lastCompletedJobAt = job.finishedAt;
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
          return json(res, 200, { ok: true });
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
