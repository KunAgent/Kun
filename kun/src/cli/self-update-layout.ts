import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import semver from 'semver'

/**
 * Immutable-release layout for the standalone TUI. The archive installs to a
 * stable base directory that is never moved during an update:
 *
 *   kun/                        base (KUN_STANDALONE_ROOT)
 *     bin/kun | kun.cmd         stable launcher (reads the pointer, never moved)
 *     current                   pointer file: "releases/<buildId>"
 *     releases/<buildId>/       immutable version directory (runtime, app, ...)
 *
 * Switching versions is a single atomic rename of the pointer file, so the
 * previous "install root disappears between two renames" crash window cannot
 * exist. A legacy layout (release.json directly under the base) is still
 * resolved so existing installs keep working until the next update migrates.
 */

export const TUI_RELEASE_METADATA_FILENAME = 'release.json'
export const TUI_RELEASES_DIR = 'releases'
export const TUI_POINTER_FILE = 'current'

const BUILD_ID_PATTERN = /^[a-f0-9]{64}$/
const POINTER_PATTERN = /^releases\/([a-f0-9]{64})$/

export type StandaloneTuiLayout =
  | { kind: 'pointer'; base: string; releaseDir: string }
  | { kind: 'legacy'; base: string; releaseDir: string }

export function tuiPointerPath(base: string): string {
  return join(resolve(base), TUI_POINTER_FILE)
}

export function tuiReleasesDir(base: string): string {
  return join(resolve(base), TUI_RELEASES_DIR)
}

export function tuiReleaseDirForBuildId(base: string, buildId: string): string {
  return join(tuiReleasesDir(base), buildId)
}

export function pointerRelativeForBuildId(buildId: string): string {
  return `${TUI_RELEASES_DIR}/${buildId}`
}

export async function releaseDirHasMetadata(dir: string): Promise<boolean> {
  return stat(join(dir, TUI_RELEASE_METADATA_FILENAME)).then(() => true).catch(() => false)
}

