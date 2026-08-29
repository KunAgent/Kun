import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  createAesEncryptor,
  createSecretEncryptor,
  DISABLE_OS_CREDENTIAL_STORE_ENV,
  hasPersistedSecretKeyMaterial,
  isEncryptedEnvelope,
  UNREADABLE_CREDENTIAL_KEY_ERROR_CODE,
  WINDOWS_DPAPI_KEY_PREFIX
} from './secret-store.js'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'

const isolatedCredentialEnvironment = {
  [DISABLE_OS_CREDENTIAL_STORE_ENV]: '1'
}

const explicitOsCredentialStore = {
  disableOsKeychain: false,
  environment: isolatedCredentialEnvironment
}

afterEach(() => {
  configureManagerAtomicJsonClient(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function installFakeAtomicJsonManager(dataDir: string) {
  const documents = new Map<string, { revision: number; value: unknown | null }>()
  configureManagerAtomicJsonClient({
    baseUrl: 'http://manager.test',
    token: 'manager-token',
    dataDir
  })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      path: string
      expectedRevision?: number
      value?: unknown
    }
    const current = documents.get(body.path) ?? { revision: 0, value: null }
    if (url.endsWith('/read')) {
      return Response.json({ snapshot: structuredClone(current) })
    }
    if (body.expectedRevision !== current.revision) {
      return Response.json({
        code: 'revision_conflict',
        currentRevision: current.revision
      }, { status: 409 })
    }
    const next = {
      revision: current.revision + 1,
      value: url.endsWith('/delete') ? null : structuredClone(body.value ?? null)
    }
    documents.set(body.path, next)
    return Response.json({ snapshot: structuredClone(next) })
  }))
  return documents
}

describe('createAesEncryptor', () => {
  it('round-trips a secret', () => {
    const enc = createAesEncryptor(randomBytes(32))
    const blob = enc.encrypt('bearer-token-123')
    expect(isEncryptedEnvelope(blob)).toBe(true)
    expect(blob).not.toContain('bearer-token-123')
    expect(enc.decrypt(blob)).toBe('bearer-token-123')
  })

  it('passes through legacy plaintext on decrypt', () => {
    const enc = createAesEncryptor(randomBytes(32))
    expect(enc.decrypt('plain-legacy')).toBe('plain-legacy')
  })

  it('rejects a wrong-size key', () => {
    expect(() => createAesEncryptor(randomBytes(16))).toThrow(/32 bytes/)
  })

  it('fails to decrypt a tampered blob', () => {
    const enc = createAesEncryptor(randomBytes(32))
    const blob = enc.encrypt('secret')
    const tampered = blob.slice(0, -4) + 'AAAA'
    expect(() => enc.decrypt(tampered)).toThrow()
  })

  it('authenticates caller-supplied profile binding data', () => {
    const enc = createAesEncryptor(randomBytes(32))
    const blob = enc.encrypt('secret', 'profile-a:credential-a')
    expect(enc.decrypt(blob, 'profile-a:credential-a')).toBe('secret')
    expect(() => enc.decrypt(blob, 'profile-b:credential-a')).toThrow()
  })
})

