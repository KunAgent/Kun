import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { ProtectedPersonalImStore, type PersonalImConnection } from './personal-agent-im-store'
const protection = vi.hoisted(() => ({ assert: vi.fn(), seal: vi.fn((value: string) => Buffer.from(value).toString('base64')),
  open: vi.fn((value: string) => Buffer.from(value, 'base64').toString()) }))
vi.mock('./personal-agent-im-secrets', () => ({ assertPersonalImSecretStorage: protection.assert,
  protectPersonalImSecret: protection.seal, unprotectPersonalImSecret: protection.open }))
const cleanup: string[] = []
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); vi.clearAllMocks() })
it('persists only the protected envelope and round-trips connection identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-im-store-')); cleanup.push(directory)
  const file = join(directory, 'im.enc'), store = new ProtectedPersonalImStore(file)
  expect(await store.load()).toEqual([])
  const connection: PersonalImConnection = { id: 'connection', roomId: 'room', cardId: 'card', agentId: 'agent',
    ownerId: 'owner', provider: 'feishu', enabled: true, appId: 'app', appSecret: 'super-secret-value', domain: 'feishu' }
  await store.save([connection])
  expect(protection.seal).toHaveBeenCalledWith(expect.stringContaining('super-secret-value'))
  expect(await readFile(file, 'utf8')).not.toContain('super-secret-value')
  expect(await store.load()).toEqual([connection])
})
it('does not write anything when OS encryption fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-im-store-')); cleanup.push(directory)
  const file = join(directory, 'im.enc'), store = new ProtectedPersonalImStore(file)
  protection.seal.mockImplementationOnce(() => { throw new Error('OS store locked') })
  await expect(store.save([])).rejects.toThrow('OS store locked')
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
})