export async function readPointerBuildId(base: string): Promise<string | null> {
  try {
    const raw = (await readFile(tuiPointerPath(base), 'utf8')).trim()
    const match = raw.match(POINTER_PATTERN)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/** Resolve the pointer to an existing release directory, or null when unusable. */
export async function resolvePointerReleaseDir(base: string): Promise<string | null> {
  const buildId = await readPointerBuildId(base)
  if (!buildId) return null
  const dir = tuiReleaseDirForBuildId(base, buildId)
  return (await releaseDirHasMetadata(dir)) ? dir : null
}

export async function listReleaseBuildIds(base: string): Promise<string[]> {
  try {
    const entries = await readdir(tuiReleasesDir(base), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && BUILD_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

async function readReleaseVersion(dir: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(dir, TUI_RELEASE_METADATA_FILENAME), 'utf8')
    ) as { version?: unknown }
    return typeof parsed.version === 'string' && semver.valid(parsed.version)
      ? parsed.version
      : null
  } catch {
    return null
  }
}

/** Fallback used by the launcher when the pointer is missing or damaged. */
export async function discoverBestReleaseDir(base: string): Promise<string | null> {
  const buildIds = await listReleaseBuildIds(base)
  let best: { dir: string; version: string } | null = null
  for (const buildId of buildIds) {
    const dir = tuiReleaseDirForBuildId(base, buildId)
    const version = await readReleaseVersion(dir)
    if (!version) continue
    if (!best || semver.gt(version, best.version)) best = { dir, version }
  }
  return best?.dir ?? null
}

/** Detect an un-migrated legacy install: release.json directly under the base. */
export async function isLegacyStandaloneLayout(base: string): Promise<boolean> {
  if (await stat(tuiReleasesDir(base)).then(() => true).catch(() => false)) return false
  if (await stat(tuiPointerPath(base)).then(() => true).catch(() => false)) return false
  return releaseDirHasMetadata(base)
}

/** Resolve the active release directory for a base, with launcher fallback. */
export async function resolveStandaloneTuiLayout(base: string): Promise<StandaloneTuiLayout | null> {
  const pointerDir = await resolvePointerReleaseDir(base)
  if (pointerDir) return { kind: 'pointer', base: resolve(base), releaseDir: pointerDir }
  const best = await discoverBestReleaseDir(base)
  if (best) return { kind: 'pointer', base: resolve(base), releaseDir: best }
  if (await releaseDirHasMetadata(base)) {
    return { kind: 'legacy', base: resolve(base), releaseDir: resolve(base) }
  }
  return null
}

/** Atomically rewrite the pointer file, then fsync the parent directory. */
export async function writeStandaloneReleasePointer(base: string, buildId: string): Promise<void> {
  const path = tuiPointerPath(base)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${pointerRelativeForBuildId(buildId)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
  await fsyncDirectory(dirname(path))
}

/** Remove release directories that are no longer referenced by the keep set. */
export async function garbageCollectReleases(
  base: string,
  keepBuildIds: readonly string[]
): Promise<void> {
  const keep = new Set(keepBuildIds)
  const buildIds = await listReleaseBuildIds(base)
  await Promise.all(
    buildIds
      .filter((buildId) => !keep.has(buildId))
      .map((buildId) => rm(tuiReleaseDirForBuildId(base, buildId), { recursive: true, force: true }))
  )
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}

/** Best-effort fsync of a directory so a completed rename is durable (POSIX only). */
export async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (error) {
    if (
      isErrno(error, 'EINVAL') ||
      isErrno(error, 'ENOTSUP') ||
      isErrno(error, 'EISDIR') ||
      isErrno(error, 'EPERM') ||
      isErrno(error, 'EACCES') ||
      isErrno(error, 'EBADF') ||
      isErrno(error, 'ENOENT')
    ) {
      return
    }
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const POSIX_POINTER_LAUNCHER = [
  '#!/bin/sh',
  'set -eu',
  'self_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd -P)',
  'root=$(CDPATH= cd -P "$self_dir/.." && pwd -P)',
  'export KUN_STANDALONE_ROOT="$root"',
  '',
  'release=""',
  'if [ -f "$root/current" ]; then',
  '  candidate=$(tr -d \'[:space:]\' < "$root/current")',
  '  [ -f "$root/$candidate/release.json" ] && release="$candidate"',
  'fi',
  'if [ -z "$release" ]; then',
  '  for release_json in "$root"/releases/*/release.json; do',
  '    [ -f "$release_json" ] || continue',
  '    dir=$(CDPATH= cd -P "$(dirname "$release_json")" && pwd -P)',
  '    release="releases/${dir##*/}"',
  '    break',
  '  done',
  'fi',
  'if [ -z "$release" ]; then',
  '  echo "kun: no usable release found under $root" >&2',
  '  exit 1',
  'fi',
  'exec "$root/$release/runtime/node" "$root/$release/app/kun/dist/cli/serve-entry.js" "$@"',
  ''
].join('\n')

const WINDOWS_POINTER_LAUNCHER = [
  '@echo off',
  'setlocal',
  'set "KUN_STANDALONE_ROOT=%~dp0.."',
  'set "RELEASE="',
  'if exist "%~dp0..\\current" set /p RELEASE=<"%~dp0..\\current"',
  'if not defined RELEASE goto fallback',
  'if exist "%~dp0..\\%RELEASE%\\release.json" goto run',
  ':fallback',
  'set "RELEASE="',
  'for /d %%D in ("%~dp0..\\releases\\*") do if exist "%%D\\release.json" set "RELEASE=releases\\%%~nxD"',
  ':run',
  'if not defined RELEASE (echo kun: no usable release found under "%~dp0.." 1>&2 & exit /b 1)',
  '"%~dp0..\\%RELEASE%\\runtime\\node.exe" "%~dp0..\\%RELEASE%\\app\\kun\\dist\\cli\\serve-entry.js" %*',
  ''
].join('\r\n')

/**
 * The stable pointer-following launcher used for both packaged archives and
 * legacy-layout migration. It lives under `bin/` (never moved by an update),
 * reads the `current` pointer, and execs that immutable release directory.
 * When the pointer is missing or damaged it falls back to any complete release
 * directory; the authoritative highest-semver selection happens in the TS
 * resolver (discoverBestReleaseDir) once the runtime has started.
 */
export function pointerLauncherScript(platform: NodeJS.Platform): string {
  return platform === 'win32' ? WINDOWS_POINTER_LAUNCHER : POSIX_POINTER_LAUNCHER
}
