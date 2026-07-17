import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { InvitationService } from './invitation-service'

describe('InvitationService', () => {
  it('creates and consumes a meeting invitation exactly once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-collab-invites-'))
    const membership = { join: vi.fn(async () => ({ memberId: 'member-b', status: 'joined' as const })) }
    try {
      const service = new InvitationService({
        statePath: join(directory, 'invitations.json'),
        membership,
        now: () => new Date('2026-07-17T00:00:00.000Z')
      })
      const invitation = await service.create({
        serverUrl: 'https://collab.example.test', serverInstanceId: 'server-1', spkiSha256: 'a'.repeat(64),
        meetingId: 'meeting-1', inviterMemberId: 'member-a', expiresInMs: 60_000
      })

      await expect(service.consume(invitation, { displayName: 'Bob' })).resolves.toMatchObject({ status: 'joined' })
      await expect(service.consume(invitation, { displayName: 'Bob' })).rejects.toMatchObject({
        code: 'invitation_consumed'
      })
      expect(membership.join).toHaveBeenCalledWith(expect.objectContaining({
        meetingId: 'meeting-1', displayName: 'Bob', role: 'member'
      }))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects expired invitations before membership changes', async () => {
    const membership = { join: vi.fn() }
    const service = new InvitationService({
      statePath: join(tmpdir(), `kun-invite-${Date.now()}.json`),
      membership,
      now: () => new Date('2026-07-18T00:00:00.000Z')
    })
    await expect(service.consume({
      version: 1, invitationId: 'invite-1', serverUrl: 'https://collab.example.test',
      serverInstanceId: 'server-1', spkiSha256: 'a'.repeat(64), meetingId: 'meeting-1',
      oneTimeCredential: Buffer.from('secret credential').toString('base64'),
      expiresAt: '2026-07-17T00:00:00.000Z'
    }, { displayName: 'Bob' })).rejects.toMatchObject({ code: 'invitation_expired' })
    expect(membership.join).not.toHaveBeenCalled()
  })
})
