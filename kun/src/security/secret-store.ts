/**
 * Secret encryption at rest (review fix: OAuth tokens must not be plaintext).
 *
 * Provides a symmetric encryptor (AES-256-GCM) whose key is sourced, in order
 * of preference, from the OS keychain (macOS `security`, Windows DPAPI via
 * PowerShell, Linux `secret-tool`) and otherwise from a per-user key file with
 * 0600 permissions. The key-file fallback is a documented, secure-enough
 * degradation: the bearer tokens are still encrypted at rest (not stored in
 * cleartext JSON), and the key file is owner-only. The command runner and
 * platform are injectable so the whole thing is unit-testable without a real
 * keychain.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { chmod, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  assertManagerAtomicJsonPath,
  AtomicJsonFile,
  isManagerAtomicJsonPath
} from '../extensions/atomic-json.js'
import {
  createAesEncryptor,
  createCompatibleEncryptor,
  isEncryptedEnvelope,
  type SecretEncryptor
} from './secret-encryptor.js'

export { createAesEncryptor, isEncryptedEnvelope } from './secret-encryptor.js'
export type { SecretEncryptor } from './secret-encryptor.js'

/**
 * Reports whether a Kun data directory contains credentials that require the
 * shared secret key. Unknown or unreadable credential state is treated as
 * encrypted so callers fail closed rather than replace an inaccessible key.
 */
export async function hasPersistedSecretKeyMaterial(dataDir: string): Promise<boolean> {
  return await hasEncryptedExtensionCredentials(dataDir) || await hasEncryptedMcpOAuthState(dataDir)
}

async function hasEncryptedExtensionCredentials(dataDir: string): Promise<boolean> {
  const credentialsPath = join(dataDir, 'credentials', 'credentials.enc.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(credentialsPath, 'utf8'))
  } catch (error) {
    return !isMissingFileError(error)
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.profileId !== 'string' || !isRecord(parsed.credentials)) {
    return true
  }
  return Object.keys(parsed.credentials).length > 0
}

async function hasEncryptedMcpOAuthState(dataDir: string): Promise<boolean> {
  const oauthDirectory = join(dataDir, 'mcp-oauth')
  let entries: Dirent<string>[]
  try {
    entries = await readdir(oauthDirectory, { withFileTypes: true })
  } catch (error) {
    return !isMissingFileError(error)
  }
  for (const entry of entries) {
    // OAuth state is stored as individual JSON files. Unknown entries are
    // unsafe because they could be a future encrypted storage format.
    if (!entry.isFile() || !entry.name.endsWith('.json')) return true
    try {
      const parsed = JSON.parse(await readFile(join(oauthDirectory, entry.name), 'utf8'))
      if (containsEncryptedEnvelope(parsed)) return true
    } catch {
      return true
    }
  }
  return false
}

function containsEncryptedEnvelope(value: unknown): boolean {
  if (typeof value === 'string') return isEncryptedEnvelope(value)
  if (Array.isArray(value)) return value.some(containsEncryptedEnvelope)
  return isRecord(value) && Object.values(value).some(containsEncryptedEnvelope)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

export type CommandResult = { code: number; stdout: string; stderr: string }
export type CommandRunner = (command: string, args: string[], input?: string) => Promise<CommandResult>

/**
 * Default command runner (spawn, shell:false) used in production so the OS
 * keychain / Windows DPAPI path actually runs. Supports feeding `input` over
 * stdin so secret material never appears in argv (visible in process listings).
 */
export const defaultSecretCommandRunner: CommandRunner = (command, args, input) =>
  new Promise((resolve) => {
    const maxOutputBytes = 64 * 1024
    let settled = false
    const finish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { shell: false })
    } catch {
      resolve({ code: -1, stdout: '', stderr: 'spawn failed' })
      return
    }
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: Buffer): string =>
      Buffer.concat([Buffer.from(current, 'utf8'), chunk]).subarray(0, maxOutputBytes).toString('utf8')
    child.stdout?.on('data', (d: Buffer) => { stdout = append(stdout, d) })
    child.stderr?.on('data', (d: Buffer) => { stderr = append(stderr, d) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ code: -1, stdout, stderr: 'credential helper timed out' })
    }, 10_000)
    timer.unref()
    child.on('error', () => finish({ code: -1, stdout: '', stderr: 'spawn error' }))
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr }))
    if (input !== undefined) {
      child.stdin?.end(input)
    } else {
      child.stdin?.end()
    }
  })

