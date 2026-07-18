import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  createAesEncryptor,
  createSecretEncryptor,
  DISABLE_OS_CREDENTIAL_STORE_ENV,
  isEncryptedEnvelope
} from './secret-store.js'

const isolatedCredentialEnvironment = {
  [DISABLE_OS_CREDENTIAL_STORE_ENV]: '1'
}

const explicitOsCredentialStore = {
  disableOsKeychain: false,
  environment: isolatedCredentialEnvironment
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
