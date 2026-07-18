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

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type SecretEncryptor = {
  encrypt: (plaintext: string, additionalAuthenticatedData?: string | Buffer) => string
  decrypt: (blob: string, additionalAuthenticatedData?: string | Buffer) => string
}

const ALGORITHM = 'aes-256-gcm'
const ENVELOPE_PREFIX = 'enc:v1:'

/** Build an AES-256-GCM encryptor from a 32-byte key. */
export function createAesEncryptor(key: Buffer): SecretEncryptor {
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes')
  return {
    encrypt: (plaintext: string, additionalAuthenticatedData?: string | Buffer): string => {
      const iv = randomBytes(12)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      if (additionalAuthenticatedData !== undefined) {
        cipher.setAAD(asBuffer(additionalAuthenticatedData))
      }
      const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return `${ENVELOPE_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
    },
    decrypt: (blob: string, additionalAuthenticatedData?: string | Buffer): string => {
      if (!blob.startsWith(ENVELOPE_PREFIX)) return blob // legacy plaintext
      const [, , ivB64, tagB64, dataB64] = blob.split(':')
      const iv = Buffer.from(ivB64, 'base64')
      const tag = Buffer.from(tagB64, 'base64')
      const data = Buffer.from(dataB64, 'base64')
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      if (additionalAuthenticatedData !== undefined) {
        decipher.setAAD(asBuffer(additionalAuthenticatedData))
      }
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    }
  }
}

function asBuffer(value: string | Buffer): Buffer {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value
}

export function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX)
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
      const res = await run('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', b64])
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
const DPAPI_PREFIX = 'dpapi:v1:'

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
  if (!content.startsWith(DPAPI_PREFIX)) return null
  return dpapiUnprotect(run, content.slice(DPAPI_PREFIX.length))
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

async function writeKeyFile(path: string, key: Buffer): Promise<void> {
  await writeKeyFileContent(path, key.toString('base64'))
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

export type CreateKeyProviderOptions = {
  /** Path to the fallback key file (used when the OS keychain is unavailable). */
  keyFilePath: string
  platform?: NodeJS.Platform
  run?: CommandRunner
  /** Disable OS credential-store usage (force the key-file fallback). */
  disableOsKeychain?: boolean
  /** Injectable environment used to resolve the non-interactive automation override. */
  environment?: NodeJS.ProcessEnv
}

export const DISABLE_OS_CREDENTIAL_STORE_ENV = 'KUN_DISABLE_OS_CREDENTIAL_STORE'

/**
 * Resolve a secret encryptor. Tries the OS keychain first (storing a random key
 * there), then falls back to a 0600 key file. Tokens are always encrypted at
 * rest either way.
 */
export async function createSecretEncryptor(options: CreateKeyProviderOptions): Promise<KeyProviderResult> {
  const platform = options.platform ?? process.platform
  const run = options.run
  const environment = options.environment ?? process.env
  const disableOsCredentialStore = options.disableOsKeychain ??
    environment[DISABLE_OS_CREDENTIAL_STORE_ENV] === '1'
  const useKeychain = !disableOsCredentialStore && run && (platform === 'darwin' || platform === 'linux')
  // Migration rule: an existing raw key is authoritative because it may be the
  // only key capable of decrypting already-persisted OAuth credentials. Never
  // generate a fresh OS key before checking it.
  const legacyFileKey = await readKeyFile(options.keyFilePath)

  if (useKeychain && run) {
    if (legacyFileKey) {
      if (await tryWriteOsKey(platform, run, legacyFileKey)) {
        await rm(options.keyFilePath, { force: true }).catch(() => undefined)
        return { encryptor: createAesEncryptor(legacyFileKey), osKeychain: true, reason: 'existing key migrated to OS keychain' }
      }
      return { encryptor: createAesEncryptor(legacyFileKey), osKeychain: false, reason: 'OS keychain migration failed; existing 0600 key file preserved' }
    }
    const existing = await tryReadOsKey(platform, run)
    if (existing.status === 'found') {
      return { encryptor: createAesEncryptor(existing.key), osKeychain: true, reason: 'key loaded from OS keychain' }
    }
    // A lookup failure is different from a confirmed missing item. Generating
    // a replacement here would make every credential encrypted by the
    // temporarily inaccessible key permanently unreadable. Fail closed and
    // let the caller retry once Keychain/secret-service access is restored.
    if (existing.status === 'unavailable') {
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
    if (keyFileText.trim().startsWith(DPAPI_PREFIX)) {
      throw new Error('existing DPAPI-protected OAuth key could not be decrypted; refusing to replace it')
    }
    const key = legacyFileKey ?? randomBytes(32)
    const wrapped = await dpapiProtect(run, key)
    if (wrapped) {
      await writeKeyFileContent(options.keyFilePath, `${DPAPI_PREFIX}${wrapped}`)
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
  if (existingFileKey) {
    return {
      encryptor: createAesEncryptor(existingFileKey),
      osKeychain: false,
      reason: `${fallbackReason}; key loaded from 0600 key file (tokens still encrypted at rest)`
    }
  }
  const fileKey = randomBytes(32)
  await writeKeyFile(options.keyFilePath, fileKey)
  return {
    encryptor: createAesEncryptor(fileKey),
    osKeychain: false,
    reason: `${fallbackReason}; created a new 0600 key file (tokens still encrypted at rest)`
  }
}
