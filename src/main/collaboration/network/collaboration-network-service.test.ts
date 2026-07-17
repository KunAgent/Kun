import { describe, expect, it, vi } from 'vitest'
import { CollaborationNetworkService } from './collaboration-network-service'
import type { NetworkCredential } from './network-credential-vault'

describe('CollaborationNetworkService', () => {
  it('composes identity, pinned transport and MLS membership without returning secrets', async () => {
    let acceptedSequence = 0
    let credential: NetworkCredential | null = null
    const vault = {
      put: vi.fn(async (value) => { credential = value }),
      get: vi.fn(async () => credential),
      list: vi.fn(async () => {
        if (!credential) return []
        const { accessToken: _accessToken, ...summary } = credential
        return [summary]
      })
    }
    const http = {
      connect: vi.fn(async () => ({
        serverUrl: 'https://collab.example.test', serverInstanceId: 'server-1',
        spkiSha256: 'a'.repeat(64), receiptVerifyingKey: 'verify-key'
      })),
      enrollOperator: vi.fn(async () => ({ memberId: 'member-1', deviceId: 'device-1', accessToken: 'secret-token' })),
      createMeeting: vi.fn(async () => undefined),
      createInvitation: vi.fn(async () => ({
        version: 1 as const, invitationId: 'invite-1', serverUrl: 'https://collab.example.test',
        serverInstanceId: 'server-1', spkiSha256: 'a'.repeat(64), meetingId: 'meeting-1',
        oneTimeCredential: 'a'.repeat(43), expiresAt: '2026-07-18T00:00:00.000Z'
      })),
      consumeInvitation: vi.fn(),
      listEvents: vi.fn(async () => []),
      listJoinRequests: vi.fn(async () => [{
        invitationId: 'invite-1', meetingId: 'meeting-1', memberId: 'member-2',
        deviceId: 'device-2', displayName: 'Bob', role: 'member', keyPackage: 'a2V5LXBhY2thZ2U='
      }]),
      admitJoinRequest: vi.fn(async () => undefined),
      removeMember: vi.fn(async () => undefined),
      getAdmission: vi.fn(),
      submitCommand: vi.fn(async () => ({ sequence: ++acceptedSequence }))
    }
    const security = {
      createOwnerMeeting: vi.fn(async () => undefined),
      prepareJoin: vi.fn(),
      completeJoin: vi.fn(),
      approveJoin: vi.fn(async () => ({ welcome: 'd2VsY29tZQ==', ratchetTree: 'dHJlZQ==', commit: 'Y29tbWl0', epoch: 2 })),
      removeMember: vi.fn(async () => ({ commit: 'cmVtb3ZlLWNvbW1pdA==', epoch: 3 })),
      membershipStatus: vi.fn(async () => null),
      sealCommand: vi.fn(async () => ({ ciphertext: 'b3BhcXVl', epoch: 1 })),
      sealPayload: vi.fn(async () => ({ ciphertext: 'b3BhcXVl', epoch: 1 })),
      acceptOwnFrame: vi.fn(async () => undefined),
      syncMeeting: vi.fn(async () => ({ state: 'ready' as const, lastVerifiedSequence: 0, commands: [] }))
    }
    const projection = { apply: vi.fn(async () => undefined) }
    const service = new CollaborationNetworkService({
      identity: { loadOrCreate: vi.fn(async () => ({ memberId: 'member-1', deviceId: 'device-1' })) },
      vault, http, security, projection
    })

    const connected = await service.dispatch({
      kind: 'network_operator_enroll', serverUrl: 'https://collab.example.test',
      enrollmentToken: 'e'.repeat(32), displayName: 'Alice'
    })
    expect(connected).toMatchObject({ state: 'ready', e2eeState: 'setup_required' })
    expect(connected).not.toHaveProperty('accessToken')

    await service.dispatch({ kind: 'network_meeting_enable', meetingId: 'meeting-1' })
    const invitation = await service.dispatch({
      kind: 'network_invitation_create', meetingId: 'meeting-1', role: 'member', expiresInSeconds: 600
    })
    expect(invitation).toMatchObject({ invitationId: 'invite-1' })
    expect(security.createOwnerMeeting).toHaveBeenCalledWith('meeting-1', expect.objectContaining({ memberId: 'member-1' }))
    expect(http.createMeeting).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'secret-token' }))
    await service.publishLocalCommand({
      kind: 'human_task_progress', commandId: 'command-1', meetingId: 'meeting-1',
      taskId: 'task-1', summary: 'Local progress', percent: 50
    })
    expect(http.submitCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ frameKind: 'mls_application', commandId: 'command-1' })
    }))
    await service.publishLocalCommand({
      kind: 'employee_publish', commandId: 'publish-1', employeeId: 'employee-1',
      displayName: 'Reviewer', description: '', allowedToolNames: ['read'],
      meetingIds: ['meeting-1'], taskIds: []
    })
    expect(security.sealCommand).toHaveBeenCalledWith('meeting-1', expect.objectContaining({
      ownerDeviceId: 'device-1', meetingIds: ['meeting-1']
    }))
    await expect(service.dispatch({ kind: 'network_join_requests', meetingId: 'meeting-1' })).resolves.toHaveLength(1)
    await service.dispatch({ kind: 'network_join_approve', meetingId: 'meeting-1', invitationId: 'invite-1' })
    expect(security.approveJoin).toHaveBeenCalledWith('meeting-1', 'a2V5LXBhY2thZ2U=')
    expect(http.submitCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ frameKind: 'mls_commit', ciphertext: 'Y29tbWl0' })
    }))
    expect(http.admitJoinRequest).toHaveBeenCalledWith(expect.objectContaining({
      invitationId: 'invite-1', throughSequence: 3
    }))
    expect(projection.apply).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'meeting_member_upsert', memberId: 'member-2', displayName: 'Bob'
    }))
    await service.dispatch({ kind: 'network_member_remove', meetingId: 'meeting-1', memberId: 'member-2' })
    expect(security.removeMember).toHaveBeenCalledWith('meeting-1', 'member-2')
    expect(http.submitCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ frameKind: 'mls_commit', ciphertext: 'cmVtb3ZlLWNvbW1pdA==' })
    }))
    expect(http.removeMember).toHaveBeenCalledWith(expect.objectContaining({
      meetingId: 'meeting-1', memberId: 'member-2'
    }))
    expect(projection.apply).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'meeting_member_remove', memberId: 'member-2'
    }))
    expect(await service.getStatus()).toMatchObject({ e2eeState: 'ready', activeMeetingId: 'meeting-1' })
  })
})
