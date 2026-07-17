import { describe, expect, it, vi } from 'vitest'
import type { ReceptionEmployeePublication } from '../../../shared/collaboration/contracts'
import { PairwiseHpke, RemoteInvocationService } from './remote-invocation-service'

const publication: ReceptionEmployeePublication = {
  id: 'publication-1', employeeId: 'employee-1', displayName: 'Reviewer', description: 'Release review',
  ownerDeviceId: 'owner-device', allowedToolNames: ['read'], status: 'available',
  meetingIds: ['meeting-1'], taskIds: [], updatedAt: '2026-07-17T00:00:00.000Z'
}

describe('RemoteInvocationService', () => {
  it('rejects unpublished employees and out-of-scope meetings', async () => {
    const crypto = await PairwiseHpke.generate()
    const service = new RemoteInvocationService({
      deviceId: 'caller-device', crypto, publications: [], gateway: undefined
    })
    await expect(service.createRequest({
      employeeId: 'missing', meetingId: 'meeting-1', requesterId: 'member-a', prompt: 'Review',
      ownerPublicKey: await crypto.publicKey()
    })).rejects.toMatchObject({ code: 'employee_not_published' })
  })

  it('encrypts caller-owner content and executes only on the owner device', async () => {
    const callerCrypto = await PairwiseHpke.generate()
    const ownerCrypto = await PairwiseHpke.generate()
    const gateway = {
      invoke: vi.fn(async () => ({
        status: 'running' as const, ownerDeviceId: 'owner-device', threadId: 'thread-1', turnId: 'turn-1', allowedToolNames: ['read']
      })),
      interrupt: vi.fn(),
      inspect: vi.fn(async () => ({ status: 'running' as const }))
    }
    const caller = new RemoteInvocationService({ deviceId: 'caller-device', crypto: callerCrypto, publications: [publication] })
    const owner = new RemoteInvocationService({ deviceId: 'owner-device', crypto: ownerCrypto, publications: [publication], gateway })
    const request = await caller.createRequest({
      employeeId: 'employee-1', meetingId: 'meeting-1', requesterId: 'member-a', prompt: 'Review secret release',
      ownerPublicKey: await ownerCrypto.publicKey()
    })

    expect(JSON.stringify(request)).not.toContain('Review secret release')
    const response = await owner.executeOwner(request)

    expect(response).toMatchObject({ status: 'running', ownerDeviceId: 'owner-device', threadId: 'thread-1', turnId: 'turn-1' })
    expect(response).not.toHaveProperty('toolSchemas')
    expect(response).not.toHaveProperty('credentialSourceId')
    expect(gateway.invoke).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Review secret release', publication: expect.objectContaining({ employeeId: 'employee-1' })
    }))
    const encryptedResponse = await owner.encryptResponse(request, response)
    expect(JSON.stringify(encryptedResponse)).not.toContain('thread-1')
    await expect(caller.openResponse(request, encryptedResponse)).resolves.toMatchObject({
      status: 'running', threadId: 'thread-1'
    })
    await expect(caller.executeOwner(request)).rejects.toMatchObject({ code: 'owner_device_required' })
  })
})
