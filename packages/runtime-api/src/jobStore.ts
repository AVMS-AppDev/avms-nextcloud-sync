import { appendFile, mkdir, readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import type { JobRecord, LogEntry } from "@avms-appsuite/nextcloud-sync-contracts";
import { jobsDir, logsRootDir } from "./paths.js";

export async function saveJob(job: JobRecord): Promise<void> {
  await mkdir(jobsDir(), { recursive: true });
  await writeFile(join(jobsDir(), `${job.jobId}.json`), JSON.stringify(job, null, 2), "utf8");
}

export async function loadJob(jobId: string): Promise<JobRecord | null> {
  try {
    const raw = await readFile(join(jobsDir(), `${jobId}.json`), "utf8");
    return JSON.parse(raw) as JobRecord;
  } catch {
    return null;
  }
}

export async function listJobs(): Promise<JobRecord[]> {
  await mkdir(jobsDir(), { recursive: true });
  const names = await readdir(jobsDir());
  const jobs: JobRecord[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const raw = await readFile(join(jobsDir(), n), "utf8");
    jobs.push(JSON.parse(raw) as JobRecord);
  }
  return jobs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

const logBuffers = new Map<string, LogEntry[]>();

export function appendJobLog(jobId: string, entry: LogEntry): void {
  const arr = logBuffers.get(jobId) ?? [];
  arr.push(entry);
  logBuffers.set(jobId, arr);
}

export async function persistLogLine(jobId: string, line: string): Promise<void> {
  await mkdir(logsRootDir(), { recursive: true });
  await appendFile(join(logsRootDir(), `${jobId}.log`), line + "\n", "utf8");
}

export async function readJobLogs(jobId: string): Promise<{ entries: LogEntry[]; text: string }> {
  const entries = logBuffers.get(jobId) ?? [];
  try {
    const raw = await readFile(join(logsRootDir(), `${jobId}.log`), "utf8");
    return { entries, text: raw };
  } catch {
    return { entries, text: entries.map((e) => JSON.stringify(e)).join("\n") };
  }
}
