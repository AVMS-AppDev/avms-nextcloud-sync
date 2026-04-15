import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { ValidateRequest, ValidateResult } from "@avms-appsuite/nextcloud-sync-contracts";
import { dataRootDir } from "./paths.js";

export interface LastValidationRecord {
  readonly checkedAt: string;
  readonly request: {
    readonly shareUrl: string;
    readonly localRoot: string;
    readonly hasSharePassword: boolean;
  };
  readonly result: {
    readonly ok: boolean;
    readonly normalizedShareToken?: string;
    readonly resolvedDavBaseUrl?: string;
    readonly reachable?: boolean;
    readonly requiresPassword?: boolean;
    readonly errorCodes: readonly string[];
    readonly firstError?: string;
  };
}

function validationPath(): string {
  return join(dataRootDir(), "last-validation.json");
}

export async function loadLastValidation(): Promise<LastValidationRecord | null> {
  try {
    const raw = await readFile(validationPath(), "utf8");
    return JSON.parse(raw) as LastValidationRecord;
  } catch {
    return null;
  }
}

export async function persistLastValidation(
  req: ValidateRequest,
  result: ValidateResult,
): Promise<LastValidationRecord> {
  const payload: LastValidationRecord = {
    checkedAt: new Date().toISOString(),
    request: {
      shareUrl: req.shareUrl,
      localRoot: req.localRoot,
      hasSharePassword: Boolean(req.sharePassword?.trim()),
    },
    result: {
      ok: result.ok,
      normalizedShareToken: result.normalized?.shareToken,
      resolvedDavBaseUrl: result.normalized?.publicDavBaseUrl,
      reachable: result.remote?.reachable,
      requiresPassword: result.remote?.requiresPassword,
      errorCodes: result.errors.map((e) => e.code),
      firstError: result.errors[0]?.message,
    },
  };
  await mkdir(dataRootDir(), { recursive: true });
  await writeFile(validationPath(), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
