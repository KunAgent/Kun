import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CollaborationHttpClient, ServerPinStore } from './collaboration-transport'

describe('ServerPinStore', () => {
  it('pins the server instance and SPKI and rejects silent replacement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-collab-pins-'))
    try {
      const store = new ServerPinStore(join(directory, 'pins.json'))
      await expect(store.verify({
        serverUrl: 'https://collab.example.test', serverInstanceId: 'server-1', spkiSha256: 'a'.repeat(64)
      })).resolves.toMatchObject({ trusted: true, firstUse: true })
      await expect(store.verify({
        serverUrl: 'https://collab.example.test', serverInstanceId: 'server-2', spkiSha256: 'b'.repeat(64)
      })).rejects.toMatchObject({ code: 'server_identity_changed' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('maps authenticated control-plane calls without exposing credentials in payloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-collab-http-'))
    try {
      const calls: Array<{ path: string; method: string; bearer?: string; body?: unknown }> = []
      const client = new CollaborationHttpClient({
        pins: new ServerPinStore(join(directory, 'pins.json')),
        inspect: async () => ({ spkiSha256: 'a'.repeat(64) }),
        request: async (request) => {
          calls.push(request)
          if (request.path === '/health') {
            return { ok: true, protocol: 1, serverInstanceId: 'server-1', receiptVerifyingKey: 'verify-key' }
          }
          if (request.path.endsWith('/invitations')) {
            return {
              invitationId: 'invite-1', meetingId: 'meeting-1', role: 'member',
              oneTimeCredential: 'a'.repeat(43), expiresAt: 1_800_000_000
            }
          }
          if (request.path.endsWith('/join-requests')) {
            return { requests: [{
              invitationId: 'invite-1', meetingId: 'meeting-1', memberId: 'member-2',
              deviceId: 'device-2', displayName: 'Bob', role: 'member', keyPackage: 'a2V5LXBhY2thZ2U='
            }] }
          }
          if (request.path === '/v1/admissions/invite-1') {
            return { status: 'ready', meetingId: 'meeting-1', welcome: 'd2VsY29tZQ==', ratchetTree: 'dHJlZQ==', throughSequence: 2 }
          }
          return { memberId: 'member-1', deviceId: 'device-1', accessToken: 'd'.repeat(43) }
        }
      })

      await expect(client.connect('https://collab.example.test')).resolves.toMatchObject({
        serverInstanceId: 'server-1', spkiSha256: 'a'.repeat(64)
      })
      await client.enrollOperator({
        serverUrl: 'https://collab.example.test', enrollmentToken: 'enrollment-secret',
        memberId: 'member-1', deviceId: 'device-1', displayName: 'Alice'
      })
      const invitation = await client.createInvitation({
        serverUrl: 'https://collab.example.test', accessToken: 'd'.repeat(43), meetingId: 'meeting-1',
        role: 'member', expiresInSeconds: 600
      })

      expect(invitation).toMatchObject({
        version: 1, invitationId: 'invite-1', serverInstanceId: 'server-1',
        spkiSha256: 'a'.repeat(64), oneTimeCredential: 'a'.repeat(43)
      })
      expect(calls.find((call) => call.path === '/v1/operator/enroll')).toMatchObject({
        bearer: 'enrollment-secret',
        body: { memberId: 'member-1', deviceId: 'device-1', displayName: 'Alice' }
      })
      expect(calls.find((call) => call.path.endsWith('/invitations'))).toMatchObject({
        bearer: 'd'.repeat(43), body: { role: 'member', expiresInSeconds: 600 }
      })
      expect(JSON.stringify(calls.map((call) => call.body))).not.toContain('d'.repeat(43))

      await expect(client.listJoinRequests({
        serverUrl: 'https://collab.example.test', accessToken: 'd'.repeat(43), meetingId: 'meeting-1'
      })).resolves.toHaveLength(1)
      await client.admitJoinRequest({
        serverUrl: 'https://collab.example.test', accessToken: 'd'.repeat(43), meetingId: 'meeting-1',
        invitationId: 'invite-1', welcome: 'd2VsY29tZQ==', ratchetTree: 'dHJlZQ==', throughSequence: 2
      })
      await client.removeMember({
        serverUrl: 'https://collab.example.test', accessToken: 'd'.repeat(43),
        meetingId: 'meeting-1', memberId: 'member-2'
      })
      expect(calls.find((call) => call.path.endsWith('/members/member-2/remove'))).toMatchObject({
        method: 'POST', bearer: 'd'.repeat(43)
      })
      await expect(client.getAdmission({
        serverUrl: 'https://collab.example.test', accessToken: 'd'.repeat(43), invitationId: 'invite-1'
      })).resolves.toMatchObject({ status: 'ready', welcome: 'd2VsY29tZQ==' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
