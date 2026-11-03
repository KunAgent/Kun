import { randomBytes, createHash } from 'node:crypto'
import { z } from 'zod'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import { openAgentConversation } from './agent-conversations.js'
import { agentStableId } from './agent-identity-service.js'
import { PolicyMutationRejected } from '../domain/remote-policy-revision.js'
import { canonical } from '@kun/remote-protocol'

const Profile = z.object({ name: z.string().trim().min(1).max(80), title: z.string().max(160).default(''),
  instructions: z.string().max(8000).default('') }).strict()
const Owner = z.object({ accountId: z.string(), deviceId: z.string(), authorizationId: z.string() }).strict()
export type ImportOwner = z.infer<typeof Owner>
const Preview = z.object({ kind: z.literal('preview'), owner: Owner, profile: Profile, token: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number(), usedBy: z.string().optional() }).strict()
const Intent = z.object({ kind: z.literal('import'), owner: Owner, clientRequestId: z.string(), profile: Profile,
  canonicalId: z.string().optional(), fingerprint: z.string(), status: z.enum(['pending', 'applied']), result: z.unknown().optional() }).strict()
const tokenId = (token: string) => 'agent-import-token:' + createHash('sha256').update(token).digest('hex')
const nameKey = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('und')

/** Portable profile import only. No native installation, credentials, policy, path or executable content. */
export class AgentProfileImportService {
  constructor(private rooms: RoomRuntime) {}
  async conflicts(name: string) {
    let afterSeq = 0, count = 0
    const conflicts: Array<{ agentId: string; name: string; revision: number }> = [], deadline = Date.now() + 1000
    for (;;) {
      const rows = await this.rooms.deps.store.list<AgentIdentity>('agent_identity', { afterSeq, order: 'asc', includeArchived: true, limit: 100 })
      for (const row of rows) {
        if (nameKey(row.value.name) === nameKey(name)) conflicts.push({ agentId: row.id, name: row.value.name, revision: row.revision })
        count++
      }
      if (rows.length < 100) return conflicts
      if (count >= 10000 || Date.now() >= deadline) throw new PolicyMutationRejected('TASK_BUSY')
      afterSeq = rows.at(-1)!.seq
    }
  }
  async preview(owner: ImportOwner, clientRequestId: string, profileInput: unknown) {
    const profile = Profile.parse(profileInput), key = agentStableId('agent-import-preview', owner.accountId, owner.deviceId, clientRequestId)
    return this.rooms.exclusive(async () => {
      const store = this.rooms.deps.store, previous = await store.get<z.infer<typeof Preview>>('agent_import', key)
      if (previous) {
        if (canonical(Preview.parse(previous.value).profile) !== canonical(profile)) throw new Error('REQUEST_CONFLICT')
        return (await store.getRequest(key))?.result
      }
      const value = Preview.parse({ kind: 'preview', owner, profile, token: randomBytes(32).toString('hex'), expiresAt: Date.now() + 300000 })
      const result = await this.projectPreview(value)
      await store.commit({ requestId: key, checks: [{ kind: 'agent_import', id: key, expectedRevision: null },
        { kind: 'agent_import', id: tokenId(value.token), expectedRevision: null }], puts: [
        { kind: 'agent_import', id: key, value }, { kind: 'agent_import', id: tokenId(value.token), value: { previewId: key } }], result })
      return result
    })
  }
  private async projectPreview(value: z.infer<typeof Preview>) {
    const conflicts = await this.conflicts(value.profile.name)
    return { token: value.token, expiresAt: value.expiresAt, profile: value.profile, conflicts,
      canCommit: conflicts.length === 0, imported: ['profile'], excluded: ['credentials', 'permissions', 'paths', 'automations', 'skills', 'memory'] }
  }
  async commit(owner: ImportOwner, clientRequestId: string, input: { token: string; name: string }) {
    return this.rooms.exclusive(() => withManagerDataMutex('agent-directory', async () => {
      const store = this.rooms.deps.store, id = agentStableId('agent-import', owner.accountId, owner.deviceId, clientRequestId)
      const prior = await store.get<z.infer<typeof Intent>>('agent_import', id)
      const fingerprint = createHash('sha256').update(canonical({ owner, input })).digest('hex')
      if (prior) { if (prior.value.fingerprint !== fingerprint) throw new Error('REQUEST_CONFLICT'); return this.finish(id) }
      await (async () => {
        const ref = await store.get<{ previewId: string }>('agent_import', tokenId(input.token))
        const row = ref ? await store.get<z.infer<typeof Preview>>('agent_import', ref.value.previewId) : null
        const value = row ? Preview.parse(row.value) : undefined
        if (!value || value.owner.accountId !== owner.accountId || value.owner.deviceId !== owner.deviceId ||
          !value.usedBy && (value.expiresAt <= Date.now() || value.owner.authorizationId !== owner.authorizationId)) throw new PolicyMutationRejected('INVALID_REQUEST')
        const profile = Profile.parse({ ...value.profile, name: input.name })
        if (value.usedBy) {
          const original = await store.get<z.infer<typeof Intent>>('agent_import', value.usedBy)
          if (!original || original.value.canonicalId || canonical(original.value.owner) !== canonical(value.owner)) throw new Error('IMPORT_RECONCILIATION_REQUIRED')
          if (nameKey(original.value.profile.name) !== nameKey(profile.name)) throw new PolicyMutationRejected('REVISION_CONFLICT')
          await store.commit({ requestId: id + '-alias', checks: [{ kind: 'agent_import', id, expectedRevision: null },
            { kind: 'agent_import', id: original.id, expectedRevision: original.revision }], puts: [
            { kind: 'agent_import', id, value: { kind: 'import', owner: value.owner, clientRequestId, profile: original.value.profile,
              canonicalId: original.id, fingerprint, status: 'pending' } }] })
          return
        }
        if ((await this.conflicts(profile.name)).length) throw new PolicyMutationRejected('REVISION_CONFLICT')
        if (!(await this.rooms.agents.features()).identities) throw new PolicyMutationRejected('INVALID_REQUEST')
        await store.commit({ requestId: id + '-admit', checks: [{ kind: 'agent_import', id, expectedRevision: null },
          { kind: 'agent_import', id: row!.id, expectedRevision: row!.revision }], puts: [
          { kind: 'agent_import', id: row!.id, value: { ...value, usedBy: id } },
          { kind: 'agent_import', id, value: { kind: 'import', owner, clientRequestId, profile, fingerprint, status: 'pending' } }] })
      })()
      return this.finish(id)
    }))
  }
  private async finish(id: string): Promise<any> {
    const store = this.rooms.deps.store, row = await store.get<z.infer<typeof Intent>>('agent_import', id)
    if (!row) return undefined
    const value = Intent.parse(row.value)
    if (id !== agentStableId('agent-import', value.owner.accountId, value.owner.deviceId, value.clientRequestId)) return undefined
    if (value.result) return value.result
    // The accepted native request ID owns the identity even if a response is lost.
    // create() sets setup.completed and never invokes an invitation/setup model.
    let result: unknown
    if (value.canonicalId) {
      const original = await store.get<z.infer<typeof Intent>>('agent_import', value.canonicalId)
      if (!original || original.value.canonicalId || canonical(original.value.owner) !== canonical(value.owner) ||
        canonical(original.value.profile) !== canonical(value.profile)) return undefined
      result = await this.finish(original.id)
    } else {
      const { agent } = await this.rooms.agents.create({ ...value.profile, clientRequestId: id })
      const { room } = await openAgentConversation(this.rooms.agents, this.rooms.service, agent.id)
      result = { agent: { id: agent.id, name: agent.name, title: agent.title, instructions: agent.instructions,
        revision: agent.revision, archived: false, createdAt: agent.createdAt, updatedAt: agent.updatedAt },
        conversationId: room.id, imported: ['profile'] }
    }
    if (!result) return undefined
    {
      const fresh = await store.get<z.infer<typeof Intent>>('agent_import', id)
      if (!fresh) return undefined
      if (fresh.value.result) return fresh.value.result
      await store.commit({ requestId: id + '-finish', checks: [{ kind: 'agent_import', id, expectedRevision: fresh.revision }],
        puts: [{ kind: 'agent_import', id, value: { ...fresh.value, status: 'applied', result } }], result })
      return result
    }
  }
  async recover(owner: ImportOwner, clientRequestId: string, preview = false) {
    const store = this.rooms.deps.store
    if (preview) {
      const key = agentStableId('agent-import-preview', owner.accountId, owner.deviceId, clientRequestId)
      return (await store.getRequest(key))?.result
    }
    const id = agentStableId('agent-import', owner.accountId, owner.deviceId, clientRequestId)
    return this.rooms.exclusive(() => withManagerDataMutex('agent-directory', () => this.finish(id)))
  }
}
