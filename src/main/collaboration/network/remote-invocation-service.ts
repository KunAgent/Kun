import { randomUUID } from 'node:crypto'
import { Aes128Gcm, CipherSuite, HkdfSha256 } from '@hpke/core'
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519'
import { z } from 'zod'
import type { ReceptionEmployeePublication } from '../../../shared/collaboration/contracts'
import type { ReceptionInvocationInspection, ReceptionInvocationStart } from '../reception-invocation-gateway'

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm()
})

const PayloadSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invoke'), prompt: z.string().min(1).max(200_000) }).strict(),
  z.object({ action: z.enum(['inspect', 'interrupt']), threadId: z.string().min(1), turnId: z.string().min(1) }).strict()
])
const ResponseSchema = z.object({
  status: z.enum(['awaiting_owner', 'running', 'completed', 'failed', 'interrupted']),
  ownerDeviceId: z.string().min(1),
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  resultSummary: z.string().optional(),
  error: z.string().optional()
}).strict()

export type RemoteInvocationRequest = {
  version: 1
  invocationId: string
  employeeId: string
  meetingId: string
  requesterId: string
  requesterPublicKey: string
  ownerDeviceId: string
  enc: string
  ciphertext: string
}

export type RemoteInvocationResponse =
  | Pick<ReceptionInvocationStart, 'status' | 'ownerDeviceId' | 'threadId' | 'turnId'>
  | ({ ownerDeviceId: string } & Exclude<ReceptionInvocationInspection, { status: 'running' }>)
export type EncryptedRemoteInvocationResponse = {
  version: 1
  invocationId: string
  enc: string
  ciphertext: string
}

export class RemoteInvocationError extends Error {
  constructor(
    readonly code:
      | 'employee_not_published'
      | 'employee_scope_denied'
      | 'owner_device_required'
      | 'owner_offline'
      | 'remote_invocation_invalid',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'RemoteInvocationError'
  }
}

export class PairwiseHpke {
  private constructor(private readonly keys: CryptoKeyPair) {}

  static async generate(): Promise<PairwiseHpke> {
    return new PairwiseHpke(await suite.kem.generateKeyPair())
  }

  async publicKey(): Promise<string> {
    return Buffer.from(await suite.kem.serializePublicKey(this.keys.publicKey)).toString('base64')
  }

  async sealTo(publicKey: string, plaintext: Buffer, info: Buffer): Promise<{ enc: string; ciphertext: string }> {
    const recipientPublicKey = await suite.kem.deserializePublicKey(Buffer.from(publicKey, 'base64'))
    const sender = await suite.createSenderContext({ recipientPublicKey, info })
    return {
      enc: Buffer.from(sender.enc).toString('base64'),
      ciphertext: Buffer.from(await sender.seal(plaintext)).toString('base64')
    }
  }

  async open(input: { enc: string; ciphertext: string }, info: Buffer): Promise<Buffer> {
    const recipient = await suite.createRecipientContext({
      recipientKey: this.keys.privateKey,
      enc: Buffer.from(input.enc, 'base64'),
      info
    })
    return Buffer.from(await recipient.open(Buffer.from(input.ciphertext, 'base64')))
  }
}

export type PairwiseCryptoPort = {
  publicKey(): Promise<string>
  sealTo(publicKey: string, plaintext: Buffer, info: Buffer): Promise<{ enc: string; ciphertext: string }>
  open(input: { enc: string; ciphertext: string }, info: Buffer): Promise<Buffer>
}

type OwnerGateway = {
  invoke(input: { publication: ReceptionEmployeePublication; prompt: string }): Promise<ReceptionInvocationStart>
  interrupt(input: { threadId: string; turnId: string }): Promise<void>
  inspect(input: { threadId: string; turnId: string }): Promise<ReceptionInvocationInspection>
}

export class RemoteInvocationService {
  constructor(private readonly options: {
    deviceId: string
    crypto: PairwiseCryptoPort
    publications: ReceptionEmployeePublication[]
    gateway?: OwnerGateway
  }) {}

  async createRequest(input: {
    invocationId?: string
    employeeId: string
    meetingId: string
    requesterId: string
    prompt: string
    ownerPublicKey: string
  }): Promise<RemoteInvocationRequest> {
    const publication = this.requirePublication(input.employeeId)
    if (!publication.meetingIds.includes(input.meetingId)) {
      throw new RemoteInvocationError('employee_scope_denied', 'Reception employee is not published to this meeting')
    }
    const invocationId = input.invocationId ?? randomUUID()
    const metadata = {
      invocationId,
      employeeId: publication.employeeId,
      meetingId: input.meetingId,
      requesterId: input.requesterId,
      ownerDeviceId: publication.ownerDeviceId
    }
    const requesterPublicKey = await this.options.crypto.publicKey()
    const encrypted = await this.options.crypto.sealTo(
      input.ownerPublicKey,
      Buffer.from(JSON.stringify(PayloadSchema.parse({ action: 'invoke', prompt: input.prompt })), 'utf8'),
      invocationInfo(metadata)
    )
    return { version: 1, ...metadata, requesterPublicKey, ...encrypted }
  }

