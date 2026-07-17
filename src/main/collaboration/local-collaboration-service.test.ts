import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LocalCollaborationStore } from './local-collaboration-store'
import { LocalCollaborationService } from './local-collaboration-service'

describe('LocalCollaborationService', () => {
  it('persists meetings and replays duplicate commands idempotently', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-human-collab-'))
    try {
      const service = new LocalCollaborationService(new LocalCollaborationStore(dataDir))
      const command = { kind: 'meeting_create' as const, commandId: 'cmd-1', title: '发布评审会', description: '' }
      const first = await service.dispatch(command)
      const replay = await service.dispatch(command)
      expect(replay).toEqual(first)
      await service.dispatch({
        kind: 'meeting_member_upsert', commandId: 'member-1', meetingId: (first as { id: string }).id,
        memberId: 'member-remote', displayName: 'Remote member', role: 'reviewer', status: 'online'
      })

      const restarted = new LocalCollaborationService(new LocalCollaborationStore(dataDir))
      const restored = await restarted.getSnapshot()
      expect(restored.meetings.map((meeting) => meeting.id)).toContain((first as { id: string }).id)
      expect(restored.meetings[0].members).toContainEqual(expect.objectContaining({ id: 'member-remote', role: 'reviewer' }))

      await restarted.dispatch({
        kind: 'meeting_member_remove', commandId: 'member-remove-1',
        meetingId: (first as { id: string }).id, memberId: 'member-remote'
      })
      expect((await restarted.getSnapshot()).meetings[0].members).not.toContainEqual(
        expect.objectContaining({ id: 'member-remote' })
      )
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('persists a real reception turn and interrupts it through the gateway', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-human-collab-'))
    const gateway = {
      invoke: vi.fn(async () => ({
        status: 'running' as const,
        ownerDeviceId: 'local',
        threadId: 'thread-1',
        turnId: 'turn-1',
        allowedToolNames: ['read']
      })),
      interrupt: vi.fn(async () => undefined),
      inspect: vi.fn(async () => ({ status: 'running' as const }))
    }
    try {
      const service = new LocalCollaborationService(new LocalCollaborationStore(dataDir), gateway)
      await service.dispatch({
        kind: 'employee_publish', commandId: 'publish-1', employeeId: 'employee-1',
        displayName: 'Reviewer', description: '', allowedToolNames: ['read', 'write'], meetingIds: [], taskIds: []
      })
      const invocation = await service.dispatch({
        kind: 'employee_invoke', commandId: 'invoke-1', employeeId: 'employee-1', prompt: 'Review this'
      }) as { id: string; status: string; threadId?: string; turnId?: string }

      expect(invocation).toMatchObject({ status: 'running', threadId: 'thread-1', turnId: 'turn-1' })
      expect(gateway.invoke).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Review this',
        publication: expect.objectContaining({ employeeId: 'employee-1' })
      }))

      await service.dispatch({ kind: 'employee_interrupt', commandId: 'interrupt-1', invocationId: invocation.id })
      expect(gateway.interrupt).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'turn-1' })
      expect((await service.getSnapshot()).invocations[0]).toMatchObject({ status: 'interrupted' })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('reconciles completed reception turns while loading the snapshot', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-human-collab-'))
    const gateway = {
      invoke: vi.fn(async () => ({
        status: 'running' as const, ownerDeviceId: 'local', threadId: 'thread-2', turnId: 'turn-2', allowedToolNames: ['read']
      })),
      interrupt: vi.fn(async () => undefined),
      inspect: vi.fn(async () => ({ status: 'completed' as const, resultSummary: 'Review complete' }))
    }
    try {
      const service = new LocalCollaborationService(new LocalCollaborationStore(dataDir), gateway)
      await service.dispatch({
        kind: 'employee_publish', commandId: 'publish-2', employeeId: 'employee-2',
        displayName: 'Reviewer', description: '', allowedToolNames: ['read'], meetingIds: [], taskIds: []
      })
      await service.dispatch({
        kind: 'employee_invoke', commandId: 'invoke-2', employeeId: 'employee-2', prompt: 'Review this'
      })

      const snapshot = await service.getSnapshot()

      expect(snapshot.invocations[0]).toMatchObject({ status: 'completed', resultSummary: 'Review complete' })
      expect(snapshot.employees[0]).toMatchObject({ status: 'available' })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('preserves remote publication scope and never executes it on the requester device', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-human-collab-'))
    const gateway = {
      invoke: vi.fn(), interrupt: vi.fn(), inspect: vi.fn()
    }
    try {
      const service = new LocalCollaborationService(new LocalCollaborationStore(dataDir), gateway)
      const publication = await service.dispatch({
        kind: 'employee_publish', commandId: 'publish-remote', employeeId: 'employee-remote',
        displayName: 'Remote reviewer', description: '', allowedToolNames: ['read'],
        ownerDeviceId: 'device-owner', ownerEncryptionPublicKey: 'owner-hpke-key',
        meetingIds: ['meeting-1'], taskIds: []
      })
      const invocation = await service.dispatch({
        kind: 'employee_invoke', commandId: 'invoke-remote', employeeId: 'employee-remote',
        prompt: 'Review remotely', meetingId: 'meeting-1'
      })

      expect(publication).toMatchObject({
        ownerDeviceId: 'device-owner', ownerEncryptionPublicKey: 'owner-hpke-key', meetingIds: ['meeting-1']
      })
      expect(invocation).toMatchObject({ status: 'awaiting_owner', meetingId: 'meeting-1' })
      expect(gateway.invoke).not.toHaveBeenCalled()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
