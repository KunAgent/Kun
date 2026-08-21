import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { remoteSshHostInputSchema } from '../ipc/app-ipc-schemas'
import { JsonRemoteSshHostStore } from './host-store'
import { RemoteSshKnownHostStore, sshHostKeyFingerprint } from './known-host-store'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'kun-remote-ssh-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })))
})

describe('remote SSH persistence', () => {
  it('strictly validates agent and identity-file host inputs', () => {
    expect(remoteSshHostInputSchema.parse({
      label: 'Build host',
      hostname: 'build.example.com',
      username: 'builder',
      auth: { type: 'agent' }
    })).toMatchObject({ hostname: 'build.example.com', auth: { type: 'agent' } })

    expect(() => remoteSshHostInputSchema.parse({
      label: 'Build host',
      hostname: 'build.example.com',
      username: 'builder',
      auth: { type: 'identityFile', identityFile: '~/.ssh/id_ed25519', privateKey: 'secret' }
    })).toThrow()
    expect(() => remoteSshHostInputSchema.parse({
      label: 'Bad',
      hostname: 'user@example.com',
      username: 'builder',
      auth: { type: 'agent' }
    })).toThrow()
  })

  it('persists host CRUD without private key contents', async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'hosts.json')
    const store = new JsonRemoteSshHostStore(path)
    const created = await store.create({
      label: 'Build host',
      hostname: 'build.example.com',
      username: 'builder',
      auth: { type: 'identityFile', identityFile: '~/.ssh/id_ed25519' }
    })
    expect(created.port).toBe(22)
    const updated = await store.update(created.id, {
      label: 'Production',
      hostname: 'prod.example.com',
      port: 2222,
      username: 'deploy',
      auth: { type: 'agent' }
    })
    expect(await store.list()).toEqual([updated])
    expect(await readFile(path, 'utf8')).not.toContain('privateKey')
    expect(await store.remove(created.id)).toBe(true)
    expect(await store.list()).toEqual([])
  })

  it('confirms exact host keys and supports reset', async () => {
    const directory = await temporaryDirectory()
    const store = new RemoteSshKnownHostStore(join(directory, 'known-hosts.json'))
    const key = Buffer.from('test host public key bytes')
    const confirmation = {
      hostId: 'host-1',
      fingerprint: sshHostKeyFingerprint(key),
      key: key.toString('base64')
    }
    expect(await store.matches('host-1', key)).toBe(false)
    await store.confirm(confirmation)
    expect(await store.matches('host-1', key)).toBe(true)
    expect(await store.matches('host-1', Buffer.from('different key'))).toBe(false)
    expect(await store.state('host-1', Buffer.from('different key'))).toBe('mismatch')
    const replacement = Buffer.from('different key')
    await expect(store.confirm({
      hostId: 'host-1',
      fingerprint: sshHostKeyFingerprint(replacement),
      key: replacement.toString('base64')
    })).rejects.toThrow('different SSH host key')
    expect(await store.reset('host-1')).toBe(true)
    expect(await store.matches('host-1', key)).toBe(false)
  })
})
