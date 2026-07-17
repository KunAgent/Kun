import { describe, expect, it } from 'vitest'
import {
  HumanCollaborationCommandSchema,
  CollaborationNetworkCommandSchema,
  CollaborationNetworkStatusSchema,
  CollaborationRemoteInvocationPayloadSchema,
  EmployeeInvocationSchema,
  MeetingSchema,
  transitionHumanTask,
  type HumanCollaborationTask
} from './contracts'

describe('human collaboration contracts', () => {
  it('parses meetings independently from expert team plans', () => {
    expect(MeetingSchema.parse({
      id: 'm1', title: '发布评审会', status: 'active', members: [], tasks: [], timeline: [],
      createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z', version: 1
    }).status).toBe('active')
  })

  it('rejects invalid completed task transitions', () => {
    const task = taskWithStatus('completed')
    expect(() => transitionHumanTask(task, 'accept')).toThrow(/invalid human task transition/i)
  })

  it('parses reception invocation owner-gate state', () => {
    expect(EmployeeInvocationSchema.parse({
      id: 'i1', employeeId: 'e1', requesterId: 'local-user', ownerDeviceId: 'local',
      status: 'awaiting_owner', prompt: 'Review', allowedToolNames: ['read'],
      createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z'
    }).status).toBe('awaiting_owner')
  })

  it('keeps network security state and secrets in separate contracts', () => {
    expect(CollaborationNetworkStatusSchema.parse({
      state: 'ready', e2eeState: 'ready', serverUrl: 'https://collab.example.test',
      serverInstanceId: 'server-1', memberId: 'member-1', deviceId: 'device-1',
      protocol: 1, transport: 'tls13-spki', encryption: 'rfc9420-openmls'
    })).not.toHaveProperty('accessToken')
    expect(CollaborationNetworkCommandSchema.parse({
      kind: 'network_operator_enroll', serverUrl: 'https://collab.example.test',
      enrollmentToken: 'a'.repeat(32), displayName: 'Alice'
    })).toMatchObject({ kind: 'network_operator_enroll' })
    expect(CollaborationNetworkCommandSchema.parse({
      kind: 'network_join_approve', meetingId: 'meeting-1', invitationId: 'invite-1'
    })).toMatchObject({ kind: 'network_join_approve' })
    expect(CollaborationNetworkCommandSchema.parse({
      kind: 'network_member_remove', meetingId: 'meeting-1', memberId: 'member-2'
    })).toMatchObject({ kind: 'network_member_remove' })
    expect(CollaborationNetworkCommandSchema.parse({ kind: 'network_local_server_start' }))
      .toMatchObject({ kind: 'network_local_server_start' })
    expect(HumanCollaborationCommandSchema.parse({
      kind: 'meeting_member_remove', commandId: 'remove-1', meetingId: 'meeting-1', memberId: 'member-2'
    })).toMatchObject({ kind: 'meeting_member_remove' })
  })

  it('carries remote employee prompts only as pairwise ciphertext', () => {
    const payload = CollaborationRemoteInvocationPayloadSchema.parse({
      kind: 'remote_employee_request', commandId: 'command-remote', meetingId: 'meeting-1',
      version: 1, invocationId: 'invocation-1', employeeId: 'employee-1', requesterId: 'member-1',
      requesterPublicKey: 'requester-key', ownerDeviceId: 'owner-device', enc: 'ZW5j', ciphertext: 'Y2lwaGVydGV4dA=='
    })
    expect(payload).not.toHaveProperty('prompt')
  })
})

function taskWithStatus(status: HumanCollaborationTask['status']): HumanCollaborationTask {
  return {
    id: 't1', meetingId: 'm1', title: 'Task', description: '', creatorId: 'u1', targetMemberIds: ['u2'],
    status, participants: [], progress: [], deliveries: [], createdAt: '', updatedAt: '', version: 1
  }
}
