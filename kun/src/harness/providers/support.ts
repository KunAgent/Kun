import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ServeProviderConfig } from '../../config/kun-config-application.js'
import type { ProviderEnv } from './provider-module.js'

/**
 * Leaf helpers shared by provider modules. They must not import the provider
 * registry or any pipeline stage, so modules stay free of import cycles.
 */

export function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function homeOf(env: ProviderEnv): string {
  return env.HOME || env.USERPROFILE || homedir()
}

/** Bounded, read-only credential read; symlinks, oversize and errors read as empty. */
export function readBoundedFile(path: string): string {
  let fd: number | undefined
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return 'unreadable'
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.size > 64 * 1024) return 'unreadable'
    const buffer = Buffer.alloc(64 * 1024 + 1)
    const count = readSync(fd, buffer, 0, buffer.length, 0)
    return count <= 64 * 1024 ? buffer.subarray(0, count).toString('utf8') : 'unreadable'
  } catch { return '' } finally { if (fd !== undefined) closeSync(fd) }
}

export function readJsonObject(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readBoundedFile(path))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

/** Async JSON object read for login probes; malformed or missing reads as undefined. */
export async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined
  } catch { return undefined }
}

/** A provider profile of `kind` with a credential source makes login state unknown, not signed out. */
export function probeProviderCredential(
  providers: Record<string, Pick<ServeProviderConfig, 'kind' | 'credentialSourceId' | 'apiKey'> | undefined>,
  kind: ServeProviderConfig['kind']
): 'unknown' | 'signed-out' {
  const hasCredential = Object.values(providers).some(
    (provider) => provider !== undefined && provider.kind === kind &&
      (nonempty(provider.credentialSourceId) || nonempty(provider.apiKey))
  )
  return hasCredential ? 'unknown' : 'signed-out'
}

/**
 * OpenCode-family and Pi `auth.json`: an API key or a complete OAuth record is
 * configured evidence. Both engines own refresh and authentication, so this
 * is never verified login. `anySecret` also accepts records that carry a
 * `key`, `token` or `access` string (CodeMaker's own account records).
 */
export function authJsonConfigured(paths: readonly string[], options: { anySecret?: boolean } = {}): boolean {
  return paths.some((path) => Object.values(readJsonObject(path)).some((value) => {
    if (!value || typeof value !== 'object') return false
    const entry = value as Record<string, unknown>
    if (['api', 'api_key'].includes(String(entry.type))) return nonempty(entry.key)
    if (options.anySecret && ['key', 'token', 'access'].some((field) => nonempty(entry[field]))) return true
    return entry.type === 'oauth' && nonempty(entry.access) && nonempty(entry.refresh) &&
      typeof entry.expires === 'number' && Number.isFinite(entry.expires) && entry.expires > 0
  }))
}

/** OpenCode config files; forks keep the names and OPENCODE_* overrides under their own app dir. */
export function openCodeConfigFiles(env: ProviderEnv, home: string, app: string): string[] {
  const dir = env.OPENCODE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home, '.config'), app)
  return [env.OPENCODE_CONFIG || join(dir, 'opencode.json'), join(dir, 'opencode.jsonc')]
}

export function xdgDataHome(env: ProviderEnv, home: string): string {
  return env.XDG_DATA_HOME || join(home, '.local/share')
}
