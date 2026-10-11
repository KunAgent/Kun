import { createHmac, randomBytes } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { parseDocument } from 'yaml'

const MAX_BYTES = 64 * 1024
const fingerprintSalt = randomBytes(32)

export function deepSeekHarnessHome(env: Record<string, string | undefined> = process.env): string {
  const value = Object.fromEntries(Object.entries(env).map(([key, entry]) => [key.toUpperCase(), entry])).DSH_HOME?.trim()
  const home = !value ? join(homedir(), '.dsh') : value === '~' ? homedir()
    : /^~[/\\]/.test(value) ? join(homedir(), value.slice(2)) : value
  return resolve(home)
}

/** Known bounded local files only; never follow symlinks or read special files. */
function boundedFile(path: string): string | undefined {
  let fd: number | undefined
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return undefined
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.size > MAX_BYTES) return undefined
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return read <= MAX_BYTES ? buffer.subarray(0, read).toString('utf8') : undefined
  } catch { return undefined } finally { if (fd !== undefined) closeSync(fd) }
}

/** Resolve only the native home key, never a workspace .env; no live auth claim. */
export function resolveDeepSeekHarnessNativeKey(env: Record<string, string | undefined> = process.env): string | undefined {
  const ambient = Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toUpperCase(), value])).DEEPSEEK_API_KEY
  if (ambient?.trim()) return ambient
  const home = deepSeekHarnessHome(env)
  const source = boundedFile(join(home, '.credentials.yaml'))
  if (source !== undefined) {
    try {
      const document = parseDocument(source, { customTags: [] })
      if (document.errors.length || document.warnings.length) return undefined
      const value: unknown = document.toJS({ maxAliasCount: 0 })
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const key = (value as Record<string, unknown>).DEEPSEEK_API_KEY
        if (typeof key === 'string' && key.trim().length > 0) return key
      }
    } catch { return undefined }
  }
  const dotenv = boundedFile(join(home, '.env'))
  if (dotenv === undefined) return undefined
  try {
    const key = parseEnv(dotenv).DEEPSEEK_API_KEY
    return key?.trim() ? key : undefined
  } catch { return undefined }
}

/** Key presence is configured-but-unverified, never authenticated. */
export function hasDeepSeekHarnessNativeKey(env: Record<string, string | undefined> = process.env): boolean {
  return resolveDeepSeekHarnessNativeKey(env) !== undefined
}

/**
 * Bind readiness to native credentials and every accepted composition layer.
 * HMAC prevents a returned fingerprint from becoming an offline secret oracle.
 * Metadata of invalid/unreadable files still invalidates an older proof.
 */
export function deepSeekHarnessProfileFingerprint(env: Record<string, string | undefined> = process.env): string {
  const home = deepSeekHarnessHome(env)
  const digest = createHmac('sha256', fingerprintSalt).update(home)
  const profile = join(home, 'profiles', 'acp')
  // First startup creates these directories and stock files. Those known
  // defaults are equivalent to absence; runtime cache/session writes must not
  // invalidate an otherwise unchanged profile on every launch.
  for (const path of [home, join(home, 'profiles'), profile]) {
    try { digest.update(lstatSync(path).isDirectory() ? 'directory' : 'unsafe-directory') }
    catch { digest.update('directory') }
  }
  try { digest.update(JSON.stringify(lstatSync(join(profile, 'node_modules')))) }
  catch { digest.update('no-local-modules') }
  const stockManifest = { name: 'dsh-profile-acp', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] } } }
  const manifest = boundedFile(join(profile, 'package.json'))
  try { digest.update(JSON.stringify(manifest === undefined ? stockManifest : JSON.parse(manifest))) }
  catch { digest.update(manifest ?? 'unreadable-manifest') }
  for (const path of [join(home, 'cordis.patch.yml'), join(profile, 'cordis.patch.yml')]) {
    const source = boundedFile(path)
    const empty = source?.split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim()).filter(Boolean).join('')
    digest.update(empty === undefined || empty === '' || empty === '[]' ? 'empty-patch' : source!)
  }
  const workspace = boundedFile(join(profile, 'pnpm-workspace.yaml'))
  digest.update(workspace?.replace(/\s/g, '') ?? 'packages:-.nodeLinker:hoistedautoInstallPeers:false')
  for (const path of [join(home, '.credentials.yaml'), join(home, '.env')]) {
    digest.update(path)
    try {
      const stat = lstatSync(path)
      digest.update(JSON.stringify([stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs]))
      const contents = boundedFile(path)
      if (contents !== undefined) digest.update(contents)
    } catch { digest.update('missing-or-unreadable') }
  }
  // Unreadable/symlinked configuration is rejected at preflight, and its
  // metadata must revoke an older proof even when boundedFile returned none.
  for (const path of [join(profile, 'package.json'), join(home, 'cordis.patch.yml'), join(profile, 'cordis.patch.yml')]) {
    try {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) digest.update(JSON.stringify(stat))
    } catch { /* Missing means the reviewed empty/default layer. */ }
  }
  for (const [key, value] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) {
    if (/^(DSH_|DEEPSEEK_|NODE_OPTIONS$)/i.test(key)) digest.update(JSON.stringify([key, value]))
  }
  return digest.digest('hex')
}
