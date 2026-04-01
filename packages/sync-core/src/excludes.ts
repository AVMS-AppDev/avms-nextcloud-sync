import { minimatch } from "minimatch";

export function isExcluded(relativePosixPath: string, patterns: readonly string[]): boolean {
  const forward = relativePosixPath.replace(/\\/g, "/");
  for (const p of patterns) {
    if (minimatch(forward, p, { dot: true })) return true;
  }
  return false;
}
