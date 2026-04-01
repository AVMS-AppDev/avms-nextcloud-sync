import { access, constants, mkdir, stat } from "fs/promises";
import { isAbsolute, resolve } from "path";

export function resolveLocalRoot(localRoot: string): string {
  const trimmed = localRoot.trim();
  if (isAbsolute(trimmed)) return trimmed;
  return resolve(process.cwd(), trimmed);
}

export async function checkLocalPath(localRoot: string): Promise<{
  exists: boolean;
  isDirectory: boolean;
  writable: boolean;
}> {
  try {
    const st = await stat(localRoot);
    const isDirectory = st.isDirectory();
    let writable = false;
    if (isDirectory) {
      try {
        await access(localRoot, constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
    }
    return { exists: true, isDirectory, writable };
  } catch {
    return { exists: false, isDirectory: false, writable: false };
  }
}

export async function ensureLocalRoot(localRoot: string): Promise<void> {
  await mkdir(localRoot, { recursive: true });
}
