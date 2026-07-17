import { createHash, createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
import {
  CollaborationEncryptedCommandSchema,
  HumanCollaborationCommandSchema,
  type CollaborationEncryptedCommand,
  type HumanCollaborationCommand
} from '../../../shared/collaboration/contracts'
import type { NetworkCredential } from '../network/network-credential-vault'
import { CollaborationSyncEngine, type EncryptedSyncEvent } from '../sync/collaboration-sync-engine'

type MembershipPort = {
  createOwnerMeeting(meetingId: string, memberId: string): Promise<void>
  prepareJoin(meetingId: string, invitationId: string, memberId: string): Promise<{ keyPackage: string }>
  approveJoin(meetingId: string, keyPackage: string): Promise<{ commit: string; welcome: string; ratchetTree: string }>
  completeJoin(invitationId: string, welcome: string, ratchetTree: string): Promise<void>
  encrypt(meetingId: string, plaintext: Buffer): Promise<Buffer>
  decrypt(meetingId: string, ciphertext: Buffer): Promise<Buffer>
  processCommit(meetingId: string, commit: Buffer): Promise<void>
  removeMember(meetingId: string, memberId: string): Promise<{ commit: string; epoch: number }>
  epoch(meetingId: string): Promise<number>
  latestStatus(): Promise<{
    meetingId: string
    invitationId?: string
    role: 'owner' | 'member'
    state: 'pending_membership' | 'ready'
  } | null>
}

const EventSchema = z.object({
  receipt: z.object({
    commandId: z.string().min(1),
    meetingId: z.string().min(1),
    sequence: z.number().int().positive(),
    acceptedAt: z.string().min(1),
    serverInstanceId: z.string().min(1),
    signature: z.string().min(1)
  }).strict(),
  memberId: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  frameKind: z.enum(['mls_application', 'mls_commit']),
  ciphertext: z.string().min(1),
  ciphertextSha256: z.string().length(64)
}).strict()

export class MlsNetworkSecurity {
  constructor(private readonly options: { membership: MembershipPort; syncPath: string }) {}

  createOwnerMeeting(meetingId: string, identity: { memberId: string }): Promise<void> {
    return this.options.membership.createOwnerMeeting(meetingId, identity.memberId)
  }

  prepareJoin(meetingId: string, invitationId: string, memberId: string): Promise<{ keyPackage: string }> {
    return this.options.membership.prepareJoin(meetingId, invitationId, memberId)
  }

  async approveJoin(meetingId: string, keyPackage: string) {
    const admission = await this.options.membership.approveJoin(meetingId, keyPackage)
    return { ...admission, epoch: await this.options.membership.epoch(meetingId) }
  }

  completeJoin(invitationId: string, welcome: string, ratchetTree: string): Promise<void> {
    return this.options.membership.completeJoin(invitationId, welcome, ratchetTree)
  }

  removeMember(meetingId: string, memberId: string): Promise<{ commit: string; epoch: number }> {
    return this.options.membership.removeMember(meetingId, memberId)
  }

  membershipStatus() {
    return this.options.membership.latestStatus()
  }

  async sealCommand(meetingId: string, command: HumanCollaborationCommand): Promise<{ ciphertext: string; epoch: number }> {
    return this.sealPayload(meetingId, HumanCollaborationCommandSchema.parse(command))
  }

  async sealPayload(meetingId: string, payload: CollaborationEncryptedCommand): Promise<{ ciphertext: string; epoch: number }> {
    const ciphertext = await this.options.membership.encrypt(
      meetingId,
      Buffer.from(JSON.stringify(CollaborationEncryptedCommandSchema.parse(payload)), 'utf8')
    )
    return { ciphertext: ciphertext.toString('base64'), epoch: await this.options.membership.epoch(meetingId) }
  }

  async acceptOwnFrame(input: {
    meetingId: string
    frame: {
      epoch: number
      frameKind: 'mls_application' | 'mls_commit'
      ciphertext: string
      ciphertextSha256: string
    }
    receipt: unknown
    credential: NetworkCredential
  }): Promise<void> {
    await this.syncMeeting({
      meetingId: input.meetingId,
      credential: input.credential,
      events: [{
        receipt: input.receipt,
        memberId: input.credential.memberId,
        ...input.frame
      }]
    })
  }

  async syncMeeting(input: {
    meetingId: string
    events: unknown[]
    credential: NetworkCredential
  }): Promise<{
    state: 'ready' | 'SECURITY_SYNC_REQUIRED'
    lastVerifiedSequence: number
    commands: CollaborationEncryptedCommand[]
  }> {
    const publicKey = receiptPublicKey(input.credential.receiptVerifyingKey)
    const engine = new CollaborationSyncEngine(this.options.syncPath, {
      verify: async (event) => verifyEvent(event, input.credential, publicKey)
    })
    let state = await engine.status(input.meetingId)
    const commands: CollaborationEncryptedCommand[] = []
    for (const value of input.events) {
      const event = EventSchema.parse(value)
      const previousCheckpointDigest = state.checkpointDigest
      const checkpointDigest = createHash('sha256')
        .update(`${previousCheckpointDigest ?? ''}\n${event.ciphertextSha256}\n${event.receipt.sequence}`)
        .digest('hex')
      state = await engine.apply({
        meetingId: event.receipt.meetingId,
        sequence: event.receipt.sequence,
        previousCheckpointDigest,
        checkpointDigest,
        signature: event.receipt.signature,
        ciphertext: event.ciphertext,
        commandId: event.receipt.commandId,
        epoch: event.epoch,
        ciphertextSha256: event.ciphertextSha256,
        serverInstanceId: event.receipt.serverInstanceId
      })
      if (state.state === 'SECURITY_SYNC_REQUIRED') break
      if (event.memberId === input.credential.memberId) continue
      try {
        if (event.frameKind === 'mls_commit') {
          await this.options.membership.processCommit(input.meetingId, Buffer.from(event.ciphertext, 'base64'))
        } else {
          const plaintext = await this.options.membership.decrypt(input.meetingId, Buffer.from(event.ciphertext, 'base64'))
          commands.push(CollaborationEncryptedCommandSchema.parse(JSON.parse(plaintext.toString('utf8'))))
        }
      } catch {
        state = await engine.requireSecurityRecovery(input.meetingId, 'mls_state_invalid')
        break
      }
    }
    return { state: state.state, lastVerifiedSequence: state.lastVerifiedSequence, commands }
  }
}

function receiptPublicKey(rawBase64: string) {
  const raw = Buffer.from(rawBase64, 'base64')
  if (raw.byteLength !== 32) throw new Error('Collaboration receipt verification key is invalid')
  const prefix = Buffer.from('302a300506032b6570032100', 'hex')
  return createPublicKey({ key: Buffer.concat([prefix, raw]), type: 'spki', format: 'der' })
}

function verifyEvent(event: EncryptedSyncEvent, credential: NetworkCredential, publicKey: ReturnType<typeof receiptPublicKey>): boolean {
  if (
    !event.commandId || event.epoch === undefined || !event.ciphertextSha256 ||
    event.meetingId.length === 0 || event.serverInstanceId !== credential.serverInstanceId
  ) return false
  const signatureInput = `${event.commandId}\n${event.meetingId}\n${event.sequence}\n${event.epoch}\n${event.ciphertextSha256}`
  try {
    return verify(null, Buffer.from(signatureInput, 'utf8'), publicKey, Buffer.from(event.signature, 'base64'))
  } catch {
    return false
  }
}
