import { createHash } from 'node:crypto'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { UpdateAgentRequest, type AgentIdentity } from '../../contracts/agent-identities.js'
import { canonical } from '@kun/remote-protocol'
import { RoomAvatarReferenceSchema, RoomAvatarAssetSchema } from '../../contracts/room-content.js'
import { ROOM_BUILTIN_AVATAR_IDS } from '../../contracts/kun-avatar-presets.js'
import { getRoomAvatarImage, saveRoomAvatarImage } from '../../rooms/room-avatar-service.js'
import { roomPreviewImage } from '../../rooms/room-preview-image.js'
import { requireAgent } from './access.js'
import { attachmentAdmissionKey, type AttachmentAdmission } from '../files/admissions.js'
import { deviceAttachmentAdmissionKey } from '../files/device-admission.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { AgentAppearanceParams } from './appearance-contracts.js'

export function avatarState(agent: AgentIdentity) {
  return { agentId: agent.id, revision: agent.revision, avatar: agent.avatar ? RoomAvatarReferenceSchema.parse(agent.avatar) : null }
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function nativeInput(avatar: AgentIdentity['avatar'] | null, expectedRevision: number, clientRequestId: string) {
  return Object.fromEntries(Object.entries(UpdateAgentRequest.parse({ avatar, expectedRevision, clientRequestId }))
    .filter(([key]) => ['avatar', 'expectedRevision', 'clientRequestId'].includes(key)))
}
export class RemoteAgentAvatar {
  constructor(private readonly runtime: ServerRuntime) {}
  async get(agentId: string) {
    const agent = await requireAgent(this.runtime.rooms!, agentId), state = avatarState(agent)
    let uploadedImage: { mimeType: 'image/jpeg'; size: number; sha256: string; width: 128; height: 128 } | undefined
    if (agent.avatar?.kind === 'uploaded') {
      const row = await this.runtime.rooms!.deps.store.get('room_avatar', agent.avatar.attachmentId)
      const parsed = RoomAvatarAssetSchema.safeParse(row?.value)
      if (parsed.success && this.runtime.attachmentStore) {
        const meta = await this.runtime.attachmentStore.get(parsed.data.attachmentId)
        if (meta?.hash === parsed.data.hash && meta.width === 128 && meta.height === 128 && meta.mimeType === 'image/jpeg' && meta.byteSize === parsed.data.byteSize)
          uploadedImage = { mimeType: 'image/jpeg', size: meta.byteSize, sha256: meta.hash, width: 128, height: 128 }
      }
    }
    return { ...state, builtinChoices: [...ROOM_BUILTIN_AVATAR_IDS], editable: !agent.archivedAt,
      uploadAvailable: Boolean(this.runtime.attachmentStore), rendering: agent.avatar?.kind === 'composed' ? 'unsupported_composed' as const
        : agent.avatar?.kind === 'uploaded' ? uploadedImage ? 'image' as const : 'unavailable' as const : 'reference' as const,
      ...(uploadedImage ? { uploadedImage } : {}) }
  }
  async preflight(p: any, scope?: RemoteScope) {
    const agent = await requireAgent(this.runtime.rooms!, p.agentId)
    if (agent.revision !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
    if (agent.archivedAt) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    if (p.source.kind !== 'received') return
    if (!this.runtime.attachmentStore) throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED')
    if (!scope) return // The dispatch performs the device-bound check before touching any bytes.
    const store = this.runtime.rooms!.deps.store, id = p.source.attachmentId
    if (scope) {
      const device = await store.get<AttachmentAdmission>('remote_attachment_admission', deviceAttachmentAdmissionKey(scope, id))
      const legacy = device ?? await store.get<AttachmentAdmission>('remote_attachment_admission', attachmentAdmissionKey(scope, id))
      if (!legacy || legacy.value.attachmentId !== id || legacy.value.sourceDeviceId !== scope.deviceId)
        throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED')
    }
    const metadata = await this.runtime.attachmentStore.get(id)
    if (!metadata || !['image/png', 'image/jpeg'].includes(metadata.mimeType) || metadata.byteSize < 1 || metadata.byteSize > 2 * 1024 * 1024)
      throw new RemoteNoEffect('INVALID_REQUEST')
  }
  async update(p: any, scope: Envelope) {
    await this.preflight(p, scope)
    let avatar: AgentIdentity['avatar'] | null = p.source.kind === 'clear' ? null : p.source.kind === 'builtin' ? { kind: 'builtin', id: p.source.id } : null
    if (p.source.kind === 'received') {
      const attachments = this.runtime.attachmentStore!, meta = (await attachments.get(p.source.attachmentId))!
      let image
      try {
        const source = await attachments.resolveContent(meta.id, meta.threadIds[0] ? { threadId: meta.threadIds[0] }
          : meta.workspaces[0] ? { workspace: meta.workspaces[0] } : {})
        if (source.data.length !== meta.byteSize || createHash('sha256').update(source.data).digest('hex') !== meta.hash) throw new Error('AVATAR_INTEGRITY')
        image = await roomPreviewImage(source.data, 128, true)
      } catch (error) { throw new RemoteNoEffect(error instanceof Error && error.message === 'preview_busy' ? 'TASK_BUSY' : 'INVALID_REQUEST') }
      avatar = (await saveRoomAvatarImage(this.runtime.rooms!.deps.store, attachments, image)).avatar
    }
    const result = await this.runtime.rooms!.exclusive(async () => {
      try { await this.preflight(p, scope) }
      catch (error) { if (p.source.kind === 'received') throw new Error('AVATAR_RESULT_UNCONFIRMED'); throw error }
      const clientRequestId = receiptKey(scope, scope.call.requestId)
      await this.runtime.rooms!.deps.store.commit({ requestId: 'remote-avatar-prepare:' + clientRequestId,
        fingerprint: hash(canonical(p)), result: { avatar } })
      return this.runtime.rooms!.agents.update(p.agentId, nativeInput(avatar, p.expectedRevision, clientRequestId))
    })
    return avatarState(result.agent)
  }
  async recover(scope: RemoteScope, receipt: Receipt) {
    if (receipt.method !== 'agent.avatar.update') return undefined
    const p = AgentAppearanceParams['agent.avatar.update'].safeParse(receipt.params)
    if (!p.success) return undefined
    const id = receiptKey(scope, receipt.requestId), proof = await this.runtime.rooms!.deps.store.getRequest('agent-update:' + p.data.agentId + ':' + id)
    const prepared = await this.runtime.rooms!.deps.store.getRequest('remote-avatar-prepare:' + id)
    if (prepared?.fingerprint !== hash(canonical(p.data)) || !prepared.result || typeof prepared.result !== 'object' ||
      !Object.hasOwn(prepared.result, 'avatar')) return undefined
    const avatar = (prepared.result as { avatar: AgentIdentity['avatar'] | null }).avatar
    if (proof?.fingerprint !== hash(nativeInput(avatar, p.data.expectedRevision, id))) return undefined
    const agent = (proof?.result as { agent?: AgentIdentity } | undefined)?.agent
    return agent?.id === p.data.agentId && agent.revision === p.data.expectedRevision + 1 ? avatarState(agent) : undefined
  }
  async read(agentId: string, revision: number) {
    const before = await requireAgent(this.runtime.rooms!, agentId)
    if (before.revision !== revision || before.avatar?.kind !== 'uploaded') throw new Error('AVATAR_NOT_ALLOWED')
    const image = await getRoomAvatarImage(this.runtime.rooms!.deps.store, this.runtime.attachmentStore, before.avatar.attachmentId)
    const after = await requireAgent(this.runtime.rooms!, agentId)
    if (after.revision !== revision || JSON.stringify(after.avatar) !== JSON.stringify(before.avatar)) throw new Error('AVATAR_NOT_ALLOWED')
    const data = Buffer.from(image.dataBase64, 'base64')
    return { data, sha256: createHash('sha256').update(data).digest('hex') }
  }
}
