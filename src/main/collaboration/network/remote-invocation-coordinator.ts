import { randomUUID } from 'node:crypto'
import type {
  CollaborationRemoteInvocationPayload,
  EmployeeInvocation,
  LocalCollaborationSnapshot,
  ReceptionEmployeePublication
} from '../../../shared/collaboration/contracts'
import type { ReceptionInvocationPort } from '../local-collaboration-service'
import {
  RemoteInvocationService,
  type PairwiseCryptoPort,
  type RemoteInvocationRequest
} from './remote-invocation-service'

export class RemoteInvocationCoordinator {
  constructor(private readonly options: {
    deviceId: string
    memberId: string
    crypto: PairwiseCryptoPort
    snapshot: () => Promise<LocalCollaborationSnapshot>
    gateway: ReceptionInvocationPort
    applyResponse: (input: {
      invocationId: string
      status: 'running' | 'completed' | 'failed' | 'interrupted'
      threadId?: string
      turnId?: string
      resultSummary?: string
      error?: string
    }) => Promise<void>
  }) {}

  publicKey(): Promise<string> {
    return this.options.crypto.publicKey()
  }

  async createRequest(
    publication: ReceptionEmployeePublication,
    invocation: EmployeeInvocation
  ): Promise<CollaborationRemoteInvocationPayload> {
    if (!invocation.meetingId || !publication.ownerEncryptionPublicKey) {
      throw new Error('Remote employee is missing its meeting scope or encryption key')
    }
    const service = new RemoteInvocationService({
      deviceId: this.options.deviceId,
      crypto: this.options.crypto,
      publications: [publication]
    })
    const request = await service.createRequest({
      invocationId: invocation.id,
      employeeId: publication.employeeId,
      meetingId: invocation.meetingId,
      requesterId: this.options.memberId,
      prompt: invocation.prompt,
      ownerPublicKey: publication.ownerEncryptionPublicKey
    })
    return { kind: 'remote_employee_request', commandId: randomUUID(), ...request }
  }

  async createControlRequest(
    publication: ReceptionEmployeePublication,
    invocation: EmployeeInvocation,
    action: 'inspect' | 'interrupt'
  ): Promise<CollaborationRemoteInvocationPayload> {
    if (!invocation.meetingId || !invocation.threadId || !invocation.turnId || !publication.ownerEncryptionPublicKey) {
      throw new Error('Remote invocation control state is incomplete')
    }
    const service = new RemoteInvocationService({
      deviceId: this.options.deviceId,
      crypto: this.options.crypto,
      publications: [publication]
    })
    const request = await service.createControlRequest({
      invocationId: invocation.id,
      employeeId: publication.employeeId,
      meetingId: invocation.meetingId,
      requesterId: this.options.memberId,
      ownerDeviceId: publication.ownerDeviceId,
      ownerPublicKey: publication.ownerEncryptionPublicKey,
      action,
      threadId: invocation.threadId,
      turnId: invocation.turnId
    })
    return { kind: 'remote_employee_request', commandId: randomUUID(), ...request }
  }

  async handle(payload: CollaborationRemoteInvocationPayload): Promise<CollaborationRemoteInvocationPayload | null> {
    if (payload.kind === 'remote_employee_response') {
      if (payload.requesterId !== this.options.memberId) return null
      const service = new RemoteInvocationService({
        deviceId: this.options.deviceId,
        crypto: this.options.crypto,
        publications: []
      })
      const response = await service.openResponse(payload, payload)
      await this.options.applyResponse({ invocationId: payload.invocationId, ...response })
      return null
    }
    if (payload.ownerDeviceId !== this.options.deviceId) return null
    const snapshot = await this.options.snapshot()
    const publication = snapshot.employees.find((item) => item.employeeId === payload.employeeId)
    if (!publication) throw new Error('Remote employee publication is unavailable on its owner device')
    const ownerPublication = {
      ...publication,
      ownerDeviceId: this.options.deviceId,
      ownerEncryptionPublicKey: await this.options.crypto.publicKey()
    }
    const service = new RemoteInvocationService({
      deviceId: this.options.deviceId,
      crypto: this.options.crypto,
      publications: [ownerPublication],
      gateway: this.options.gateway
    })
    const request = payload as RemoteInvocationRequest & typeof payload
    const response = await service.executeOwner(request)
    const encrypted = await service.encryptResponse(request, response)
    return {
      kind: 'remote_employee_response',
      commandId: randomUUID(),
      meetingId: payload.meetingId,
      requesterId: payload.requesterId,
      ownerDeviceId: payload.ownerDeviceId,
      ...encrypted
    }
  }
}
