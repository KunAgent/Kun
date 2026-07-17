import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { writePrivateFileAtomic } from '../identity-vault-file'

const SecurityReasonSchema = z.enum(['sequence_gap', 'checkpoint_fork', 'signature_invalid', 'mls_state_invalid'])
const MeetingSyncStateSchema = z.object({
  meetingId: z.string().min(1),
  state: z.enum(['ready', 'SECURITY_SYNC_REQUIRED']),
  writable: z.boolean(),
  reason: SecurityReasonSchema.optional(),
  lastVerifiedSequence: z.number().int().nonnegative(),
  checkpointDigest: z.string().length(64).nullable(),
  updatedAt: z.iso.datetime()
}).strict()
export type MeetingSyncState = z.infer<typeof MeetingSyncStateSchema>

const SyncStateSchema = z.object({ version: z.literal(1), meetings: z.array(MeetingSyncStateSchema) }).strict()

export type EncryptedSyncEvent = {
  meetingId: string
  sequence: number
  previousCheckpointDigest: string | null
  checkpointDigest: string
  signature: string
  ciphertext: string
  commandId?: string
  epoch?: number
  ciphertextSha256?: string
  serverInstanceId?: string
}

export class CollaborationSyncEngine {
  constructor(
    private readonly path: string,
    private readonly verifier: { verify(event: EncryptedSyncEvent): Promise<boolean> }
  ) {}

  async apply(event: EncryptedSyncEvent): Promise<MeetingSyncState> {
    const state = await this.load()
    const meeting = state.meetings.find((item) => item.meetingId === event.meetingId) ?? defaultMeeting(event.meetingId)
    if (!state.meetings.some((item) => item.meetingId === event.meetingId)) state.meetings.push(meeting)
    if (meeting.state === 'SECURITY_SYNC_REQUIRED') return meeting
    if (event.sequence !== meeting.lastVerifiedSequence + 1) {
      return this.block(state, meeting, 'sequence_gap')
    }
    if (!await this.verifier.verify(event)) {
      return this.block(state, meeting, 'signature_invalid')
    }
    if (meeting.checkpointDigest !== event.previousCheckpointDigest) {
      return this.block(state, meeting, 'checkpoint_fork')
    }
    meeting.lastVerifiedSequence = event.sequence
    meeting.checkpointDigest = event.checkpointDigest
    meeting.updatedAt = new Date().toISOString()
    await this.save(state)
    return meeting
  }

  async status(meetingId: string): Promise<MeetingSyncState> {
    return (await this.load()).meetings.find((item) => item.meetingId === meetingId) ?? defaultMeeting(meetingId)
  }

  async requireSecurityRecovery(meetingId: string, reason: 'mls_state_invalid'): Promise<MeetingSyncState> {
    const state = await this.load()
    const meeting = state.meetings.find((item) => item.meetingId === meetingId) ?? defaultMeeting(meetingId)
    if (!state.meetings.some((item) => item.meetingId === meetingId)) state.meetings.push(meeting)
    return this.block(state, meeting, reason)
  }

  private async block(
    state: z.infer<typeof SyncStateSchema>,
    meeting: MeetingSyncState,
    reason: z.infer<typeof SecurityReasonSchema>
  ): Promise<MeetingSyncState> {
    meeting.state = 'SECURITY_SYNC_REQUIRED'
    meeting.writable = false
    meeting.reason = reason
    meeting.updatedAt = new Date().toISOString()
    await this.save(state)
    return meeting
  }

  private async load(): Promise<z.infer<typeof SyncStateSchema>> {
    const content = await readFile(this.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return content === null ? { version: 1, meetings: [] } : SyncStateSchema.parse(JSON.parse(content))
  }

  private save(state: z.infer<typeof SyncStateSchema>): Promise<void> {
    return writePrivateFileAtomic(this.path, `${JSON.stringify(state, null, 2)}\n`)
  }
}

function defaultMeeting(meetingId: string): MeetingSyncState {
  return {
    meetingId,
    state: 'ready',
    writable: true,
    lastVerifiedSequence: 0,
    checkpointDigest: null,
    updatedAt: new Date().toISOString()
  }
}
