import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { writePrivateFileAtomic } from '../identity-vault-file'

type MembershipSession = {
  epoch(): number | null
  createGroup(groupId: string): void
  keyPackage(): Buffer
  addMember(keyPackage: Buffer): { commit: Buffer; welcome: Buffer; ratchetTree: Buffer }
  joinGroup(welcome: Buffer, ratchetTree: Buffer): void
  encrypt(plaintext: Buffer): Buffer
  decrypt(ciphertext: Buffer): Buffer
  processCommit(commit: Buffer): void
  removeMember(identity: string): Buffer
  exportEncryptedState(stateKey: Buffer): Buffer
}

type MembershipAdapter = {
  createSession(identity: string): MembershipSession
  restoreSession(state: Buffer, stateKey: Buffer): MembershipSession
}

const RecordSchema = z.object({
  meetingId: z.string().min(1),
  invitationId: z.string().min(1).optional(),
  role: z.enum(['owner', 'member']),
  state: z.enum(['pending_membership', 'ready']),
  encryptedState: z.string().min(1),
  keyPackage: z.string().min(1).optional(),
  updatedAt: z.iso.datetime()
}).strict()
type MembershipRecord = z.infer<typeof RecordSchema>
const StateSchema = z.object({ version: z.literal(1), meetings: z.array(RecordSchema) }).strict()

export class MlsMembershipDriver {
  constructor(private readonly options: {
    path: string
    adapter: MembershipAdapter
    stateKey: Buffer
  }) {
    if (options.stateKey.byteLength !== 32) throw new TypeError('MLS membership state key must contain 32 bytes')
  }

  async createOwnerMeeting(meetingId: string, memberId: string): Promise<void> {
    const state = await this.load()
    const existing = state.meetings.find((item) => item.meetingId === meetingId)
    if (existing?.state === 'ready') return
    const session = this.options.adapter.createSession(memberId)
    session.createGroup(meetingId)
    this.upsert(state.meetings, {
      meetingId,
      role: 'owner',
      state: 'ready',
      encryptedState: session.exportEncryptedState(this.options.stateKey).toString('base64'),
      updatedAt: new Date().toISOString()
    })
    await this.save(state)
  }

  async prepareJoin(meetingId: string, invitationId: string, memberId: string): Promise<{ keyPackage: string }> {
    const state = await this.load()
    const existing = state.meetings.find((item) => item.invitationId === invitationId)
    if (existing?.keyPackage) return { keyPackage: existing.keyPackage }
    const session = this.options.adapter.createSession(memberId)
    const keyPackage = session.keyPackage().toString('base64')
    this.upsert(state.meetings, {
      meetingId,
      invitationId,
      role: 'member',
      state: 'pending_membership',
      encryptedState: session.exportEncryptedState(this.options.stateKey).toString('base64'),
      keyPackage,
      updatedAt: new Date().toISOString()
    })
    await this.save(state)
    return { keyPackage }
  }

  async approveJoin(meetingId: string, keyPackage: string): Promise<{
    commit: string
    welcome: string
    ratchetTree: string
  }> {
    const state = await this.load()
    const record = state.meetings.find((item) => item.meetingId === meetingId && item.role === 'owner' && item.state === 'ready')
    if (!record) throw new Error('Owner MLS meeting state is unavailable')
    const session = this.restore(record)
    const result = session.addMember(Buffer.from(keyPackage, 'base64'))
    record.encryptedState = session.exportEncryptedState(this.options.stateKey).toString('base64')
    record.updatedAt = new Date().toISOString()
    await this.save(state)
    return {
      commit: result.commit.toString('base64'),
      welcome: result.welcome.toString('base64'),
      ratchetTree: result.ratchetTree.toString('base64')
    }
  }

