import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MlsNetworkSecurity } from './mls-network-security'

describe('MlsNetworkSecurity', () => {
  it('verifies signed receipts and blocks persistent sync on tampering', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-mls-sync-'))
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const rawPublicKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')
    const membership = {
      createOwnerMeeting: vi.fn(), prepareJoin: vi.fn(), approveJoin: vi.fn(), completeJoin: vi.fn(),
      removeMember: vi.fn(),
      latestStatus: vi.fn(async () => null),
      encrypt: vi.fn(async (_meetingId, plaintext: Buffer) => plaintext),
      decrypt: vi.fn(async () => Buffer.from(JSON.stringify({
        kind: 'human_task_progress', commandId: 'remote-command', meetingId: 'meeting-1',
        taskId: 'task-1', summary: 'Remote progress', percent: 40
      }))),
      processCommit: vi.fn(async () => undefined),
      epoch: vi.fn(async () => 1)
    }
    try {
      const security = new MlsNetworkSecurity({ membership, syncPath: join(directory, 'sync.json') })
      const event = {
        receipt: {
          commandId: 'command-1', meetingId: 'meeting-1', sequence: 1,
          acceptedAt: '2026-07-17T00:00:00.000Z', serverInstanceId: 'server-1', signature: ''
        },
        memberId: 'member-2', epoch: 1, frameKind: 'mls_application',
        ciphertext: 'b3BhcXVl', ciphertextSha256: 'a'.repeat(64)
      }
      const signatureInput = `command-1\nmeeting-1\n1\n1\n${'a'.repeat(64)}`
      event.receipt.signature = sign(null, Buffer.from(signatureInput), privateKey).toString('base64')
      const credential = {
        serverUrl: 'https://collab.example.test', serverInstanceId: 'server-1', spkiSha256: 'b'.repeat(64),
        receiptVerifyingKey: rawPublicKey, memberId: 'member-1', deviceId: 'device-1',
        displayName: 'Alice', accessToken: 'secret'
      }

      await expect(security.syncMeeting({ meetingId: 'meeting-1', events: [event], credential }))
        .resolves.toMatchObject({ state: 'ready', lastVerifiedSequence: 1, commands: [
          expect.objectContaining({ commandId: 'remote-command' })
        ] })
      event.receipt.sequence = 2
      event.receipt.signature = Buffer.from('tampered').toString('base64')
      await expect(security.syncMeeting({ meetingId: 'meeting-1', events: [event], credential }))
        .resolves.toMatchObject({ state: 'SECURITY_SYNC_REQUIRED', lastVerifiedSequence: 1 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
