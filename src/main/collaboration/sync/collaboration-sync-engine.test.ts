import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CollaborationSyncEngine } from './collaboration-sync-engine'

describe('CollaborationSyncEngine', () => {
  it('persists verified sequence and rejects a checkpoint fork as read-only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-sync-'))
    const path = join(directory, 'sync.json')
    const verify = vi.fn(async () => true)
    try {
      const engine = new CollaborationSyncEngine(path, { verify })
      await expect(engine.apply({
        meetingId: 'meeting-1', sequence: 1, previousCheckpointDigest: null,
        checkpointDigest: 'a'.repeat(64), signature: 'signature-1', ciphertext: 'ciphertext-1'
      })).resolves.toMatchObject({ state: 'ready', writable: true, lastVerifiedSequence: 1 })

      const restarted = new CollaborationSyncEngine(path, { verify })
      await expect(restarted.apply({
        meetingId: 'meeting-1', sequence: 2, previousCheckpointDigest: 'b'.repeat(64),
        checkpointDigest: 'c'.repeat(64), signature: 'signature-2', ciphertext: 'ciphertext-2'
      })).resolves.toMatchObject({ state: 'SECURITY_SYNC_REQUIRED', writable: false })
      await expect(restarted.status('meeting-1')).resolves.toMatchObject({
        state: 'SECURITY_SYNC_REQUIRED', writable: false, reason: 'checkpoint_fork'
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('blocks sequence gaps and invalid signatures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-sync-'))
    try {
      const gap = new CollaborationSyncEngine(join(directory, 'gap.json'), { verify: async () => true })
      await expect(gap.apply({
        meetingId: 'meeting-1', sequence: 3, previousCheckpointDigest: null,
        checkpointDigest: 'a'.repeat(64), signature: 'signature', ciphertext: 'ciphertext'
      })).resolves.toMatchObject({ state: 'SECURITY_SYNC_REQUIRED', reason: 'sequence_gap' })

      const invalid = new CollaborationSyncEngine(join(directory, 'invalid.json'), { verify: async () => false })
      await expect(invalid.apply({
        meetingId: 'meeting-2', sequence: 1, previousCheckpointDigest: null,
        checkpointDigest: 'a'.repeat(64), signature: 'invalid', ciphertext: 'ciphertext'
      })).resolves.toMatchObject({ state: 'SECURITY_SYNC_REQUIRED', reason: 'signature_invalid' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
