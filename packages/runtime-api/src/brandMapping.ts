/**
 * Wave 2: map remote top-level share segment (brand folder) to a local subdirectory name.
 * DAV paths stay canonical; planner uses localPathForDav for disk paths.
 */

export function sanitizeBrandSegment(s: string): string | null {
  const t = s.trim();
  if (!t || t === "." || t === "..") return null;
  if (t.includes("/") || t.includes("\\") || t.includes("\0")) return null;
  return t;
}

export function parseBrandLocalSegmentMap(
  raw: unknown,
): { ok: true; map: Map<string, string> } | { ok: false; error: string } {
  if (raw == null || raw === undefined) return { ok: true, map: new Map() };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "brandLocalSegmentMap must be a JSON object" };
  }
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ks = sanitizeBrandSegment(String(k));
    const vs = sanitizeBrandSegment(String(v));
    if (!ks || !vs) {
      return { ok: false, error: `invalid brand segment in mapping: ${String(k)} -> ${String(v)}` };
    }
    map.set(ks, vs);
  }
  return { ok: true, map };
}

export function buildLocalPathForDavFromSegmentMap(segmentMap: Map<string, string>): (dav: string) => string {
  return (dav: string) => {
    const parts = dav.split("/").filter(Boolean);
    if (parts.length === 0) return dav;
    const b0 = parts[0];
    const localSeg = segmentMap.get(b0) ?? b0;
    if (localSeg === b0) return dav;
    const rest = parts.slice(1);
    return rest.length ? `${localSeg}/${rest.join("/")}` : localSeg;
  };
}
