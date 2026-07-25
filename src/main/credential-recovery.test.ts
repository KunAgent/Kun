import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WINDOWS_DPAPI_KEY_PREFIX } from '../../kun/src/security/secret-store.js'
import { resetUnreadableWindowsCredentials } from './credential-recovery'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resetUnreadableWindowsCredentials', () => {
  it('backs up credential state while preserving conversations and ordinary data', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-credential-recovery-'))
    roots.push(dataDir)
    const files = [
      ['secret.key', `${WINDOWS_DPAPI_KEY_PREFIX}broken`],
      ['credentials/credentials.enc.json', '{"credentials":{"credential":{}}}'],
      ['mcp-oauth/google.json', '{"tokens":"encrypted"}'],
      ['extensions/accounts.json', '{"accounts":{}}'],
      ['extensions/provider-bindings.json', '{"bindings":{}}'],
      ['extensions/legacy-credential-migrations.json', '{"entries":{}}'],
      ['threads/thread-1.json', '{"title":"keep me"}']
    ] as const
    for (const [relativePath, content] of files) {
      const path = join(dataDir, relativePath)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    }

    const result = await resetUnreadableWindowsCredentials(dataDir, {
      run: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'CryptUnprotectData failed' })),
      now: () => new Date('2026-07-25T00:00:00.000Z'),
      id: () => 'test-recovery'
    })

    expect(result.backupPath).toBe(join(
      dataDir,
      'credential-recovery',
      '2026-07-25T00-00-00-000Z-test-recovery'
    ))
    expect(result.movedItems).toEqual([
      'secret.key',
      'credentials',
      'mcp-oauth',
      'extensions/accounts.json',
      'extensions/provider-bindings.json',
      'extensions/legacy-credential-migrations.json'
    ])
    await expect(readFile(join(result.backupPath, 'secret.key'), 'utf8'))
      .resolves.toBe(`${WINDOWS_DPAPI_KEY_PREFIX}broken`)
    await expect(stat(join(dataDir, 'secret.key'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(dataDir, 'threads/thread-1.json'), 'utf8'))
      .resolves.toContain('keep me')
  })

  it('refuses to reset a DPAPI key that is still readable', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-credential-recovery-'))
    roots.push(dataDir)
    const keyPath = join(dataDir, 'secret.key')
    await writeFile(keyPath, `${WINDOWS_DPAPI_KEY_PREFIX}readable`)

    await expect(resetUnreadableWindowsCredentials(dataDir, {
      run: vi.fn(async () => ({
        code: 0,
        stdout: Buffer.alloc(32, 7).toString('base64'),
        stderr: ''
      }))
    })).rejects.toThrow(/unnecessary/)
    await expect(readFile(keyPath, 'utf8')).resolves.toBe(`${WINDOWS_DPAPI_KEY_PREFIX}readable`)
  })

  it('rolls back files already moved when the backup cannot complete', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-credential-recovery-'))
    roots.push(dataDir)
    const keyPath = join(dataDir, 'secret.key')
    const credentialsPath = join(dataDir, 'credentials', 'credentials.enc.json')
    await writeFile(keyPath, `${WINDOWS_DPAPI_KEY_PREFIX}broken`)
    await mkdir(dirname(credentialsPath), { recursive: true })
    await writeFile(credentialsPath, '{"credentials":{}}')
    const backupPath = join(
      dataDir,
      'credential-recovery',
      '2026-07-25T00-00-00-000Z-rollback-test'
    )

    await expect(resetUnreadableWindowsCredentials(dataDir, {
      run: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'CryptUnprotectData failed' })),
      now: () => new Date('2026-07-25T00:00:00.000Z'),
      id: () => 'rollback-test',
      move: async (sourcePath, destinationPath) => {
        if (sourcePath === join(dataDir, 'credentials')) throw new Error('simulated move failure')
        await rename(sourcePath, destinationPath)
      }
    })).rejects.toThrow(/simulated move failure/)

    await expect(readFile(keyPath, 'utf8')).resolves.toBe(`${WINDOWS_DPAPI_KEY_PREFIX}broken`)
    await expect(readFile(credentialsPath, 'utf8')).resolves.toContain('credentials')
    await expect(stat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the backup copy when rollback cannot restore a moved credential file', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-credential-recovery-'))
    roots.push(dataDir)
    const keyPath = join(dataDir, 'secret.key')
    const credentialsPath = join(dataDir, 'credentials', 'credentials.enc.json')
    await writeFile(keyPath, `${WINDOWS_DPAPI_KEY_PREFIX}broken`)
    await mkdir(dirname(credentialsPath), { recursive: true })
    await writeFile(credentialsPath, '{"credentials":{}}')
    const backupPath = join(
      dataDir,
      'credential-recovery',
      '2026-07-25T00-00-00-000Z-retained-backup'
    )

    await expect(resetUnreadableWindowsCredentials(dataDir, {
      run: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'CryptUnprotectData failed' })),
      now: () => new Date('2026-07-25T00:00:00.000Z'),
      id: () => 'retained-backup',
      move: async (sourcePath, destinationPath) => {
        if (sourcePath === join(dataDir, 'credentials')) throw new Error('simulated backup failure')
        if (sourcePath === join(backupPath, 'secret.key')) throw new Error('simulated rollback failure')
        await rename(sourcePath, destinationPath)
      }
    })).rejects.toThrow(backupPath)

    await expect(stat(keyPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(backupPath, 'secret.key'), 'utf8'))
      .resolves.toBe(`${WINDOWS_DPAPI_KEY_PREFIX}broken`)
    await expect(readFile(credentialsPath, 'utf8')).resolves.toContain('credentials')
  })
})
