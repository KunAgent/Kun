import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { writePrivateFileAtomic } from '../identity-vault-file'

const InvitationSchema = z.object({
  version: z.literal(1),
  invitationId: z.string().min(1),
  serverUrl: z.url().refine((value) => new URL(value).protocol === 'https:'),
  serverInstanceId: z.string().min(1),
  spkiSha256: z.string().length(64).regex(/^[a-f0-9]+$/i),
  meetingId: z.string().min(1),
  oneTimeCredential: z.string().min(1),
  expiresAt: z.iso.datetime(),
  inviterMemberId: z.string().min(1).optional()
}).strict()
export type InvitationBundle = z.infer<typeof InvitationSchema>

const InvitationStateSchema = z.object({
  version: z.literal(1),
  invitations: z.array(z.object({
    invitationId: z.string(),
    credentialSha256: z.string().length(64),
    expiresAt: z.iso.datetime(),
    consumedAt: z.iso.datetime().optional()
  }).strict())
}).strict()

export class InvitationError extends Error {
  constructor(
    readonly code: 'invitation_consumed' | 'invitation_expired' | 'invitation_invalid',
    message: string
  ) {
    super(message)
    this.name = 'InvitationError'
  }
}

type MembershipPort = {
  join(input: {
    invitationId: string
    meetingId: string
    displayName: string
    role: 'member'
    oneTimeCredential: string
    serverUrl: string
    serverInstanceId: string
    spkiSha256: string
  }): Promise<{ memberId: string; status: 'joined' }>
}

export class InvitationService {
  constructor(private readonly options: {
    statePath: string
    membership: MembershipPort
    now?: () => Date
  }) {}

  async create(input: {
    serverUrl: string
    serverInstanceId: string
    spkiSha256: string
    meetingId: string
    inviterMemberId?: string
    expiresInMs: number
  }): Promise<InvitationBundle> {
    if (!Number.isFinite(input.expiresInMs) || input.expiresInMs < 60_000 || input.expiresInMs > 7 * 86_400_000) {
      throw new InvitationError('invitation_invalid', 'Invitation expiry must be between one minute and seven days')
    }
    const credential = randomBytes(32).toString('base64url')
    const invitation = InvitationSchema.parse({
      version: 1,
      invitationId: randomUUID(),
      serverUrl: input.serverUrl,
      serverInstanceId: input.serverInstanceId,
      spkiSha256: input.spkiSha256,
      meetingId: input.meetingId,
      oneTimeCredential: credential,
      expiresAt: new Date(this.now().getTime() + input.expiresInMs).toISOString(),
      ...(input.inviterMemberId ? { inviterMemberId: input.inviterMemberId } : {})
    })
    const state = await this.load()
    state.invitations.push({
      invitationId: invitation.invitationId,
      credentialSha256: digestCredential(credential),
      expiresAt: invitation.expiresAt
    })
    await this.save(state)
    return invitation
  }

  async consume(bundle: InvitationBundle, input: { displayName: string }) {
    const invitation = InvitationSchema.parse(bundle)
    const state = await this.load()
    const record = state.invitations.find((item) => item.invitationId === invitation.invitationId)
    if (record?.consumedAt) throw new InvitationError('invitation_consumed', 'Invitation has already been consumed')
    if (new Date(invitation.expiresAt).getTime() <= this.now().getTime()) {
      throw new InvitationError('invitation_expired', 'Invitation has expired')
    }
    if (record && !sameDigest(record.credentialSha256, digestCredential(invitation.oneTimeCredential))) {
      throw new InvitationError('invitation_invalid', 'Invitation credential does not match')
    }
    const result = await this.options.membership.join({
      invitationId: invitation.invitationId,
      meetingId: invitation.meetingId,
      displayName: input.displayName.trim(),
      role: 'member',
      oneTimeCredential: invitation.oneTimeCredential,
      serverUrl: invitation.serverUrl,
      serverInstanceId: invitation.serverInstanceId,
      spkiSha256: invitation.spkiSha256
    })
    const persisted = record ?? {
      invitationId: invitation.invitationId,
      credentialSha256: digestCredential(invitation.oneTimeCredential),
      expiresAt: invitation.expiresAt
    }
    persisted.consumedAt = this.now().toISOString()
    if (!record) state.invitations.push(persisted)
    await this.save(state)
    return result
  }

  private now(): Date { return this.options.now?.() ?? new Date() }

  private async load(): Promise<z.infer<typeof InvitationStateSchema>> {
    const content = await readFile(this.options.statePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return content === null ? { version: 1, invitations: [] } : InvitationStateSchema.parse(JSON.parse(content))
  }

  private save(state: z.infer<typeof InvitationStateSchema>): Promise<void> {
    return writePrivateFileAtomic(this.options.statePath, `${JSON.stringify(state, null, 2)}\n`)
  }
}

function digestCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sameDigest(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}
