import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { execFile } from 'node:child_process'
import { accessSync, constants, readdirSync } from 'node:fs'
import { access, copyFile, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const CHROMIUM_COOKIE_SALT = Buffer.from('saltysalt')
const CHROMIUM_COOKIE_IV = Buffer.alloc(16, 0x20)
/** Allow time for the macOS Keychain Allow dialog on first access. */
const KEYCHAIN_TIMEOUT_MS = 30_000

export type ChromiumCookieRow = {
  name: string
  value: string
  hostKey: string
}

export type ChromiumSafeStorageLabel = {
  service: string
  account: string
}

export type ChromiumBrowserCookieSource = {
  id: string
  displayName: string
  /** Application Support-relative profile root on macOS / Linux config root. */
  profileRootSegments: string[]
  /** Windows Local AppData-relative profile root. */
  windowsProfileRootSegments?: string[]
  /** Linux ~/.config-relative profile root segments. */
  linuxProfileRootSegments?: string[]
  safeStorageLabels: ChromiumSafeStorageLabel[]
}

/**
 * Chromium browsers CodexBar / SweetCookieKit can import from for OpenCode Go.
 * Keep Comet and Dia here — they are real session hosts for opencode.ai.
 * Beta/Canary/Nightly variants match CodexBar's broader Chromium coverage.
 */
export const OPENCODE_GO_CHROMIUM_BROWSERS: ChromiumBrowserCookieSource[] = [
  {
    id: 'chrome',
    displayName: 'Chrome',
    profileRootSegments: ['Google', 'Chrome'],
    windowsProfileRootSegments: ['Google', 'Chrome', 'User Data'],
    linuxProfileRootSegments: ['google-chrome'],
    safeStorageLabels: [{ service: 'Chrome Safe Storage', account: 'Chrome' }]
  },
  {
    id: 'chrome-beta',
    displayName: 'Chrome Beta',
    profileRootSegments: ['Google', 'Chrome Beta'],
    windowsProfileRootSegments: ['Google', 'Chrome Beta', 'User Data'],
    linuxProfileRootSegments: ['google-chrome-beta'],
    safeStorageLabels: [
      { service: 'Chrome Safe Storage', account: 'Chrome' },
      { service: 'Chrome Beta Safe Storage', account: 'Chrome Beta' }
    ]
  },
  {
    id: 'chrome-canary',
    displayName: 'Chrome Canary',
    profileRootSegments: ['Google', 'Chrome Canary'],
    windowsProfileRootSegments: ['Google', 'Chrome SxS', 'User Data'],
    linuxProfileRootSegments: ['google-chrome-unstable'],
    safeStorageLabels: [
      { service: 'Chrome Safe Storage', account: 'Chrome' },
      { service: 'Chrome Canary Safe Storage', account: 'Chrome Canary' }
    ]
  },
  {
    id: 'edge',
    displayName: 'Microsoft Edge',
    profileRootSegments: ['Microsoft Edge'],
    windowsProfileRootSegments: ['Microsoft', 'Edge', 'User Data'],
    linuxProfileRootSegments: ['microsoft-edge'],
    safeStorageLabels: [
      { service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' }
    ]
  },
  {
    id: 'edge-beta',
    displayName: 'Microsoft Edge Beta',
    profileRootSegments: ['Microsoft Edge Beta'],
    windowsProfileRootSegments: ['Microsoft', 'Edge Beta', 'User Data'],
    linuxProfileRootSegments: ['microsoft-edge-beta'],
    safeStorageLabels: [
      { service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' },
      { service: 'Microsoft Edge Beta Safe Storage', account: 'Microsoft Edge Beta' }
    ]
  },
  {
    id: 'edge-canary',
    displayName: 'Microsoft Edge Canary',
    profileRootSegments: ['Microsoft Edge Canary'],
    windowsProfileRootSegments: ['Microsoft', 'Edge SxS', 'User Data'],
    linuxProfileRootSegments: ['microsoft-edge-dev'],
    safeStorageLabels: [
      { service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' },
      { service: 'Microsoft Edge Canary Safe Storage', account: 'Microsoft Edge Canary' }
    ]
  },
  {
    id: 'brave',
    displayName: 'Brave',
    profileRootSegments: ['BraveSoftware', 'Brave-Browser'],
    windowsProfileRootSegments: ['BraveSoftware', 'Brave-Browser', 'User Data'],
    linuxProfileRootSegments: ['BraveSoftware', 'Brave-Browser'],
    safeStorageLabels: [{ service: 'Brave Safe Storage', account: 'Brave' }]
  },
  {
    id: 'brave-beta',
    displayName: 'Brave Beta',
    profileRootSegments: ['BraveSoftware', 'Brave-Browser-Beta'],
    windowsProfileRootSegments: ['BraveSoftware', 'Brave-Browser-Beta', 'User Data'],
    linuxProfileRootSegments: ['BraveSoftware', 'Brave-Browser-Beta'],
    safeStorageLabels: [
      { service: 'Brave Safe Storage', account: 'Brave' },
      { service: 'Brave Safe Storage', account: 'Brave Beta' }
    ]
  },
  {
    id: 'brave-nightly',
    displayName: 'Brave Nightly',
    profileRootSegments: ['BraveSoftware', 'Brave-Browser-Nightly'],
    windowsProfileRootSegments: ['BraveSoftware', 'Brave-Browser-Nightly', 'User Data'],
    linuxProfileRootSegments: ['BraveSoftware', 'Brave-Browser-Nightly'],
    safeStorageLabels: [
      { service: 'Brave Safe Storage', account: 'Brave' },
      { service: 'Brave Safe Storage', account: 'Brave Nightly' }
    ]
  },
  {
    id: 'arc',
    displayName: 'Arc',
    profileRootSegments: ['Arc', 'User Data'],
    linuxProfileRootSegments: ['arc'],
    safeStorageLabels: [{ service: 'Arc Safe Storage', account: 'Arc' }]
  },
  {
    id: 'dia',
    displayName: 'Dia',
    profileRootSegments: ['Dia', 'User Data'],
    safeStorageLabels: [{ service: 'Dia Safe Storage', account: 'Dia' }]
  },
  {
    id: 'comet',
    displayName: 'Comet',
    profileRootSegments: ['Comet'],
    linuxProfileRootSegments: ['comet'],
    safeStorageLabels: [{ service: 'Comet Safe Storage', account: 'Comet' }]
  },
  {
    id: 'vivaldi',
    displayName: 'Vivaldi',
    profileRootSegments: ['Vivaldi'],
    windowsProfileRootSegments: ['Vivaldi', 'User Data'],
    linuxProfileRootSegments: ['vivaldi'],
    safeStorageLabels: [{ service: 'Vivaldi Safe Storage', account: 'Vivaldi' }]
  },
  {
    id: 'chromium',
    displayName: 'Chromium',
    profileRootSegments: ['Chromium'],
    windowsProfileRootSegments: ['Chromium', 'User Data'],
    linuxProfileRootSegments: ['chromium'],
    safeStorageLabels: [{ service: 'Chromium Safe Storage', account: 'Chromium' }]
  }
]

export type ChromiumCookieDatabaseCandidate = {
  browser: ChromiumBrowserCookieSource
  databasePath: string
}

/** Non-sensitive outcome of a Chromium cookie scan (never includes cookie values). */
export type ChromiumCookieReadDiagnosis =
  | {
    kind: 'success'
    browserId: string
    browserDisplayName: string
    databasePath: string
  }
  | {
    kind: 'not_found'
    scannedDatabases: number
    foundAuthRows: boolean
  }
  | {
    kind: 'decrypt_failed'
    browserId: string
    browserDisplayName: string
    databasePath: string
    reason: 'keychain_unavailable' | 'decrypt_failed'
  }

export type ChromiumCookieReadResult = {
  cookies: ChromiumCookieRow[]
  diagnosis: ChromiumCookieReadDiagnosis
}

export type ReadChromiumCookiesForDomainsOptions = {
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  homeDirectory?: string
  browsers?: ChromiumBrowserCookieSource[]
  candidates?: ChromiumCookieDatabaseCandidate[]
  domainSuffixes?: string[]
  cookieNames?: Set<string>
  readSafeStoragePassword?: (
    label: ChromiumSafeStorageLabel
  ) => Promise<string | undefined>
}

/**
 * Reads Chromium cookies for the given domains, decrypting macOS Safe Storage
 * values when needed. Mirrors SweetCookieKit's best-effort Chromium path:
 * copy the locked Cookies DB, decrypt v10 blobs with PBKDF2+AES-CBC, and for
 * cookie DB version >= 24 strip the SHA-256(host_key) prefix.
 */
export async function readChromiumCookiesForDomains(
  options: ReadChromiumCookiesForDomainsOptions = {}
): Promise<ChromiumCookieRow[]> {
  const result = await readChromiumCookiesForDomainsWithDiagnosis(options)
  return result.cookies
}

/**
 * Same as {@link readChromiumCookiesForDomains}, but also returns a
 * non-sensitive diagnosis so callers can distinguish "not signed in" from
 * "signed in but Keychain/decrypt failed".
 */
export async function readChromiumCookiesForDomainsWithDiagnosis(
  options: ReadChromiumCookiesForDomainsOptions = {}
): Promise<ChromiumCookieReadResult> {
  const domainSuffixes = options.domainSuffixes ?? ['opencode.ai', 'app.opencode.ai']
  const cookieNames = options.cookieNames
  const candidates = options.candidates ??
    listChromiumCookieDatabaseCandidates(options)
  const passwordCache = new Map<string, string | undefined>()
  let scannedDatabases = 0
  let foundAuthRows = false
  let decryptFailure: Extract<ChromiumCookieReadDiagnosis, { kind: 'decrypt_failed' }> | undefined

  for (const candidate of candidates) {
    try {
      if (!(await cookieDatabaseExists(candidate.databasePath))) continue
      scannedDatabases += 1
      const rows = await readCookiesFromDatabase(candidate.databasePath, domainSuffixes)
      const matched = rows.filter((row) =>
        cookieNames ? cookieNames.has(row.name.toLowerCase()) : true
      )
      if (matched.length === 0) continue
      foundAuthRows = true

      const plaintext = matched.filter((row) => row.value.trim().length > 0)
      if (plaintext.length > 0) {
        return {
          cookies: plaintext.map((row) => ({
            name: row.name,
            value: row.value,
            hostKey: row.hostKey
          })),
          diagnosis: {
            kind: 'success',
            browserId: candidate.browser.id,
            browserDisplayName: candidate.browser.displayName,
            databasePath: candidate.databasePath
          }
        }
      }

      const encrypted = matched.filter((row) => row.encryptedValue.length > 0)
      if (encrypted.length === 0) continue
      const platform = options.platform ?? process.platform
      if (platform !== 'darwin') {
        decryptFailure = {
          kind: 'decrypt_failed',
          browserId: candidate.browser.id,
          browserDisplayName: candidate.browser.displayName,
          databasePath: candidate.databasePath,
          reason: 'decrypt_failed'
        }
        continue
      }

      const password = await resolveSafeStoragePassword(
        candidate.browser,
        options.readSafeStoragePassword,
        passwordCache
      )
      if (!password) {
        decryptFailure = {
          kind: 'decrypt_failed',
          browserId: candidate.browser.id,
          browserDisplayName: candidate.browser.displayName,
          databasePath: candidate.databasePath,
          reason: 'keychain_unavailable'
        }
        continue
      }
      const key = deriveChromiumSafeStorageKey(password)
      const decrypted: ChromiumCookieRow[] = []
      for (const row of encrypted) {
        const value = decryptChromiumCookieValue(
          row.encryptedValue,
          key,
          row.hostKey,
          row.databaseVersion
        )
        if (!value?.trim()) continue
        decrypted.push({ name: row.name, value, hostKey: row.hostKey })
      }
      if (decrypted.length > 0) {
        return {
          cookies: decrypted,
          diagnosis: {
            kind: 'success',
            browserId: candidate.browser.id,
            browserDisplayName: candidate.browser.displayName,
            databasePath: candidate.databasePath
          }
        }
      }
      decryptFailure = {
        kind: 'decrypt_failed',
        browserId: candidate.browser.id,
        browserDisplayName: candidate.browser.displayName,
        databasePath: candidate.databasePath,
        reason: 'decrypt_failed'
      }
    } catch {
      // Locked DBs and unexpected IO failures are expected; try the next source.
    }
  }

  if (decryptFailure) {
    return { cookies: [], diagnosis: decryptFailure }
  }
  return {
    cookies: [],
    diagnosis: {
      kind: 'not_found',
      scannedDatabases,
      foundAuthRows
    }
  }
}

export function listChromiumCookieDatabaseCandidates(
  options: Omit<
    ReadChromiumCookiesForDomainsOptions,
    'candidates' | 'domainSuffixes' | 'cookieNames' | 'readSafeStoragePassword'
  > = {}
): ChromiumCookieDatabaseCandidate[] {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const userHome = options.homeDirectory ?? homedir()
  const browsers = options.browsers ?? OPENCODE_GO_CHROMIUM_BROWSERS
  const joinPath = platform === 'win32' ? win32.join : posix.join
  const roots: Array<{ browser: ChromiumBrowserCookieSource; root: string }> = []

  for (const browser of browsers) {
    if (platform === 'darwin') {
      roots.push({
        browser,
        root: joinPath(userHome, 'Library', 'Application Support', ...browser.profileRootSegments)
      })
      continue
    }
    if (platform === 'linux') {
      const segments = browser.linuxProfileRootSegments
      if (!segments?.length) continue
      roots.push({
        browser,
        root: joinPath(userHome, '.config', ...segments)
      })
      continue
    }
    if (platform === 'win32') {
      const segments = browser.windowsProfileRootSegments
      if (!segments) continue
      const localAppData = environment.LOCALAPPDATA?.trim()
      const localRoot = localAppData || joinPath(userHome, 'AppData', 'Local')
      roots.push({
        browser,
        root: joinPath(localRoot, ...segments)
      })
    }
  }

  const out: ChromiumCookieDatabaseCandidate[] = []
  for (const { browser, root } of roots) {
    for (const profileName of discoverChromiumProfileNamesSync(root)) {
      const networkPath = joinPath(root, profileName, 'Network', 'Cookies')
      const legacyPath = joinPath(root, profileName, 'Cookies')
      // Prefer listing only paths that exist when the profile root is readable.
      // When the root itself is missing, keep Default candidates for tests that
      // assert path shapes without creating directories.
      if (directoryExistsSync(root)) {
        if (cookieDatabaseExistsSync(networkPath)) {
          out.push({ browser, databasePath: networkPath })
        }
        if (cookieDatabaseExistsSync(legacyPath)) {
          out.push({ browser, databasePath: legacyPath })
        }
        continue
      }
      out.push(
        { browser, databasePath: networkPath },
        { browser, databasePath: legacyPath }
      )
    }
  }
  return out
}

/** Exported for tests: PBKDF2 key derivation used by Chromium Safe Storage. */
export function deriveChromiumSafeStorageKey(password: string): Buffer {
  return pbkdf2Sync(password, CHROMIUM_COOKIE_SALT, 1_003, 16, 'sha1')
}

/** Exported for tests: decrypt a Chromium v10 cookie blob. */
export function decryptChromiumCookieValue(
  encryptedValue: Buffer,
  key: Buffer,
  hostKey: string,
  databaseVersion: number
): string | undefined {
  if (encryptedValue.length <= 3) return undefined
  const prefix = encryptedValue.subarray(0, 3).toString('utf8')
  if (prefix !== 'v10') return undefined
  const payload = encryptedValue.subarray(3)
  if (payload.length === 0 || payload.length % 16 !== 0) return undefined
  let decrypted: Buffer
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, CHROMIUM_COOKIE_IV)
    decrypted = Buffer.concat([decipher.update(payload), decipher.final()])
  } catch {
    return undefined
  }
  let value = decrypted
  if (databaseVersion >= 24) {
    const expectedDomainHash = createHash('sha256').update(hostKey, 'utf8').digest()
    if (
      value.length < expectedDomainHash.length ||
      !value.subarray(0, expectedDomainHash.length).equals(expectedDomainHash)
    ) {
      return undefined
    }
    value = value.subarray(expectedDomainHash.length)
  }
  const text = value.toString('utf8')
  return text.length > 0 ? text : undefined
}

type RawCookieRow = {
  name: string
  value: string
  hostKey: string
  encryptedValue: Buffer
  databaseVersion: number
}

async function cookieDatabaseExists(databasePath: string): Promise<boolean> {
  try {
    await access(databasePath)
    return true
  } catch {
    return false
  }
}

function cookieDatabaseExistsSync(databasePath: string): boolean {
  try {
    accessSync(databasePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function directoryExistsSync(directoryPath: string): boolean {
  try {
    accessSync(directoryPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readCookiesFromDatabase(
  databasePath: string,
  domainSuffixes: string[]
): Promise<RawCookieRow[]> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'kun-chromium-cookies-'))
  const copiedDb = join(tempRoot, 'Cookies')
  try {
    await copyFile(databasePath, copiedDb)
    await Promise.allSettled([
      copyFile(`${databasePath}-wal`, `${copiedDb}-wal`),
      copyFile(`${databasePath}-shm`, `${copiedDb}-shm`)
    ])

    let sqliteModule: { default: typeof import('better-sqlite3') }
    try {
      sqliteModule = await import('better-sqlite3')
    } catch {
      return await readCookiesFromDatabaseWithSqliteCli(copiedDb, domainSuffixes)
    }

    let database: import('better-sqlite3').Database
    try {
      database = new sqliteModule.default(copiedDb, {
        readonly: true,
        fileMustExist: true
      })
    } catch {
      // Native module ABI mismatches (system Node vs Electron) fall back to sqlite3 CLI.
      return await readCookiesFromDatabaseWithSqliteCli(copiedDb, domainSuffixes)
    }
    try {
      database.pragma('query_only = ON')
      database.pragma('busy_timeout = 250')
      const versionRow = database.prepare(
        "SELECT value FROM meta WHERE key = 'version' LIMIT 1"
      ).get() as { value?: string | number } | undefined
      const databaseVersion = Number(versionRow?.value ?? 0)
      const where = domainSuffixes
        .map(() => 'host_key LIKE ?')
        .join(' OR ')
      const params = domainSuffixes.map((suffix) => `%${suffix}`)
      const rows = database.prepare(`
        SELECT host_key AS hostKey, name, value, encrypted_value AS encryptedValue
        FROM cookies
        WHERE ${where}
      `).all(...params) as Array<{
        hostKey?: unknown
        name?: unknown
        value?: unknown
        encryptedValue?: unknown
      }>
      return rows.flatMap((row) => {
        const hostKey = typeof row.hostKey === 'string' ? row.hostKey : ''
        const name = typeof row.name === 'string' ? row.name : ''
        if (!hostKey || !name) return []
        const value = typeof row.value === 'string' ? row.value : ''
        const encryptedValue = Buffer.isBuffer(row.encryptedValue)
          ? row.encryptedValue
          : row.encryptedValue instanceof Uint8Array
            ? Buffer.from(row.encryptedValue)
            : Buffer.alloc(0)
        return [{ name, value, hostKey, encryptedValue, databaseVersion }]
      })
    } finally {
      database.close()
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function readCookiesFromDatabaseWithSqliteCli(
  databasePath: string,
  domainSuffixes: string[]
): Promise<RawCookieRow[]> {
  const binary = process.platform === 'darwin' ? '/usr/bin/sqlite3' : 'sqlite3'
  const where = domainSuffixes
    .map((suffix) => `host_key LIKE '%${suffix.replaceAll("'", "''")}%'`)
    .join(' OR ')
  const versionResult = await execFileAsync(binary, [
    databasePath,
    "SELECT value FROM meta WHERE key='version' LIMIT 1;"
  ], {
    encoding: 'utf8',
    timeout: 2_000,
    maxBuffer: 64 * 1024
  }).catch(() => ({ stdout: '0' }))
  const databaseVersion = Number(versionResult.stdout.trim() || 0)
  const { stdout } = await execFileAsync(binary, [
    '-separator',
    '\t',
    databasePath,
    `SELECT host_key, name, value, hex(encrypted_value) FROM cookies WHERE ${where};`
  ], {
    encoding: 'utf8',
    timeout: 2_000,
    maxBuffer: 512 * 1024
  })
  return stdout
    .split('\n')
    .flatMap((line) => {
      if (!line.trim()) return []
      const [hostKey, name, value, encryptedHex = ''] = line.split('\t')
      if (!hostKey || !name) return []
      return [{
        hostKey,
        name,
        value: value ?? '',
        encryptedValue: encryptedHex
          ? Buffer.from(encryptedHex, 'hex')
          : Buffer.alloc(0),
        databaseVersion
      }]
    })
}

async function resolveSafeStoragePassword(
  browser: ChromiumBrowserCookieSource,
  override: ((label: ChromiumSafeStorageLabel) => Promise<string | undefined>) | undefined,
  passwordCache: Map<string, string | undefined>
): Promise<string | undefined> {
  for (const label of browser.safeStorageLabels) {
    const cacheKey = `${label.service}\0${label.account}`
    if (passwordCache.has(cacheKey)) {
      const cached = passwordCache.get(cacheKey)
      if (cached?.trim()) return cached.trim()
      continue
    }
    const password = override
      ? await override(label)
      : await readMacosSafeStoragePassword(label)
    const trimmed = password?.trim() || undefined
    passwordCache.set(cacheKey, trimmed)
    if (trimmed) return trimmed
  }
  return undefined
}

async function readMacosSafeStoragePassword(
  label: ChromiumSafeStorageLabel
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-w',
      '-s',
      label.service,
      '-a',
      label.account
    ], {
      encoding: 'utf8',
      timeout: KEYCHAIN_TIMEOUT_MS,
      maxBuffer: 64 * 1024
    })
    const password = stdout.trim()
    return password || undefined
  } catch {
    return undefined
  }
}

function discoverChromiumProfileNamesSync(root: string): string[] {
  // Synchronous discovery keeps path listing pure for tests; IO failures just
  // fall back to the Default profile, which matches the previous OpenCode Go behavior.
  try {
    const entries = readdirSync(root, { withFileTypes: true })
    const names = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) =>
        name === 'Default' ||
        name.startsWith('Profile ') ||
        name.startsWith('user-')
      )
      .sort((left, right) => left.localeCompare(right))
    return names.length > 0 ? names : ['Default']
  } catch {
    return ['Default']
  }
}
