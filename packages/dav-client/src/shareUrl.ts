import type { NormalizedShare } from "@avms-appsuite/nextcloud-sync-contracts";

const NEXTCLOUD_S_PATH = /\/s\/([A-Za-z0-9]+)(?:\/?|\?|#|$)/;

export function extractShareToken(shareUrl: string): string | null {
  try {
    const u = new URL(shareUrl.trim());
    const m = u.pathname.match(NEXTCLOUD_S_PATH);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function normalizeShare(shareUrl: string): NormalizedShare | null {
  const trimmed = shareUrl.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  const token = extractShareToken(trimmed);
  if (!token) return null;
  const origin = `${u.protocol}//${u.host}`;
  const publicWebUrl = `${origin}/s/${token}`;
  const publicDavBaseUrl = `${origin}/public.php/dav/files/${token}/`;
  return {
    shareToken: token,
    publicWebUrl,
    publicDavBaseUrl,
  };
}
