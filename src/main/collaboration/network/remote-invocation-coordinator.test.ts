import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { EmployeeInvocation, LocalCollaborationSnapshot, ReceptionEmployeePublication } from '../../../shared/collaboration/contracts'
import { TaskKeyService } from '../crypto/task-key-service'
import { RemoteInvocationCoordinator } from './remote-invocation-coordinator'

describe('RemoteInvocationCoordinator', () => {
  it('routes pairwise ciphertext to the owner gateway and encrypts the response', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-remote-coordinator-'))
    try {
      const callerKeys = await TaskKeyService.open(join(directory, 'caller.json'), Buffer.alloc(32, 1))
      const ownerKeys = await TaskKeyService.open(join(directory, 'owner.json'), Buffer.alloc(32, 2))
      const ownerPublication: ReceptionEmployeePublication = {
        id: 'publication-1', employeeId: 'employee-1', displayName: 'Reviewer', description: '',
        ownerDeviceId: 'local', ownerEncryptionPublicKey: await ownerKeys.publicKey(),
        allowedToolNames: ['read'], status: 'available', meetingIds: ['meeting-1'], taskIds: [],
        updatedAt: '2026-07-17T00:00:00.000Z'
      }
      const callerPublication = { ...ownerPublication, ownerDeviceId: 'owner-device' }
      const invocation: EmployeeInvocation = {
        id: 'invocation-1', employeeId: 'employee-1', requesterId: 'member-caller', ownerDeviceId: 'owner-device',
        status: 'awaiting_owner', prompt: 'Review private release', allowedToolNames: ['read'], meetingId: 'meeting-1',
        createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z'
      }
      const gateway = {
        invoke: vi.fn(async () => ({
          status: 'running' as const, ownerDeviceId: 'owner-device', threadId: 'thread-1', turnId: 'turn-1', allowedToolNames: ['read']
        })),
        interrupt: vi.fn(async () => undefined),
        inspect: vi.fn(async () => ({ status: 'completed' as const, resultSummary: 'Review complete' }))
      }
      const applied = vi.fn(async () => undefined)
      const empty = (): LocalCollaborationSnapshot => ({ version: 1, meetings: [], employees: [], invocations: [], commandResults: {} })
      const caller = new RemoteInvocationCoordinator({
        deviceId: 'caller-device', memberId: 'member-caller', crypto: callerKeys,
        snapshot: async () => empty(), gateway, applyResponse: applied
      })
      const owner = new RemoteInvocationCoordinator({
        deviceId: 'owner-device', memberId: 'member-owner', crypto: ownerKeys,
        snapshot: async () => ({ ...empty(), employees: [ownerPublication] }), gateway, applyResponse: vi.fn()
      })

      const request = await caller.createRequest(callerPublication, invocation)
      expect(JSON.stringify(request)).not.toContain('Review private release')
      const response = await owner.handle(request)
      expect(JSON.stringify(response)).not.toContain('thread-1')
      await caller.handle(response!)

      expect(gateway.invoke).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Review private release' }))
      expect(applied).toHaveBeenCalledWith(expect.objectContaining({ invocationId: 'invocation-1', status: 'running' }))

      const running = { ...invocation, status: 'running' as const, threadId: 'thread-1', turnId: 'turn-1' }
      const statusRequest = await caller.createControlRequest(callerPublication, running, 'inspect')
      const completedResponse = await owner.handle(statusRequest)
      await caller.handle(completedResponse!)
      expect(gateway.inspect).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'turn-1' })
      expect(applied).toHaveBeenCalledWith(expect.objectContaining({
        invocationId: 'invocation-1', status: 'completed', resultSummary: 'Review complete'
      }))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