describe('createSecretEncryptor', () => {
  it('serializes empty key bootstrap through the Manager so Main and Runtime share one key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-manager-bootstrap-'))
    const keyPath = join(dir, 'secret.key')
    const documents = installFakeAtomicJsonManager(dir)

    let activeLookups = 0
    let maximumConcurrentLookups = 0
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'lookup') {
        activeLookups += 1
        maximumConcurrentLookups = Math.max(maximumConcurrentLookups, activeLookups)
        await new Promise((resolve) => setTimeout(resolve, 40))
        activeLookups -= 1
        return { code: -1, stdout: '', stderr: 'Secret Service unavailable' }
      }
      if (args[0] === 'store') {
        return { code: -1, stdout: '', stderr: 'Secret Service unavailable' }
      }
      throw new Error(`unexpected Secret Service command: ${args.join(' ')}`)
    })

    try {
      const options = {
        keyFilePath: keyPath,
        platform: 'linux' as const,
        run,
        ...explicitOsCredentialStore,
        canBootstrapKeyFileFallback: async () => true
      }
      const [main, runtime] = await Promise.all([
        createSecretEncryptor(options),
        createSecretEncryptor(options)
      ])

      expect(maximumConcurrentLookups).toBe(1)
      const mainCiphertext = main.encryptor.encrypt('main-secret')
      const runtimeCiphertext = runtime.encryptor.encrypt('runtime-secret')
      expect(runtime.encryptor.decrypt(mainCiphertext)).toBe('main-secret')
      expect(main.encryptor.decrypt(runtimeCiphertext)).toBe('runtime-secret')

      const persistedKey = (await readFile(keyPath, 'utf8')).trim()
      const lease = documents.get(`${keyPath}.bootstrap-lease.v1.json`)
      expect(lease?.value).toEqual({
        schemaVersion: 1,
        ownerId: null,
        leaseExpiresAtMs: 0
      })
      expect(JSON.stringify(lease?.value)).not.toContain(persistedKey)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a key path outside Manager authority before any credential side effect', async () => {
    const managerDir = await mkdtemp(join(tmpdir(), 'kun-secret-manager-authority-'))
    const outsideDir = await mkdtemp(join(tmpdir(), 'kun-secret-outside-authority-'))
    const keyPath = join(outsideDir, 'secret.key')
    configureManagerAtomicJsonClient({
      baseUrl: 'http://manager.test',
      token: 'manager-token',
      dataDir: managerDir
    })
    const run = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
    const canBootstrapKeyFileFallback = vi.fn(async () => true)

    try {
      await expect(createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'linux',
        run,
        ...explicitOsCredentialStore,
        canBootstrapKeyFileFallback
      })).rejects.toMatchObject({ code: 'EXTENSION_JSON_MANAGER_PATH_MISMATCH' })

      expect(run).not.toHaveBeenCalled()
      expect(canBootstrapKeyFileFallback).not.toHaveBeenCalled()
      await expect(readFile(keyPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await Promise.all([
        rm(managerDir, { recursive: true, force: true }),
        rm(outsideDir, { recursive: true, force: true })
      ])
    }
  })

  it('does not let an expired live owner get fenced out while its key bootstrap resumes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T00:00:00.000Z'))
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-live-owner-'))
    const keyPath = join(dir, 'secret.key')
    const documents = installFakeAtomicJsonManager(dir)
    let releaseAuthorityLookup!: () => void
    const authorityLookupReleased = new Promise<void>((resolve) => {
      releaseAuthorityLookup = resolve
    })
    let noteAuthorityLookupStarted!: () => void
    const authorityLookupStarted = new Promise<void>((resolve) => {
      noteAuthorityLookupStarted = resolve
    })
    const ownerRun = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'lookup') {
        noteAuthorityLookupStarted()
        await authorityLookupReleased
        return { code: -1, stdout: '', stderr: 'Secret Service unavailable' }
      }
      if (args[0] === 'store') {
        return { code: -1, stdout: '', stderr: 'Secret Service unavailable' }
      }
      throw new Error(`unexpected Secret Service command: ${args.join(' ')}`)
    })
    const contenderRun = vi.fn(async () => {
      throw new Error('contender must not execute a credential authority side effect')
    })

    try {
      const owner = createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'linux',
        run: ownerRun,
        ...explicitOsCredentialStore,
        canBootstrapKeyFileFallback: async () => true
      })
      await authorityLookupStarted
      const activeLease = documents.get(`${keyPath}.bootstrap-lease.v1.json`)?.value as {
        leaseExpiresAtMs: number
      }
      vi.setSystemTime(new Date(activeLease.leaseExpiresAtMs + 1))

      await expect(createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'linux',
        run: contenderRun,
        ...explicitOsCredentialStore,
        canBootstrapKeyFileFallback: async () => true
      })).rejects.toThrow(/owner process is still alive/)
      expect(contenderRun).not.toHaveBeenCalled()

      releaseAuthorityLookup()
      const authoritative = await owner
      expect(authoritative.encryptor.decrypt(
        authoritative.encryptor.encrypt('only-authoritative-key')
      )).toBe('only-authoritative-key')
      expect(ownerRun).toHaveBeenCalledTimes(1)
      expect(await readFile(keyPath, 'utf8')).toBeTruthy()
    } finally {
      releaseAuthorityLookup()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('bootstraps a local key for a pre-secret-store Linux profile when Secret Service is unavailable', async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'lookup') {
        return { code: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus without X11 $DISPLAY' }
      }
      throw new Error(`unexpected Secret Service command: ${args.join(' ')}`)
    })
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    const keyPath = join(dir, 'secret.key')
    try {
      const result = await createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'linux',
        run,
        ...explicitOsCredentialStore,
        canBootstrapKeyFileFallback: async () => !(await hasPersistedSecretKeyMaterial(dir))
      })

      expect(result.osKeychain).toBe(false)
      expect(result.reason).toContain('Linux secret service lookup failed')
      expect(run).toHaveBeenCalledTimes(1)
      expect(await readFile(keyPath, 'utf8')).toBeTruthy()
      if (process.platform !== 'win32') {
        expect((await stat(keyPath)).mode & 0o777).toBe(0o600)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves fail-closed behavior when encrypted extension credentials exist', async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'lookup') {
        return { code: -1, stdout: '', stderr: 'Secret Service is unavailable' }
      }
      throw new Error(`unexpected Secret Service command: ${args.join(' ')}`)
    })
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    const keyPath = join(dir, 'secret.key')
    try {
      await mkdir(join(dir, 'credentials'), { recursive: true })
      await writeFile(join(dir, 'credentials', 'credentials.enc.json'), JSON.stringify({
        schemaVersion: 1,
        profileId: 'default',
        credentials: {
          cred_existing: {
            algorithm: 'aes-256-gcm', nonce: 'nonce', ciphertext: 'ciphertext', tag: 'tag', updatedAt: '2026-07-23T00:00:00.000Z'
          }
        }
      }))

      await expect(createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'linux',
        run,
        ...explicitOsCredentialStore,
        canBootstrapKeyFileFallback: async () => !(await hasPersistedSecretKeyMaterial(dir))
      })).rejects.toThrow(/refusing to replace/)

      expect(run).toHaveBeenCalledTimes(1)
      await expect(readFile(keyPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('detects encrypted MCP OAuth state but permits legacy plaintext OAuth state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    const oauthDirectory = join(dir, 'mcp-oauth')
    const oauthPath = join(oauthDirectory, 'remote-server.json')
    try {
      await mkdir(oauthDirectory, { recursive: true })
      await writeFile(oauthPath, JSON.stringify({
        tokens: { access_token: 'legacy-plaintext-token', token_type: 'bearer' }
      }))
      await expect(hasPersistedSecretKeyMaterial(dir)).resolves.toBe(false)

      await writeFile(oauthPath, JSON.stringify({ __enc: 'enc:v1:nonce:tag:ciphertext' }))
      await expect(hasPersistedSecretKeyMaterial(dir)).resolves.toBe(true)

      await writeFile(oauthPath, '{ invalid json')
      await expect(hasPersistedSecretKeyMaterial(dir)).resolves.toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses a persistent owner-only key file without invoking OS helpers when automation isolation is enabled', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: 'unexpected', stderr: '' }))
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    const keyPath = join(dir, 'secret.key')
    try {
      const result = await createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'darwin',
        run,
        environment: isolatedCredentialEnvironment
      })
      expect(result.osKeychain).toBe(false)
      expect(result.reason).toContain('OS credential store disabled')
      expect(run).not.toHaveBeenCalled()

      const blob = result.encryptor.encrypt('automation-secret')
      expect(blob).not.toContain('automation-secret')
      expect(await readFile(keyPath, 'utf8')).not.toContain('automation-secret')
      if (process.platform !== 'win32') {
        expect((await stat(keyPath)).mode & 0o777).toBe(0o600)
      }

      const again = await createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'darwin',
        run,
        environment: isolatedCredentialEnvironment
      })
      expect(again.encryptor.decrypt(blob)).toBe('automation-secret')
      expect(run).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses the OS keychain when available (darwin)', async () => {
    const store = new Map<string, string>()
    const run = vi.fn(async (command: string, args: string[], input?: string) => {
      if (args[0] === 'find-generic-password') {
        const v = store.get('k')
        return v ? { code: 0, stdout: v, stderr: '' } : { code: 1, stdout: '', stderr: 'not found' }
      }
      if (args[0] === 'add-generic-password') {
        store.set('k', args[args.indexOf('-w') + 1])
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: '' }
    })
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    try {
      const result = await createSecretEncryptor({
        keyFilePath: join(dir, 'secret.key'),
        platform: 'darwin',
        run,
        ...explicitOsCredentialStore
      })
      expect(result.osKeychain).toBe(true)
      const blob = result.encryptor.encrypt('tok')
      // A second resolve reads the SAME key from the keychain and decrypts.
      const again = await createSecretEncryptor({
        keyFilePath: join(dir, 'secret.key'),
        platform: 'darwin',
        run,
        ...explicitOsCredentialStore
      })
      expect(again.encryptor.decrypt(blob)).toBe('tok')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves conflicting keychain and fallback generations without overwriting either key', async () => {
    const keychainKey = randomBytes(32)
    const fallbackKey = randomBytes(32)
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'find-generic-password') {
        return { code: 0, stdout: keychainKey.toString('base64'), stderr: '' }
      }
      if (args[0] === 'add-generic-password') {
        throw new Error('an established keychain key must not be replaced')
      }
      return { code: 1, stdout: '', stderr: '' }
    })
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-conflict-'))
    const keyPath = join(dir, 'secret.key')
    const keychainBlob = createAesEncryptor(keychainKey).encrypt('keychain-token')
    const fallbackBlob = createAesEncryptor(fallbackKey).encrypt('fallback-token')
    try {
      await writeFile(keyPath, fallbackKey.toString('base64'))
      const result = await createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'darwin',
        run,
        ...explicitOsCredentialStore
      })

      expect(result.osKeychain).toBe(false)
      expect(result.reason).toContain('different credential generations')
      expect(result.encryptor.decrypt(keychainBlob)).toBe('keychain-token')
      expect(result.encryptor.decrypt(fallbackBlob)).toBe('fallback-token')
      expect(createAesEncryptor(keychainKey).decrypt(
        result.encryptor.encrypt('new-token')
      )).toBe('new-token')
      expect(await readFile(keyPath, 'utf8')).toBe(fallbackKey.toString('base64'))
      expect(run.mock.calls.some(([, args]) => args[0] === 'add-generic-password')).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not replace a macOS key when its keychain lookup fails transiently', async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'find-generic-password') {
        return { code: -1, stdout: '', stderr: 'User interaction is not allowed.' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    const keyPath = join(dir, 'secret.key')
    try {
      await expect(createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'darwin',
        run,
        ...explicitOsCredentialStore
      }))
        .rejects.toThrow(/refusing to replace/)
      expect(run.mock.calls.some(([, args]) => args[0] === 'add-generic-password')).toBe(false)
      await expect(readFile(keyPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to a 0600 key file when the keychain is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    try {
      const keyPath = join(dir, 'secret.key')
      const result = await createSecretEncryptor({ keyFilePath: keyPath, platform: 'win32' })
      expect(result.osKeychain).toBe(false)
      expect(result.reason).toContain('key file')
      const blob = result.encryptor.encrypt('tok')
      // Persisted key file means a fresh resolve decrypts the same blob.
      const again = await createSecretEncryptor({ keyFilePath: keyPath, platform: 'win32' })
      expect(again.encryptor.decrypt(blob)).toBe('tok')
      await expect(readFile(keyPath, 'utf8')).resolves.toBeTruthy()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('DPAPI-protects the key file on Windows when PowerShell is available', async () => {
    // Simulate DPAPI as a reversible wrap (prefix 'DP') so the test exercises
    // the protect/store + read/unprotect round-trip without a real keychain.
    const run = vi.fn(async (_cmd: string, args: string[], input?: string) => {
      const script = args[args.length - 1]
      if (script.includes('::Protect')) {
        const raw = Buffer.from((input ?? '').trim(), 'base64')
        return { code: 0, stdout: Buffer.concat([Buffer.from('DP'), raw]).toString('base64'), stderr: '' }
      }
      if (script.includes('::Unprotect')) {
        const blob = Buffer.from((input ?? '').trim(), 'base64')
        if (blob.subarray(0, 2).toString() !== 'DP') return { code: 1, stdout: '', stderr: 'bad' }
        return { code: 0, stdout: blob.subarray(2).toString('base64'), stderr: '' }
      }
      return { code: 1, stdout: '', stderr: '' }
    })
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    try {
      const keyPath = join(dir, 'secret.key')
      const result = await createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'win32',
        run,
        ...explicitOsCredentialStore
      })
      expect(result.osKeychain).toBe(true)
      expect(result.reason).toContain('DPAPI')
      // The on-disk key file is a DPAPI envelope, not a raw key.
      const onDisk = await readFile(keyPath, 'utf8')
      expect(onDisk.startsWith('dpapi:v1:')).toBe(true)
      const blob = result.encryptor.encrypt('tok')
      // A fresh resolve unwraps the same DPAPI-protected key and decrypts.
      const again = await createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'win32',
        run,
        ...explicitOsCredentialStore
      })
      expect(again.osKeychain).toBe(true)
      expect(again.encryptor.decrypt(blob)).toBe('tok')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not replace an existing DPAPI key when Windows can no longer decrypt it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    const keyPath = join(dir, 'secret.key')
    const protectedKey = `${WINDOWS_DPAPI_KEY_PREFIX}unreadable-envelope`
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'CryptUnprotectData failed' }))
    try {
      await writeFile(keyPath, protectedKey)
      await expect(createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'win32',
        run,
        ...explicitOsCredentialStore
      })).rejects.toMatchObject({ code: UNREADABLE_CREDENTIAL_KEY_ERROR_CODE })
      await expect(readFile(keyPath, 'utf8')).resolves.toBe(protectedKey)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('migrates an existing raw key to DPAPI without changing the encryption key', async () => {
    const run = vi.fn(async (_cmd: string, args: string[], input?: string) => {
      const script = args[args.length - 1]
      if (script.includes('::Protect')) {
        const raw = Buffer.from((input ?? '').trim(), 'base64')
        return { code: 0, stdout: Buffer.concat([Buffer.from('DP'), raw]).toString('base64'), stderr: '' }
      }
      if (script.includes('::Unprotect')) {
        const blob = Buffer.from((input ?? '').trim(), 'base64')
        return { code: 0, stdout: blob.subarray(2).toString('base64'), stderr: '' }
      }
      return { code: 1, stdout: '', stderr: '' }
    })
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    try {
      const keyPath = join(dir, 'secret.key')
      const key = randomBytes(32)
      const oldEncryptor = createAesEncryptor(key)
      const blob = oldEncryptor.encrypt('existing-token')
      await writeFile(keyPath, key.toString('base64'))
      const migrated = await createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'win32',
        run,
        ...explicitOsCredentialStore
      })
      expect(migrated.encryptor.decrypt(blob)).toBe('existing-token')
      await expect(readFile(keyPath, 'utf8')).resolves.toMatch(/^dpapi:v1:/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('migrates an existing raw key to the macOS keychain before generating a key', async () => {
    let stored = ''
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'add-generic-password') {
        stored = args[args.indexOf('-w') + 1]
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'not found' }
    })
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    try {
      const keyPath = join(dir, 'secret.key')
      const key = randomBytes(32)
      const blob = createAesEncryptor(key).encrypt('existing-token')
      await writeFile(keyPath, key.toString('base64'))
      const migrated = await createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'darwin',
        run,
        ...explicitOsCredentialStore
      })
      expect(Buffer.from(stored, 'base64')).toEqual(key)
      expect(migrated.encryptor.decrypt(blob)).toBe('existing-token')
      expect(run.mock.calls.find(([, args]) => args[0] === 'add-generic-password')?.[1])
        .not.toContain('-U')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to a plain key file on Windows when DPAPI is unavailable', async () => {
    const run = vi.fn(async () => ({ code: -1, stdout: '', stderr: 'powershell missing' }))
    const dir = await mkdtemp(join(tmpdir(), 'kun-secret-'))
    try {
      const keyPath = join(dir, 'secret.key')
      const result = await createSecretEncryptor({
        keyFilePath: keyPath,
        platform: 'win32',
        run,
        ...explicitOsCredentialStore
      })
      expect(result.osKeychain).toBe(false)
      expect(result.reason).toContain('key file')
      const onDisk = await readFile(keyPath, 'utf8')
      expect(onDisk.startsWith('dpapi:v1:')).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