export type KeyProviderResult = {
  encryptor: SecretEncryptor
  /** True when the key is protected by the OS keychain (vs the 0600 key file). */
  osKeychain: boolean
  /** Human-readable note about how the key is protected (and any degradation). */
  reason: string
}

const KEYCHAIN_SERVICE = 'kun-secret-key'
const KEYCHAIN_ACCOUNT = 'kun'

type OsKeyLookup =
  | { status: 'found'; key: Buffer }
  | { status: 'missing' }
  | { status: 'unavailable'; reason: string }

async function tryReadOsKey(platform: NodeJS.Platform, run: CommandRunner): Promise<OsKeyLookup> {
  try {
    if (platform === 'darwin') {
      const res = await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'])
      if (res.code === 0 && res.stdout.trim()) {
        const key = Buffer.from(res.stdout.trim(), 'base64')
        return key.length === 32
          ? { status: 'found', key }
          : { status: 'unavailable', reason: 'macOS keychain returned an invalid Kun key' }
      }
      if (res.code === 44 || /(?:could not be found|not found)/i.test(res.stderr)) {
        return { status: 'missing' }
      }
      return { status: 'unavailable', reason: 'macOS keychain lookup failed' }
    } else if (platform === 'linux') {
      const res = await run('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE, 'account', KEYCHAIN_ACCOUNT])
      if (res.code === 0 && res.stdout.trim()) {
        const key = Buffer.from(res.stdout.trim(), 'base64')
        return key.length === 32
          ? { status: 'found', key }
          : { status: 'unavailable', reason: 'Linux secret service returned an invalid Kun key' }
      }
      if (res.code === 1 && !res.stderr.trim()) return { status: 'missing' }
      return { status: 'unavailable', reason: 'Linux secret service lookup failed' }
    }
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `OS credential helper failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  return { status: 'missing' }
}

async function tryWriteOsKey(platform: NodeJS.Platform, run: CommandRunner, key: Buffer): Promise<boolean> {
  const b64 = key.toString('base64')
  try {
    if (platform === 'darwin') {
      // The caller only writes after a confirmed-missing lookup. Do not use
      // `-U`: another data directory or process may win the lookup/write race,
      // and replacing its key would invalidate every credential it protects.
      const res = await run('security', ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', b64])
      return res.code === 0
    }
    if (platform === 'linux') {
      const res = await run('secret-tool', ['store', '--label=kun secret key', 'service', KEYCHAIN_SERVICE, 'account', KEYCHAIN_ACCOUNT], b64)
      return res.code === 0
    }
  } catch {
    return false
  }
  return false
}

/** Marker for a DPAPI-wrapped key file (Windows). */
export const WINDOWS_DPAPI_KEY_PREFIX = 'dpapi:v1:'
export const UNREADABLE_CREDENTIAL_KEY_ERROR_CODE = 'credential_key_unreadable'

export class UnreadableCredentialKeyError extends Error {
  readonly code = UNREADABLE_CREDENTIAL_KEY_ERROR_CODE

  constructor() {
    super(
      `${UNREADABLE_CREDENTIAL_KEY_ERROR_CODE}: existing DPAPI-protected OAuth key could not be decrypted; refusing to replace it`
    )
    this.name = 'UnreadableCredentialKeyError'
  }
}

export function isUnreadableCredentialKeyError(error: unknown): error is UnreadableCredentialKeyError {
  return error instanceof UnreadableCredentialKeyError || (
    error instanceof Error && error.message.includes(UNREADABLE_CREDENTIAL_KEY_ERROR_CODE)
  )
}

/**
 * Windows DPAPI key wrapping. The 32-byte AES key is encrypted with the current
 * user's DPAPI master key (CurrentUser scope) and the protected blob is what we
 * persist — so even the key file cannot be decrypted by another user or off the
 * machine. Secret material is fed over stdin, never argv. PowerShell is invoked
 * via the injectable runner so this stays unit-testable.
 */
const DPAPI_PROTECT_SCRIPT =
  "Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd().Trim(); " +
  "$b=[Convert]::FromBase64String($in); " +
  "$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
  "[Console]::Out.Write([Convert]::ToBase64String($p))"
const DPAPI_UNPROTECT_SCRIPT =
  "Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd().Trim(); " +
  "$b=[Convert]::FromBase64String($in); " +
  "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
  "[Console]::Out.Write([Convert]::ToBase64String($p))"

async function dpapiProtect(run: CommandRunner, key: Buffer): Promise<string | null> {
  try {
    const res = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_PROTECT_SCRIPT], key.toString('base64'))
    if (res.code === 0 && res.stdout.trim()) return res.stdout.trim()
  } catch {
    // PowerShell missing / blocked → caller falls back to a plain key file.
  }
  return null
}

async function dpapiUnprotect(run: CommandRunner, protectedBlobB64: string): Promise<Buffer | null> {
  try {
    const res = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_UNPROTECT_SCRIPT], protectedBlobB64)
    if (res.code === 0 && res.stdout.trim()) {
      const key = Buffer.from(res.stdout.trim(), 'base64')
      return key.length === 32 ? key : null
    }
  } catch {
    // unwrap failed → caller treats the key as unavailable
  }
  return null
}

/** Read + DPAPI-unwrap a Windows key file; null when absent/unreadable/unwrappable. */
async function readDpapiKeyFile(path: string, run: CommandRunner): Promise<Buffer | null> {
  let content: string
  try {
    content = (await readFile(path, 'utf8')).trim()
  } catch {
    return null
  }
  if (!content.startsWith(WINDOWS_DPAPI_KEY_PREFIX)) return null
  return dpapiUnprotect(run, content.slice(WINDOWS_DPAPI_KEY_PREFIX.length))
}

async function readKeyFile(path: string): Promise<Buffer | null> {
  try {
    const b64 = (await readFile(path, 'utf8')).trim()
    const key = Buffer.from(b64, 'base64')
    return key.length === 32 ? key : null
  } catch {
    return null
  }
}

/**
 * Installs a brand-new key without replacing a winner created by another
 * process. The Manager lease normally serializes GUI/Runtime bootstrap, while
 * this exclusive create keeps standalone CLI callers convergent as well.
 */
async function writeNewKeyFile(path: string, key: Buffer): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'wx', 0o600)
    await handle.writeFile(key.toString('base64'), 'utf8')
    await handle.sync()
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return false
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
    await chmod(path, 0o600).catch(() => undefined)
  }
}

/** Write arbitrary key-file content (raw key base64, or a DPAPI envelope) with 0600. */
async function writeKeyFileContent(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporaryPath, content, { mode: 0o600 })
    await chmod(temporaryPath, 0o600).catch(() => undefined)
    await rename(temporaryPath, path)
    await chmod(path, 0o600).catch(() => undefined)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function createKeyFileFallback(
  keyFilePath: string,
  existingKey: Buffer | null,
  reason: string
): Promise<KeyProviderResult> {
  if (existingKey) {
    return {
      encryptor: createAesEncryptor(existingKey),
      osKeychain: false,
      reason: `${reason}; key loaded from 0600 key file (tokens still encrypted at rest)`
    }
  }
  const fileKey = randomBytes(32)
  const created = await writeNewKeyFile(keyFilePath, fileKey)
  const authoritativeKey = created ? fileKey : await readKeyFile(keyFilePath)
  if (!authoritativeKey) {
    throw new Error('credential master key was concurrently created with invalid contents')
  }
  return {
    encryptor: createAesEncryptor(authoritativeKey),
    osKeychain: false,
    reason: created
      ? `${reason}; created a new 0600 key file (tokens still encrypted at rest)`
      : `${reason}; key loaded from concurrently created 0600 key file (tokens still encrypted at rest)`
  }
}

export type CreateKeyProviderOptions = {
  /** Path to the fallback key file (used when the OS keychain is unavailable). */
  keyFilePath: string
  platform?: NodeJS.Platform
  run?: CommandRunner
  /** Disable OS credential-store usage (force the key-file fallback). */
  disableOsKeychain?: boolean
  /** Injectable environment used to resolve the non-interactive automation override. */
  environment?: NodeJS.ProcessEnv
  /**
   * Confirms that a new local fallback key is safe after an OS credential-store
   * lookup failure. Omit to preserve the default fail-closed behavior.
   */
  canBootstrapKeyFileFallback?: () => boolean | Promise<boolean>
}

export const DISABLE_OS_CREDENTIAL_STORE_ENV = 'KUN_DISABLE_OS_CREDENTIAL_STORE'

type SecretKeyBootstrapLease = {
  schemaVersion: 1
  ownerId: string | null
  leaseExpiresAtMs: number
}

const SECRET_KEY_BOOTSTRAP_LEASE_MS = 30_000
const SECRET_KEY_BOOTSTRAP_HEARTBEAT_MS = 5_000
const SECRET_KEY_BOOTSTRAP_WAIT_MS = 90_000

function emptySecretKeyBootstrapLease(): SecretKeyBootstrapLease {
  return { schemaVersion: 1, ownerId: null, leaseExpiresAtMs: 0 }
}

function validateSecretKeyBootstrapLease(value: unknown): SecretKeyBootstrapLease {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('credential key bootstrap lease is invalid')
  }
  const raw = value as Record<string, unknown>
  if (
    raw.schemaVersion !== 1 ||
    (raw.ownerId !== null && typeof raw.ownerId !== 'string') ||
    typeof raw.leaseExpiresAtMs !== 'number' ||
    !Number.isFinite(raw.leaseExpiresAtMs) ||
    raw.leaseExpiresAtMs < 0
  ) {
    throw new Error('credential key bootstrap lease is invalid')
  }
  return {
    schemaVersion: 1,
    ownerId: raw.ownerId as string | null,
    leaseExpiresAtMs: raw.leaseExpiresAtMs
  }
}

function leaseOwnerIsDefinitelyDead(ownerId: string): boolean {
  const separator = ownerId.indexOf(':')
  const ownerPid = Number(ownerId.slice(0, separator))
  if (separator <= 0 || !Number.isInteger(ownerPid) || ownerPid <= 0) return false
  try {
    process.kill(ownerPid, 0)
    return false
  } catch (error) {
    // EPERM means a process exists but cannot be signalled. Unknown platform
    // errors are equally insufficient proof for a destructive takeover.
    return (error as NodeJS.ErrnoException)?.code === 'ESRCH'
  }
}

function assertExpiredLeaseOwnerCanBeReclaimed(lease: SecretKeyBootstrapLease): void {
  if (lease.ownerId && !leaseOwnerIsDefinitelyDead(lease.ownerId)) {
    throw new Error(
      'credential key bootstrap lease expired while its owner process is still alive'
    )
  }
}

/**
 * Serializes first-use key resolution through the Service Manager. The lease
 * intentionally contains no key material: the OS credential store or the
 * owner-only key file remains the sole key authority, while Manager CAS elects
 * exactly one process to perform lookup/migration/bootstrap at a time.
 */
async function withManagerSecretKeyBootstrapLease<T>(
  keyFilePath: string,
  action: () => Promise<T>
): Promise<T> {
  const leasePath = `${keyFilePath}.bootstrap-lease.v1.json`
  assertManagerAtomicJsonPath(leasePath)
  if (!isManagerAtomicJsonPath(leasePath)) return action()

  const leaseFile = new AtomicJsonFile(leasePath, validateSecretKeyBootstrapLease)
  const ownerId = `${process.pid}:${randomUUID()}`
  const waitDeadline = Date.now() + SECRET_KEY_BOOTSTRAP_WAIT_MS
  let acquired = false

  while (!acquired) {
    const now = Date.now()
    const observed = await leaseFile.read(emptySecretKeyBootstrapLease)
    if (observed.ownerId && observed.leaseExpiresAtMs > now) {
      if (now >= waitDeadline) {
        throw new Error('timed out waiting for credential key bootstrap lease')
      }
      await delay(Math.min(250, Math.max(10, observed.leaseExpiresAtMs - now)))
      continue
    }
    assertExpiredLeaseOwnerCanBeReclaimed(observed)
    const claimed = await leaseFile.update(emptySecretKeyBootstrapLease, (current) => {
      const mutationNow = Date.now()
      if (current.ownerId && current.leaseExpiresAtMs > mutationNow) return current
      assertExpiredLeaseOwnerCanBeReclaimed(current)
      return {
        schemaVersion: 1,
        ownerId,
        leaseExpiresAtMs: mutationNow + SECRET_KEY_BOOTSTRAP_LEASE_MS
      }
    })
    acquired = claimed.ownerId === ownerId
  }

  let heartbeatFailure: unknown
  let heartbeat = Promise.resolve()
  const heartbeatTimer = setInterval(() => {
    heartbeat = heartbeat.then(async () => {
      await leaseFile.update(emptySecretKeyBootstrapLease, (current) => {
        if (current.ownerId !== ownerId) {
          throw new Error('credential key bootstrap lease was lost')
        }
        return {
          ...current,
          leaseExpiresAtMs: Date.now() + SECRET_KEY_BOOTSTRAP_LEASE_MS
        }
      })
    }).catch((error: unknown) => {
      heartbeatFailure ??= error
    })
  }, SECRET_KEY_BOOTSTRAP_HEARTBEAT_MS)
  heartbeatTimer.unref()

  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    const result = await action()
    clearInterval(heartbeatTimer)
    await heartbeat
    if (heartbeatFailure) throw heartbeatFailure
    const current = await leaseFile.read(emptySecretKeyBootstrapLease)
    if (current.ownerId !== ownerId) {
      throw new Error('credential key bootstrap lease was lost')
    }
    outcome = { ok: true, value: result }
  } catch (error) {
    outcome = { ok: false, error }
  }

  clearInterval(heartbeatTimer)
  await heartbeat.catch(() => undefined)
  let releaseError: unknown
  try {
    await leaseFile.update(emptySecretKeyBootstrapLease, (current) =>
      current.ownerId === ownerId ? emptySecretKeyBootstrapLease() : current
    )
  } catch (error) {
    releaseError = error
  }
  if (!outcome.ok) throw outcome.error
  // After a successful action, fail closed until Manager can confirm lease
  // release. A failed action preserves its more useful original error.
  if (releaseError) throw releaseError
  return outcome.value
}

async function canBootstrapKeyFileFallback(options: CreateKeyProviderOptions): Promise<boolean> {
  try {
    return await options.canBootstrapKeyFileFallback?.() === true
  } catch {
    return false
  }
}

/**
 * Resolve a secret encryptor. Tries the OS keychain first (storing a random key
 * there), then falls back to a 0600 key file. Tokens are always encrypted at
 * rest either way.
 */
export async function createSecretEncryptor(options: CreateKeyProviderOptions): Promise<KeyProviderResult> {
  return withManagerSecretKeyBootstrapLease(options.keyFilePath, () =>
    createSecretEncryptorWithoutManagerLease(options)
  )
}

async function createSecretEncryptorWithoutManagerLease(
  options: CreateKeyProviderOptions
): Promise<KeyProviderResult> {
  const platform = options.platform ?? process.platform
  const run = options.run
  const environment = options.environment ?? process.env
  const disableOsCredentialStore = options.disableOsKeychain ??
    environment[DISABLE_OS_CREDENTIAL_STORE_ENV] === '1'
  const useKeychain = !disableOsCredentialStore && run && (platform === 'darwin' || platform === 'linux')
  // A raw key may be the only key capable of decrypting credentials written
  // during a temporary OS-store outage. Resolve the OS key before migrating so
  // an unrelated fallback key can never overwrite an established Keychain or
  // Secret Service generation.
  const legacyFileKey = await readKeyFile(options.keyFilePath)

  if (useKeychain && run) {
    const existing = await tryReadOsKey(platform, run)
    if (legacyFileKey) {
      if (existing.status === 'found') {
        if (existing.key.equals(legacyFileKey)) {
          await rm(options.keyFilePath, { force: true }).catch(() => undefined)
          return {
            encryptor: createAesEncryptor(existing.key),
            osKeychain: true,
            reason: 'matching key-file copy removed after OS keychain verification'
          }
        }
        await chmod(options.keyFilePath, 0o600).catch(() => undefined)
        return {
          encryptor: createCompatibleEncryptor(
            createAesEncryptor(existing.key),
            createAesEncryptor(legacyFileKey)
          ),
          osKeychain: false,
          reason: 'OS keychain and 0600 key file contain different credential generations; preserving both without replacing either key'
        }
      }
      if (existing.status === 'missing' && await tryWriteOsKey(platform, run, legacyFileKey)) {
        await rm(options.keyFilePath, { force: true }).catch(() => undefined)
        return { encryptor: createAesEncryptor(legacyFileKey), osKeychain: true, reason: 'existing key migrated to OS keychain' }
      }
      const reason = existing.status === 'unavailable'
        ? existing.reason
        : 'OS keychain migration failed'
      return {
        encryptor: createAesEncryptor(legacyFileKey),
        osKeychain: false,
        reason: `${reason}; existing 0600 key file preserved`
      }
    }
    if (existing.status === 'found') {
      return { encryptor: createAesEncryptor(existing.key), osKeychain: true, reason: 'key loaded from OS keychain' }
    }
    // A lookup failure is different from a confirmed missing item. Generating
    // a replacement here would make every credential encrypted by the
    // temporarily inaccessible key permanently unreadable. Fail closed and
    // let the caller retry once Keychain/secret-service access is restored.
    if (existing.status === 'unavailable') {
      if (await canBootstrapKeyFileFallback(options)) {
        return createKeyFileFallback(options.keyFilePath, null, existing.reason)
      }
      throw new Error(`${existing.reason}; refusing to replace the existing Kun encryption key`)
    }
    const fresh = randomBytes(32)
    if (await tryWriteOsKey(platform, run, fresh)) {
      return { encryptor: createAesEncryptor(fresh), osKeychain: true, reason: 'new key stored in OS keychain' }
    }
  }

  // Windows: protect the AES key with DPAPI (CurrentUser) and store the wrapped
  // blob in the key file, so the on-disk key cannot be decrypted by another user
  // or off the machine. Falls through to a plain key file if PowerShell/DPAPI is
  // unavailable (tokens are still AES-encrypted at rest either way).
  if (!disableOsCredentialStore && run && platform === 'win32') {
    const keyFileText = await readFile(options.keyFilePath, 'utf8').catch(() => '')
    const existing = await readDpapiKeyFile(options.keyFilePath, run)
    if (existing) {
      return { encryptor: createAesEncryptor(existing), osKeychain: true, reason: 'key DPAPI-protected (CurrentUser) in key file' }
    }
    if (keyFileText.trim().startsWith(WINDOWS_DPAPI_KEY_PREFIX)) {
      throw new UnreadableCredentialKeyError()
    }
    const key = legacyFileKey ?? randomBytes(32)
    const wrapped = await dpapiProtect(run, key)
    if (wrapped) {
      await writeKeyFileContent(options.keyFilePath, `${WINDOWS_DPAPI_KEY_PREFIX}${wrapped}`)
      return {
        encryptor: createAesEncryptor(key),
        osKeychain: true,
        reason: legacyFileKey ? 'existing key migrated to DPAPI protection (CurrentUser)' : 'new key DPAPI-protected (CurrentUser)'
      }
    }
  }

  // Fallback: per-user 0600 key file.
  const existingFileKey = legacyFileKey
  const fallbackReason = disableOsCredentialStore
    ? 'OS credential store disabled'
    : 'OS keychain unavailable'
  return createKeyFileFallback(options.keyFilePath, existingFileKey, fallbackReason)
}
