import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MlsMembershipDriver } from './mls-membership-driver'

describe('MlsMembershipDriver', () => {
  it('persists encrypted owner and pending join sessions through admission', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-mls-membership-'))
    const sessions = new Map<string, FakeSession>()
    const adapter = {
      createSession: (identity: string) => {
        const session = new FakeSession(identity)
        sessions.set(identity, session)
        return session
      },
      restoreSession: (state: Buffer) => new FakeSession(state.toString('utf8'))
    }
    try {
      const owner = new MlsMembershipDriver({
        path: join(directory, 'owner.json'), adapter, stateKey: Buffer.alloc(32, 1)
      })
      const joiner = new MlsMembershipDriver({
        path: join(directory, 'joiner.json'), adapter, stateKey: Buffer.alloc(32, 2)
      })

      await owner.createOwnerMeeting('meeting-1', 'member-owner')
      const ciphertext = await owner.encrypt('meeting-1', Buffer.from('command'))
      await expect(owner.decrypt('meeting-1', ciphertext)).resolves.toEqual(Buffer.from('command'))
      const prepared = await joiner.prepareJoin('meeting-1', 'invite-1', 'member-guest')
      expect(await joiner.latestStatus()).toMatchObject({
        meetingId: 'meeting-1', invitationId: 'invite-1', state: 'pending_membership'
      })
      const admission = await owner.approveJoin('meeting-1', prepared.keyPackage)
      await joiner.completeJoin('invite-1', admission.welcome, admission.ratchetTree)
      const removal = await owner.removeMember('meeting-1', 'member-guest')

      expect(admission).toMatchObject({ commit: expect.any(String), welcome: expect.any(String) })
      expect(removal).toMatchObject({ commit: Buffer.from('remove:member-guest').toString('base64'), epoch: 2 })
      expect(await owner.status('meeting-1')).toMatchObject({ state: 'ready', role: 'owner' })
      expect(await joiner.status('meeting-1')).toMatchObject({ state: 'ready', role: 'member' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

class FakeSession {
  private joined = false
  private readonly identity: string
  private currentEpoch: number
  constructor(serialized: string) {
    const [identity, epoch = '0'] = serialized.split('|')
    this.identity = identity
    this.currentEpoch = Number(epoch)
  }
  epoch(): number { return this.currentEpoch }
  createGroup(): void { this.joined = true }
  keyPackage(): Buffer { return Buffer.from(`key:${this.identity}`) }
  addMember(): { commit: Buffer; welcome: Buffer; ratchetTree: Buffer } {
    this.currentEpoch += 1
    return { commit: Buffer.from('commit'), welcome: Buffer.from('welcome'), ratchetTree: Buffer.from('tree') }
  }
  joinGroup(): void { this.joined = true }
  encrypt(plaintext: Buffer): Buffer { return Buffer.from(plaintext) }
  decrypt(ciphertext: Buffer): Buffer { return Buffer.from(ciphertext) }
  processCommit(): void { this.joined = true }
  removeMember(identity: string): Buffer {
    this.currentEpoch += 1
    return Buffer.from(`remove:${identity}`)
  }
  exportEncryptedState(): Buffer { return Buffer.from(`${this.identity}|${this.currentEpoch}`) }
}
