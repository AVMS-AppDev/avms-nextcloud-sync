import type { ValidateRequest, ValidateResult } from "@avms-appsuite/nextcloud-sync-contracts";
import {
  entriesFromPropfind,
  normalizeShare,
  parsePropfindMultistatus,
  propfind,
} from "@avms-appsuite/nextcloud-sync-dav-client";
import { checkLocalPath, ensureLocalRoot, resolveLocalRoot } from "./localPath.js";

export async function validateShareRequest(req: ValidateRequest): Promise<ValidateResult> {
  const errors: { code: string; message: string }[] = [];
  const warnings: string[] = [];

  const normalized = normalizeShare(req.shareUrl);
  if (!normalized) {
    errors.push({ code: "invalid_share_url", message: "Could not parse Nextcloud public share URL" });
    return { ok: false, warnings, errors };
  }

  const pwd = req.sharePassword?.trim() ? req.sharePassword : undefined;
  const localAbs = resolveLocalRoot(req.localRoot);

  let reachable = false;
  let isDirectoryShare = false;
  let itemCountEstimate = 0;
  let requiresPassword = false;

  const davOpts = { password: pwd, shareToken: normalized.shareToken };

  try {
    const base = normalized.publicDavBaseUrl.endsWith("/")
      ? normalized.publicDavBaseUrl
      : `${normalized.publicDavBaseUrl}/`;
    const xml0 = await propfind(base, "0", davOpts);
    const nodes = parsePropfindMultistatus(xml0);
    const root = nodes[0];
    if (root) {
      reachable = true;
      isDirectoryShare =
        root.isCollection ||
        /<(?:[a-zA-Z]+:)?collection\s*\/?>/.test(xml0) ||
        /collection/.test(xml0);
    }
    try {
      const xml1 = await propfind(base, "1", davOpts);
      const { entries } = entriesFromPropfind(base, xml1);
      itemCountEstimate = entries.length;
    } catch {
      /* ignore depth-1 failure */
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
      if (pwd) {
        errors.push({
          code: "auth_failed",
          message:
            "Share rejected the provided password (or token). Try the link password in sharePassword; Nextcloud expects Basic auth username=share token, password=link password.",
        });
      } else {
        requiresPassword = true;
        errors.push({
          code: "auth_required",
          message: "Share requires a password — send sharePassword in the validate request (and ensure shareUrl contains the token).",
        });
      }
    } else {
      errors.push({ code: "remote_unreachable", message: msg });
    }
    const local = await checkLocalPath(localAbs);
    return {
      ok: false,
      normalized,
      remote: {
        reachable: false,
        isDirectoryShare: false,
        requiresPassword,
        permissions: { read: false, create: false, update: false, delete: false },
        itemCountEstimate: 0,
      },
      local: {
        exists: local.exists,
        isDirectory: local.isDirectory,
        writable: local.writable,
      },
      warnings,
      errors,
    };
  }

  const local = await checkLocalPath(localAbs);
  if (!local.exists) {
    try {
      await ensureLocalRoot(localAbs);
      warnings.push(`Created local root: ${localAbs}`);
    } catch (e) {
      errors.push({
        code: "local_not_writable",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const localAfter = await checkLocalPath(localAbs);

  return {
    ok: errors.length === 0 && reachable && isDirectoryShare && localAfter.writable,
    normalized,
    remote: {
      reachable,
      isDirectoryShare,
      requiresPassword,
      permissions: { read: true, create: false, update: false, delete: false },
      itemCountEstimate,
    },
    local: {
      exists: localAfter.exists,
      isDirectory: localAfter.isDirectory,
      writable: localAfter.writable,
    },
    warnings,
    errors,
  };
}
