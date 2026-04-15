/** API and persistence contracts for avms-nextcloud-sync (V1). */

export type SyncMode = "pull-mirror" | "pull-update-only";

/** Delete policy: mirror-delete-local removes local files absent on remote when in pull-mirror. */
export type DeletePolicy = "none" | "mirror-delete-local";

export type ConflictPolicy = "remote-wins";

export interface ProfilePostSync {
  readonly triggerShowcaseReindex?: boolean;
}

export interface ProfileSafety {
  readonly requirePreviewBeforeRun?: boolean;
  readonly maxDeleteCountWithoutExtraConfirm?: number;
}

export interface SyncProfile {
  readonly id: string;
  readonly name: string;
  readonly shareUrl: string;
  readonly sharePassword?: string;
  readonly localRoot: string;
  readonly mode: SyncMode;
  readonly deletePolicy: DeletePolicy;
  readonly conflictPolicy: ConflictPolicy;
  readonly excludePatterns: readonly string[];
  readonly postSync?: ProfilePostSync;
  readonly safety?: ProfileSafety;
}

export interface StatusResponse {
  readonly service: "avms-nextcloud-sync";
  readonly version: string;
  readonly healthy: boolean;
  readonly activeJobId: string | null;
  readonly profilesCount: number;
  readonly lastCompletedJobAt: string | null;
  readonly storageRoot: string;
  readonly capabilities: {
    readonly embeddedDashboard: boolean;
    readonly manualSync: boolean;
    readonly autoSync: boolean;
    readonly twoWayExperimental: boolean;
  };
  readonly targets?: readonly {
    readonly profileId: string;
    readonly name: string;
    readonly shareUrl: string;
    readonly shareToken: string | null;
    readonly resolvedDavBaseUrl: string | null;
    readonly localRoot: string;
  }[];
  readonly activeJob?: JobRecord | null;
  readonly lastRun?: {
    readonly jobId: string;
    readonly profileId: string;
    readonly state: JobState;
    readonly startedAt: string;
    readonly finishedAt: string | null;
    readonly result: { readonly ok: boolean; readonly message?: string } | null;
    readonly summary: PlanSummary | null;
    readonly progress: JobProgress;
    readonly errors: readonly { readonly code: string; readonly message: string }[];
    readonly warnings: readonly string[];
  } | null;
  readonly lastSuccessfulRun?: Record<string, unknown> | null;
  readonly lastNonSuccessRun?: Record<string, unknown> | null;
  readonly runClass?: "success" | "failed" | "aborted" | "running" | null;
  readonly counters?: {
    readonly discoveredFiles: number;
    readonly downloadedOrReplaced: number;
    readonly skipped: number;
    readonly failed: number;
    readonly deletedLocal: number;
  } | null;
  readonly lastValidation?: {
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
  } | null;
}

export interface ValidateRequest {
  readonly shareUrl: string;
  readonly sharePassword?: string;
  readonly localRoot: string;
}

export interface NormalizedShare {
  readonly shareToken: string;
  readonly publicWebUrl: string;
  readonly publicDavBaseUrl: string;
}

export interface ValidatePermissions {
  readonly read: boolean;
  readonly create: boolean;
  readonly update: boolean;
  readonly delete: boolean;
}

export interface ValidateResult {
  readonly ok: boolean;
  readonly normalized?: NormalizedShare;
  readonly remote?: {
    readonly reachable: boolean;
    readonly isDirectoryShare: boolean;
    readonly displayName?: string;
    readonly requiresPassword: boolean;
    readonly permissions: ValidatePermissions;
    readonly itemCountEstimate: number;
  };
  readonly local?: {
    readonly exists: boolean;
    readonly isDirectory: boolean;
    readonly writable: boolean;
  };
  readonly warnings: readonly string[];
  readonly errors: readonly { readonly code: string; readonly message: string }[];
}

export type PlanActionKind =
  | "create-dir"
  | "download-file"
  | "replace-file"
  | "delete-local-file"
  | "skip";

export interface PlanAction {
  readonly kind: PlanActionKind;
  /** Local relative path under profile.localRoot (after optional brand→folder mapping). */
  readonly path: string;
  /** DAV path under the share when it differs from `path` (brand mapping); omit if same as `path`. */
  readonly remoteDavPath?: string;
  readonly remote?: {
    readonly etag?: string;
    readonly size: number;
    readonly lastModified?: string;
  };
}

export interface PlanSummary {
  readonly createDirs: number;
  readonly downloadFiles: number;
  readonly replaceFiles: number;
  readonly deleteLocalFiles: number;
  readonly conflicts: number;
  readonly skipped: number;
  readonly totalBytesToDownload: number;
}

export interface PlanResult {
  readonly profileId: string;
  readonly mode: SyncMode;
  readonly summary: PlanSummary;
  readonly actions: readonly PlanAction[];
  readonly warnings: readonly string[];
  readonly planId: string;
}

export interface RunRequest {
  readonly profileId: string;
  readonly planId: string;
  readonly confirmDeletes?: boolean;
}

export interface RunAccepted {
  readonly jobId: string;
  readonly accepted: boolean;
  readonly state: "queued" | "running";
}

export type JobState = "queued" | "running" | "awaiting_decision" | "completed" | "failed" | "cancelled";

export interface JobProgress {
  completedActions: number;
  totalActions: number;
  bytesTransferred: number;
  totalBytes: number;
  currentPath: string | null;
}

export interface JobRecord {
  jobId: string;
  profileId: string;
  state: JobState;
  startedAt: string;
  finishedAt: string | null;
  planSummary: PlanSummary | null;
  progress: JobProgress;
  result: { ok: boolean; message?: string } | null;
  warnings: string[];
  errors: { code: string; message: string }[];
}

export type ConflictDecision = "replace" | "keep_local" | "cancel_run";

export interface ConflictItem {
  readonly id: string;
  readonly path: string;
  readonly reason: "local_drift_from_baseline";
  readonly baseline?: { readonly size: number; readonly mtimeMs: number };
  readonly local?: { readonly size: number; readonly mtimeMs: number };
  readonly remote?: { readonly size?: number; readonly etag?: string; readonly lastModified?: string };
}

export interface ConflictStatusResponse {
  readonly jobId: string;
  readonly state: JobState;
  readonly pendingCount: number;
  readonly current: ConflictItem | null;
  readonly applyToRemainingDecision: ConflictDecision | null;
}

export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  code: string;
  path?: string;
  message: string;
  meta?: Record<string, unknown>;
}
