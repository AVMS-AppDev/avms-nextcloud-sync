/**
 * build-release.mjs — Build the Nextcloud Sync standalone bundle.
 *
 * Bundles the TypeScript server with esbuild, copies dashboard, bundles Node.js runtime.
 *
 * Usage:
 *   node scripts/build-release.mjs
 *
 * Output: release/avms-nextcloud-sync/
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, cpSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DIST = resolve(REPO_ROOT, "release", "avms-nextcloud-sync");

function log(msg) {
  console.log(`[build-release] ${msg}`);
}

// Step 1: Build all packages
log("Building all packages...");
execSync("pnpm.cmd run build", { cwd: REPO_ROOT, stdio: "inherit" });

// Step 2: Bundle server with esbuild
log("Bundling server...");
const { build } = await import("esbuild");
const appDir = resolve(DIST, "app");
mkdirSync(appDir, { recursive: true });

await build({
  entryPoints: [resolve(REPO_ROOT, "packages/runtime-api/src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: resolve(appDir, "server.cjs"),
  format: "cjs",
  sourcemap: true,
  logLevel: "warning",
  // CJS output doesn't support `import.meta.url` — inject a shim so the
  // bundled server can still use it for resolving relative module paths.
  banner: {
    js: "const __import_meta_url = require('url').pathToFileURL(__filename).href;",
  },
  define: {
    "import.meta.url": "__import_meta_url",
  },
});
log("  app/server.cjs bundled");

// Step 3: Copy dashboard
const dashSrc = resolve(REPO_ROOT, "packages/dashboard/dist");
const dashDest = resolve(DIST, "resources/dashboard");
if (existsSync(dashSrc)) {
  mkdirSync(resolve(DIST, "resources"), { recursive: true });
  cpSync(dashSrc, dashDest, { recursive: true });
  log("  resources/dashboard/ copied");
} else {
  log("  WARN: dashboard not built (packages/dashboard/dist missing)");
}

// Step 4: Bundle Node.js runtime
const nodeDir = resolve(DIST, "tools/node");
mkdirSync(nodeDir, { recursive: true });
copyFileSync(process.execPath, resolve(nodeDir, "node.exe"));
log("  tools/node/node.exe bundled");

// Step 5: Create data dirs
mkdirSync(resolve(DIST, "data/config"), { recursive: true });
mkdirSync(resolve(DIST, "data/logs"), { recursive: true });
mkdirSync(resolve(DIST, "data/sync"), { recursive: true });

// Step 6: Create launcher
writeFileSync(resolve(DIST, "NextcloudSync.cmd"), [
  "@echo off",
  'cd /d "%~dp0"',
  'set "PATH=%~dp0tools\\node;%PATH%"',
  "set AVMS_NEXTCLOUD_SYNC_PORT=28570",
  'set "AVMS_NEXTCLOUD_SYNC_DATA_DIR=%~dp0data"',
  'echo Starting Nextcloud Sync on http://localhost:28570/',
  'node "%~dp0app\\server.cjs"',
  "if errorlevel 1 pause",
  "",
].join("\r\n"), "utf-8");

// Step 7: Metadata
const version = "0.1.0";
const buildDate = new Date().toISOString().split("T")[0];
writeFileSync(resolve(DIST, "VERSION"), `${version}\n${buildDate}\n`, "utf-8");
writeFileSync(resolve(DIST, "README.txt"), `AVMS Nextcloud Sync — Standalone Bundle
Version: ${version} | Built: ${buildDate}

Start: double-click NextcloudSync.cmd (Node.js bundled)

URLs:
  Dashboard: http://localhost:28570/dashboard/
  API:       http://localhost:28570/api/nextcloud-sync/status

No prerequisites. Node.js runtime is bundled.
`, "utf-8");

log(`Bundle ready: ${DIST}`);
