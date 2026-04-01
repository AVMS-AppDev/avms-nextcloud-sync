/** Minimal WebDAV multistatus parser for Nextcloud public DAV (href + collection + props). */

export interface DavPropEntry {
  readonly href: string;
  readonly isCollection: boolean;
  readonly contentLength: number | null;
  readonly lastModified: string | null;
  readonly etag: string | null;
}

function decodeHref(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function parsePropfindMultistatus(xml: string): DavPropEntry[] {
  const out: DavPropEntry[] = [];
  const responseRe = /<(?:[a-zA-Z]+:)?response[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?response>/g;
  let rm: RegExpExecArray | null;
  while ((rm = responseRe.exec(xml)) !== null) {
    const block = rm[1] ?? "";
    const hrefM = /<[^>]*:?href[^>]*>([^<]*)<\/[^>]*:?href>/.exec(block);
    if (!hrefM?.[1]) continue;
    const href = decodeHref(hrefM[1].trim());
    const isCollection =
      /<(?:[a-zA-Z]+:)?collection\s*\/?>/.test(block) ||
      /<(?:[a-zA-Z]+:)?resourcetype[^>]*>[\s\S]*<(?:[a-zA-Z]+:)?collection/.test(block);
    const lenM = /<(?:[a-zA-Z]+:)?getcontentlength[^>]*>([^<]*)<\/(?:[a-zA-Z]+:)?getcontentlength>/.exec(
      block,
    );
    const lmM = /<(?:[a-zA-Z]+:)?getlastmodified[^>]*>([^<]*)<\/(?:[a-zA-Z]+:)?getlastmodified>/.exec(
      block,
    );
    const etagM = /<(?:[a-zA-Z]+:)?getetag[^>]*>([^<]*)<\/(?:[a-zA-Z]+:)?getetag>/.exec(block);
    const contentLength = lenM?.[1] ? Number.parseInt(lenM[1].trim(), 10) : null;
    out.push({
      href,
      isCollection,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      lastModified: lmM?.[1]?.trim() ?? null,
      etag: etagM?.[1]?.replace(/^"|"$/g, "").trim() ?? null,
    });
  }
  return out;
}
