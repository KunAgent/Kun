import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
vi.mock('electron', () => ({ safeStorage: {
  isAsyncEncryptionAvailable: async () => true, isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'secret_service',
  encryptStringAsync: async (value: string) => Buffer.from(value), decryptStringAsync: async (bytes: Buffer) => ({ result: bytes.toString() }),
  encryptString: (value: string) => Buffer.from(value), decryptString: (bytes: Buffer) => bytes.toString()
} }))
import { DirectStore } from './direct-store'
import { emptyDirectSettings } from './direct-registry'
it('a fresh store instance excludes a revoked credential even when its encrypted record still contains it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-direct-store-')), path = join(root, 'direct.enc'), id = randomUUID()
  try {
    const store = new DirectStore(path)
    await store.write({ ...emptyDirectSettings(), enabled: true, grants: [{ id, deviceId: 'phone', name: 'Phone',
      secret: 'a'.repeat(64), scopes: ['personal'], expiresAt: Date.now() + 60000 }] })
    await store.revoke(id); await store.revoke(id)
    expect((await new DirectStore(path).read()).grants).toEqual([])
    await expect(store.revoke('../other')).rejects.toThrow('INVALID_GRANT')
  } finally { await rm(root, { recursive: true, force: true }) }
})
