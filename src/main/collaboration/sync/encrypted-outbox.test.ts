import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EncryptedOutbox, type OutboxCryptoPort } from './encrypted-outbox'

describe('EncryptedOutbox', () => {
  it('persists ciphertext and re-encrypts stale epochs before sending', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-outbox-'))
    const path = join(directory, 'outbox.json')
    let epoch = 1
    const sent: Array<{ epoch: number; ciphertext: string }> = []
    const crypto: OutboxCryptoPort = {
      currentVersion: () => ({ epoch }),
      seal: vi.fn(async (plaintext, version) => Buffer.from(`epoch:${version.epoch}:${plaintext.toString('utf8')}`).toString('base64')),
      open: vi.fn(async (ciphertext) => Buffer.from(Buffer.from(ciphertext, 'base64').toString('utf8').split(':').slice(2).join(':'))),
      send: vi.fn(async (frame) => { sent.push({ epoch: frame.epoch!, ciphertext: frame.ciphertext }); return { accepted: true } })
    }
    try {
      const outbox = new EncryptedOutbox(path, crypto)
      await outbox.enqueue({ commandId: 'command-1', scope: { kind: 'meeting', meetingId: 'meeting-1' }, plaintext: Buffer.from('TOP_SECRET_PLAN') })
      expect(await readFile(path, 'utf8')).not.toContain('TOP_SECRET_PLAN')

      epoch = 2
      const restarted = new EncryptedOutbox(path, crypto)
      expect(await restarted.pending()).toHaveLength(1)
      await restarted.flush()

      expect(sent).toHaveLength(1)
      expect(sent[0].epoch).toBe(2)
      expect(Buffer.from(sent[0].ciphertext, 'base64').toString('utf8')).toContain('epoch:2:')
      expect(await restarted.pending()).toHaveLength(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