  async completeJoin(invitationId: string, welcome: string, ratchetTree: string): Promise<void> {
    const state = await this.load()
    const record = state.meetings.find((item) => item.invitationId === invitationId && item.state === 'pending_membership')
    if (!record) throw new Error('Pending MLS invitation state is unavailable')
    const session = this.restore(record)
    session.joinGroup(Buffer.from(welcome, 'base64'), Buffer.from(ratchetTree, 'base64'))
    record.state = 'ready'
    record.encryptedState = session.exportEncryptedState(this.options.stateKey).toString('base64')
    record.updatedAt = new Date().toISOString()
    await this.save(state)
  }

  async removeMember(meetingId: string, memberId: string): Promise<{ commit: string; epoch: number }> {
    return this.withReadySession(meetingId, (session) => {
      const commit = session.removeMember(memberId)
      const epoch = session.epoch()
      if (epoch === null) throw new Error('MLS meeting epoch is unavailable after member removal')
      return { commit: commit.toString('base64'), epoch }
    })
  }

  async encrypt(meetingId: string, plaintext: Buffer): Promise<Buffer> {
    return this.withReadySession(meetingId, (session) => session.encrypt(plaintext))
  }

  async epoch(meetingId: string): Promise<number> {
    return this.withReadySession(meetingId, (session) => {
      const epoch = session.epoch()
      if (epoch === null) throw new Error('MLS meeting epoch is unavailable')
      return epoch
    })
  }

  async decrypt(meetingId: string, ciphertext: Buffer): Promise<Buffer> {
    return this.withReadySession(meetingId, (session) => session.decrypt(ciphertext))
  }

  async processCommit(meetingId: string, commit: Buffer): Promise<void> {
    await this.withReadySession(meetingId, (session) => {
      session.processCommit(commit)
      return undefined
    })
  }

  async status(meetingId: string): Promise<Pick<MembershipRecord, 'meetingId' | 'role' | 'state'> | null> {
    const record = (await this.load()).meetings.find((item) => item.meetingId === meetingId)
    return record ? { meetingId: record.meetingId, role: record.role, state: record.state } : null
  }

  async latestStatus(): Promise<Pick<MembershipRecord, 'meetingId' | 'invitationId' | 'role' | 'state'> | null> {
    const meetings = (await this.load()).meetings
    const record = meetings.reduce<MembershipRecord | null>((latest, item) => {
      if (!latest || item.updatedAt > latest.updatedAt) return item
      return latest
    }, null)
    return record ? {
      meetingId: record.meetingId,
      invitationId: record.invitationId,
      role: record.role,
      state: record.state
    } : null
  }

  private restore(record: MembershipRecord): MembershipSession {
    return this.options.adapter.restoreSession(Buffer.from(record.encryptedState, 'base64'), this.options.stateKey)
  }

  private async withReadySession<T>(meetingId: string, operation: (session: MembershipSession) => T): Promise<T> {
    const state = await this.load()
    const record = state.meetings.find((item) => item.meetingId === meetingId && item.state === 'ready')
    if (!record) throw new Error('Ready MLS meeting state is unavailable')
    const session = this.restore(record)
    const result = operation(session)
    record.encryptedState = session.exportEncryptedState(this.options.stateKey).toString('base64')
    record.updatedAt = new Date().toISOString()
    await this.save(state)
    return result
  }

  private upsert(records: MembershipRecord[], record: MembershipRecord): void {
    const index = records.findIndex((item) => item.meetingId === record.meetingId)
    if (index >= 0) records[index] = RecordSchema.parse(record)
    else records.push(RecordSchema.parse(record))
  }

  private async load(): Promise<z.infer<typeof StateSchema>> {
    const content = await readFile(this.options.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return content === null ? { version: 1, meetings: [] } : StateSchema.parse(JSON.parse(content))
  }

  private save(state: z.infer<typeof StateSchema>): Promise<void> {
    return writePrivateFileAtomic(this.options.path, `${JSON.stringify(StateSchema.parse(state), null, 2)}\n`)
  }
}
