import { RoomStoreConflictError } from '../rooms/room-store.js'
import type { RoomMember } from '../contracts/rooms.js'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { resolveRoleModel } from '../loop/title-generator.js'
import { isModelConnectionProfileUsable } from '../contracts/model-connections.js'
import { isRetiredOpenCodeFreeConnection } from '../services/model-connection-registry-usability.js'

export type AgentModelBinding = { model: string; providerId?: string; accountId?: string }
function liveConnection(provider: { id: string; presetSource?: string }): boolean {
  return !isRetiredOpenCodeFreeConnection(provider)
}
export function agentMainModel(deps: RoomRuntimeDeps, member: RoomMember): AgentModelBinding {
  const preset = member.presetSnapshot ?? deps.profiles()[member.presetId]
  const fallback = deps.model()
  return member.modelRef ?? { model: preset?.model ?? fallback.model, providerId: preset?.providerId ?? fallback.providerId,
    accountId: !preset?.providerId || preset.providerId === fallback.providerId ? fallback.accountId : undefined }
}
export function agentFastModel(deps: RoomRuntimeDeps, member: Pick<RoomMember, 'fastModelRef'>, main: AgentModelBinding) {
  return member.fastModelRef ?? resolveRoleModel({ roles: deps.peerModels?.roles(), mainModel: main.model,
    mainProviderId: main.providerId, mainAccountId: main.accountId })
}
export async function agentModelOptions(deps: RoomRuntimeDeps, agent?: AgentIdentity, roomId?: string) {
  const snapshot = await deps.modelSnapshot?.()
  const unsupported = new Set(deps.unsupportedProviderIds?.() ?? [])
  const providers = snapshot?.providers.filter(liveConnection) ?? []
  const options = snapshot ? providers.flatMap((provider) => provider.models.map((model) => ({
    model, providerId: provider.id, accountId: provider.accountId, label: model, providerLabel: provider.name,
    available: isModelConnectionProfileUsable(provider) && !unsupported.has(provider.id), groupAvailable: !unsupported.has(provider.id),
    fastAvailable: !unsupported.has(provider.id), reason: unsupported.has(provider.id) ? 'agent_scope_unsupported' : !isModelConnectionProfileUsable(provider) ? 'model_connection_unavailable' : undefined
  }))) : [{ ...deps.model(), label: deps.model().model, providerLabel: deps.model().providerId ?? 'Kun',
    available: Boolean(deps.model().model) && !unsupported.has(deps.model().providerId ?? ''), groupAvailable: !unsupported.has(deps.model().providerId ?? ''), fastAvailable: !unsupported.has(deps.model().providerId ?? '') }]
  const preset = agent ? deps.profiles()[agent.presetId] : undefined
  const defaultProvider = snapshot?.defaultProviderId
    ? snapshot.providers.find((item) => item.id === snapshot.defaultProviderId)
    : undefined
  const firstLive = options.find((item) => item.available)
  const fallback = snapshot?.defaultModel && defaultProvider && liveConnection(defaultProvider)
    ? { model: snapshot.defaultModel, providerId: snapshot.defaultProviderId, accountId: snapshot.defaultAccountId }
    : firstLive
      ? { model: firstLive.model, providerId: firstLive.providerId, accountId: firstLive.accountId }
      : deps.model()
  const complete = (binding: AgentModelBinding | undefined) => binding ? { ...binding, accountId: binding.accountId ?? snapshot?.providers.find((item) => item.id === binding.providerId)?.accountId } : undefined
  const inherited = complete({ model: preset?.model ?? fallback.model, providerId: preset?.providerId ?? fallback.providerId,
    accountId: !preset?.providerId || preset.providerId === fallback.providerId ? fallback.accountId : undefined })!
  const room = roomId ? await deps.store.get<import('../contracts/rooms.js').Room>('room', roomId) : undefined
  const matchesRoom = room?.value.conversationKind === 'user_agent' && room.value.members.some((member) => member.participantAgentId === agent?.id)
  const override = matchesRoom ? room?.value.privateModelRef : undefined
  const main = complete(override ?? agent?.modelRef ?? inherited)!
  const fast = complete(agentFastModel(deps, agent ?? {}, main))
  const history = agent && deps.store ? await deps.store.list<import('../contracts/room-runs.js').RoomRunRecord>('room_run', { participantAgentId: agent.id, status: 'completed', limit: 100, summaryOnly: true }) : []
  const verifiedAt = (binding: AgentModelBinding | undefined) => history.find((row) => binding && row.value.model === binding.model && row.value.providerId === binding.providerId && row.value.accountId === binding.accountId)?.value.endedAt
  return { options, main, fast, mainVerifiedAt: verifiedAt(main), fastVerifiedAt: verifiedAt(fast), inheritedMain: inherited,
    inheritedFast: complete(agentFastModel(deps, {}, main)), mainSource: override ? 'room' : agent?.modelRef ? 'agent' : preset?.model ? 'preset' : 'default',
    fastSource: agent?.fastModelRef ? 'agent' : deps.peerModels?.roles()?.smallModel ? 'default' : 'main',
    roomOverride: override, mainAvailable: modelAvailable(options, main), fastAvailable: modelAvailable(options, fast, true) }
}
function modelAvailable(options: Array<{ model: string; providerId?: string; accountId?: string; available: boolean; fastAvailable: boolean }>, binding: AgentModelBinding | undefined, fast = false): boolean {
  return Boolean(binding && options.some((option) => option.providerId === binding.providerId && option.model === binding.model && (!binding.accountId || option.accountId === binding.accountId) && option.available && (!fast || option.fastAvailable)))
}
export async function assertAgentModel(deps: RoomRuntimeDeps, binding: AgentModelBinding, fast = false) {
  if (!binding.model) throw new Error('Configure a model before sending a message')
  if (deps.unsupportedProviderIds?.().includes(binding.providerId ?? '')) throw new Error(fast ? 'This model cannot run background Agent work' : 'This connection does not yet support scoped Agent tools; choose an API model connection')
  if (!deps.modelSnapshot) return
  const snapshot = await deps.modelSnapshot()
  const provider = snapshot.providers.find((item) => item.id === binding.providerId)
  if (!provider || !liveConnection(provider) || binding.accountId && binding.accountId !== provider.accountId || !isModelConnectionProfileUsable(provider) || !provider.models.includes(binding.model)) throw new Error('The selected model is unavailable; choose an available model')
}

/** Explicit selections must pin the exact account; omitted accounts cannot follow a replacement. */
export async function assertExplicitAgentModel(deps: RoomRuntimeDeps, binding: AgentModelBinding) {
  const { options } = await agentModelOptions(deps)
  if (!options.some((option) => option.available && option.providerId === binding.providerId &&
    option.accountId === binding.accountId && option.model === binding.model)) {
    throw new RoomStoreConflictError('The selected model is unavailable; refresh and choose a configured provider, account and model')
  }
}
