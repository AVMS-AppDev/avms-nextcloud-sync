import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { PlanResult } from "@avms-appsuite/nextcloud-sync-contracts";
import { plansDir } from "./paths.js";

const mem = new Map<string, PlanResult>();

export async function persistPlan(plan: PlanResult): Promise<void> {
  mem.set(plan.planId, plan);
  await mkdir(plansDir(), { recursive: true });
  await writeFile(join(plansDir(), `${plan.planId}.json`), JSON.stringify(plan, null, 2), "utf8");
}

export async function loadPlan(planId: string): Promise<PlanResult | null> {
  const m = mem.get(planId);
  if (m) return m;
  try {
    const raw = await readFile(join(plansDir(), `${planId}.json`), "utf8");
    const p = JSON.parse(raw) as PlanResult;
    mem.set(planId, p);
    return p;
  } catch {
    return null;
  }
}