  async createControlRequest(input: {
    invocationId: string
    employeeId: string
    meetingId: string
    requesterId: string
    ownerDeviceId: string
    ownerPublicKey: string
    action: 'inspect' | 'interrupt'
    threadId: string
    turnId: string
  }): Promise<RemoteInvocationRequest> {
    const publication = this.requirePublication(input.employeeId)
    if (publication.ownerDeviceId !== input.ownerDeviceId || !publication.meetingIds.includes(input.meetingId)) {
      throw new RemoteInvocationError('employee_scope_denied', 'Remote employee control scope is invalid')
    }
    const metadata = {
      invocationId: input.invocationId,
      employeeId: input.employeeId,
      meetingId: input.meetingId,
      requesterId: input.requesterId,
      ownerDeviceId: input.ownerDeviceId
    }
    const encrypted = await this.options.crypto.sealTo(
      input.ownerPublicKey,
      Buffer.from(JSON.stringify(PayloadSchema.parse({
        action: input.action,
        threadId: input.threadId,
        turnId: input.turnId
      })), 'utf8'),
      invocationInfo(metadata)
    )
    return { version: 1, ...metadata, requesterPublicKey: await this.options.crypto.publicKey(), ...encrypted }
  }

  async executeOwner(request: RemoteInvocationRequest): Promise<RemoteInvocationResponse> {
    const publication = this.requirePublication(request.employeeId)
    if (publication.ownerDeviceId !== this.options.deviceId || request.ownerDeviceId !== this.options.deviceId) {
      throw new RemoteInvocationError('owner_device_required', 'Remote employee execution is restricted to its owner device')
    }
    if (!publication.meetingIds.includes(request.meetingId)) {
      throw new RemoteInvocationError('employee_scope_denied', 'Reception employee is no longer published to this meeting')
    }
    if (!this.options.gateway) {
      throw new RemoteInvocationError('owner_offline', 'Owner confirmation is required before this invocation can run')
    }
    try {
      const plaintext = await this.options.crypto.open(
        request,
        invocationInfo(request)
      )
      const payload = PayloadSchema.parse(JSON.parse(plaintext.toString('utf8')))
      if (payload.action === 'invoke') {
        const started = await this.options.gateway.invoke({ publication, prompt: payload.prompt })
        return {
          status: started.status,
          ownerDeviceId: started.ownerDeviceId,
          threadId: started.threadId,
          turnId: started.turnId
        }
      }
      if (payload.action === 'interrupt') {
        await this.options.gateway.interrupt({ threadId: payload.threadId, turnId: payload.turnId })
        return { status: 'interrupted', ownerDeviceId: this.options.deviceId }
      }
      const inspection = await this.options.gateway.inspect({ threadId: payload.threadId, turnId: payload.turnId })
      return inspection.status === 'running'
        ? { ...inspection, ownerDeviceId: this.options.deviceId, threadId: payload.threadId, turnId: payload.turnId }
        : { ...inspection, ownerDeviceId: this.options.deviceId }
    } catch (cause) {
      if (cause instanceof RemoteInvocationError) throw cause
      throw new RemoteInvocationError('remote_invocation_invalid', 'Encrypted remote invocation could not be opened', { cause })
    }
  }

  async encryptResponse(
    request: RemoteInvocationRequest,
    response: RemoteInvocationResponse
  ): Promise<EncryptedRemoteInvocationResponse> {
    if (request.ownerDeviceId !== this.options.deviceId) {
      throw new RemoteInvocationError('owner_device_required', 'Only the owner device can encrypt a remote response')
    }
    const encrypted = await this.options.crypto.sealTo(
      request.requesterPublicKey,
      Buffer.from(JSON.stringify(ResponseSchema.parse(response)), 'utf8'),
      responseInfo(request)
    )
    return { version: 1, invocationId: request.invocationId, ...encrypted }
  }

  async openResponse(
    request: Pick<RemoteInvocationRequest, 'invocationId' | 'requesterId' | 'ownerDeviceId'>,
    response: EncryptedRemoteInvocationResponse
  ): Promise<RemoteInvocationResponse> {
    if (request.invocationId !== response.invocationId) {
      throw new RemoteInvocationError('remote_invocation_invalid', 'Remote invocation response id does not match')
    }
    try {
      const plaintext = await this.options.crypto.open(response, responseInfo(request))
      return ResponseSchema.parse(JSON.parse(plaintext.toString('utf8'))) as RemoteInvocationResponse
    } catch (cause) {
      if (cause instanceof RemoteInvocationError) throw cause
      throw new RemoteInvocationError('remote_invocation_invalid', 'Encrypted remote response could not be opened', { cause })
    }
  }

  private requirePublication(employeeId: string): ReceptionEmployeePublication {
    const publication = this.options.publications.find((item) => item.employeeId === employeeId)
    if (!publication) throw new RemoteInvocationError('employee_not_published', 'Reception employee is not published')
    return publication
  }
}

function invocationInfo(input: {
  invocationId: string
  employeeId: string
  meetingId: string
  requesterId: string
  ownerDeviceId: string
}): Buffer {
  return Buffer.from(
    `kun-remote-invocation-v1\0${input.invocationId}\0${input.employeeId}\0${input.meetingId}\0${input.requesterId}\0${input.ownerDeviceId}`,
    'utf8'
  )
}

function responseInfo(input: { invocationId: string; requesterId: string; ownerDeviceId: string }): Buffer {
  return Buffer.from(
    `kun-remote-invocation-response-v1\0${input.invocationId}\0${input.requesterId}\0${input.ownerDeviceId}`,
    'utf8'
  )
}
