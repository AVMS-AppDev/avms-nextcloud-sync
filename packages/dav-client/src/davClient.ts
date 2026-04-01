import { parsePropfindMultistatus } from "./propfindParse.js";

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:getetag/>
  </d:prop>
</d:propfind>`;

export interface DavFetchOpts {
  readonly password?: string;
  readonly signal?: AbortSignal;
}

export async function propfind(
  url: string,
  depth: "0" | "1" | "infinity",
  opts: DavFetchOpts = {},
): Promise<string> {
  const headers: Record<string, string> = {
    Depth: depth,
    "Content-Type": "application/xml; charset=utf-8",
  };
  if (opts.password) {
    const b64 = Buffer.from(`:${opts.password}`, "utf8").toString("base64");
    headers.Authorization = `Basic ${b64}`;
  }
  const res = await fetch(url, {
    method: "PROPFIND",
    headers,
    body: PROPFIND_BODY,
    signal: opts.signal,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PROPFIND ${res.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

export { parsePropfindMultistatus };

export interface RemoteFileEntry {
  readonly relativePath: string;
  readonly size: number;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

/** Build relative paths (posix) under share root from DAV base + multistatus. */
export function entriesFromPropfind(
  publicDavBaseUrl: string,
  xml: string,
): { rootHref: string; entries: RemoteFileEntry[] } {
  const baseNorm = publicDavBaseUrl.endsWith("/") ? publicDavBaseUrl : `${publicDavBaseUrl}/`;
  const rootPath = new URL(baseNorm).pathname;
  const raw = parsePropfindMultistatus(xml);
  const entries: RemoteFileEntry[] = [];
  for (const e of raw) {
    if (e.isCollection) continue;
    const abs = new URL(e.href, baseNorm);
    let rel = abs.pathname.slice(rootPath.length).replace(/^\/+/, "");
    if (!rel) continue;
    const size = e.contentLength ?? 0;
    entries.push({
      relativePath: rel
        .split("/")
        .map((seg) => {
          try {
            return decodeURIComponent(seg);
          } catch {
            return seg;
          }
        })
        .join("/"),
      size,
      etag: e.etag,
      lastModified: e.lastModified,
    });
  }
  return { rootHref: baseNorm, entries };
}

async function listRemoteTreeBfs(base: string, opts: DavFetchOpts): Promise<RemoteFileEntry[]> {
  const baseNorm = base.endsWith("/") ? base : `${base}/`;
  const rootUrl = new URL(baseNorm);
  const rootPath = rootUrl.pathname;
  const queue: string[] = [baseNorm];
  const visited = new Set<string>([baseNorm]);
  const files: RemoteFileEntry[] = [];

  while (queue.length > 0) {
    const dir = queue.shift()!;
    const xml = await propfind(dir, "1", opts);
    const nodes = parsePropfindMultistatus(xml);
    for (const n of nodes) {
      const abs = new URL(n.href, baseNorm);
      if (n.isCollection) {
        const u = abs.pathname.endsWith("/") ? abs.toString() : `${abs.toString()}/`;
        if (u !== dir && u.startsWith(baseNorm) && !visited.has(u)) {
          visited.add(u);
          queue.push(u);
        }
      } else {
        let rel = abs.pathname.slice(rootPath.length).replace(/^\/+/, "");
        if (!rel) continue;
        rel = rel
          .split("/")
          .map((seg) => {
            try {
              return decodeURIComponent(seg);
            } catch {
              return seg;
            }
          })
          .join("/");
        files.push({
          relativePath: rel,
          size: n.contentLength ?? 0,
          etag: n.etag,
          lastModified: n.lastModified,
        });
      }
    }
  }
  return files;
}

/** Remote file listing: try Depth infinity, then breadth-first Depth 1. */
export async function listRemoteTree(
  publicDavBaseUrl: string,
  opts: DavFetchOpts = {},
): Promise<RemoteFileEntry[]> {
  const baseNorm = publicDavBaseUrl.endsWith("/") ? publicDavBaseUrl : `${publicDavBaseUrl}/`;
  try {
    const xml = await propfind(baseNorm, "infinity", opts);
    const { entries } = entriesFromPropfind(baseNorm, xml);
    return entries;
  } catch {
    return listRemoteTreeBfs(baseNorm, opts);
  }
}

export async function downloadFile(
  publicDavBaseUrl: string,
  relativePath: string,
  opts: DavFetchOpts = {},
): Promise<ArrayBuffer> {
  const baseNorm = publicDavBaseUrl.endsWith("/") ? publicDavBaseUrl : `${publicDavBaseUrl}/`;
  const segments = relativePath.split("/").filter(Boolean).map((s) => encodeURIComponent(s));
  const url = `${baseNorm}${segments.join("/")}`;
  const headers: Record<string, string> = {};
  if (opts.password) {
    headers.Authorization = `Basic ${Buffer.from(`:${opts.password}`, "utf8").toString("base64")}`;
  }
  const res = await fetch(url, { method: "GET", signal: opts.signal, headers });
  if (!res.ok) {
    throw new Error(`GET ${res.status} ${url}`);
  }
  return res.arrayBuffer();
}
