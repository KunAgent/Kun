import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskKeyService } from './task-key-service'

describe('TaskKeyService', () => {
  it('uses RFC 9180 HPKE for sponsor distribution and rotates generations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-task-key-'))
    try {
      const sponsor = await TaskKeyService.open(join(directory, 'sponsor.json'), Buffer.alloc(32, 1))
      const participant = await TaskKeyService.open(join(directory, 'participant.json'), Buffer.alloc(32, 2))
      await sponsor.create('task-1')
      const generationOne = await sponsor.wrapFor('task-1', await participant.publicKey())
      await participant.accept(generationOne)

      const first = await sponsor.encrypt('task-1', Buffer.from('private task content'))
      await expect(participant.decrypt('task-1', first)).resolves.toEqual(Buffer.from('private task content'))

      await sponsor.rotate('task-1')
      const second = await sponsor.encrypt('task-1', Buffer.from('post-removal content'))
      await expect(participant.decrypt('task-1', second)).rejects.toMatchObject({
        code: 'task_key_generation_unavailable'
      })
      const generationTwo = await sponsor.wrapFor('task-1', await participant.publicKey())
      expect(generationTwo.generation).toBe(2)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('persists only vault-encrypted HPKE and task-key state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-task-key-'))
    const path = join(directory, 'task-keys.json')
    try {
      const service = await TaskKeyService.open(path, Buffer.alloc(32, 3))
      await service.create('task-secret-canary')
      const raw = await readFile(path, 'utf8')
      expect(raw).not.toContain('task-secret-canary')
      expect(JSON.parse(raw)).toMatchObject({ storage: 'aes-256-gcm', version: 1 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('seals pairwise remote invocation payloads with the persisted HPKE identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-task-key-'))
    try {
      const caller = await TaskKeyService.open(join(directory, 'caller.json'), Buffer.alloc(32, 4))
      const owner = await TaskKeyService.open(join(directory, 'owner.json'), Buffer.alloc(32, 5))
      const info = Buffer.from('kun-remote-invocation-test')
      const sealed = await caller.sealTo(await owner.publicKey(), Buffer.from('private prompt'), info)
      await expect(owner.open(sealed, info)).resolves.toEqual(Buffer.from('private prompt'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
