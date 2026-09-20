import type { RoomMember } from '../contracts/rooms.js'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { resolveRoleModel } from '../loop/title-generator.js'
import { isModelConnectionProfileUsable } from '../contracts/model-connections.js'

export type AgentModelBinding = { model: string; providerId?: string; accountId?: string }
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
  const options = snapshot?.providers.flatMap((provider) => provider.models.map((model) => ({
    model, providerId: provider.id, accountId: provider.accountId, label: model, providerLabel: provider.name,
    available: isModelConnectionProfileUsable(provider) && !unsupported.has(provider.id), groupAvailable: !unsupported.has(provider.id),
    fastAvailable: !unsupported.has(provider.id), reason: unsupported.has(provider.id) ? 'agent_scope_unsupported' : !isModelConnectionProfileUsable(provider) ? 'model_connection_unavailable' : undefined
  }))) ?? [{ ...deps.model(), label: deps.model().model, providerLabel: deps.model().providerId ?? 'Kun',
    available: Boolean(deps.model().model) && !unsupported.has(deps.model().providerId ?? ''), groupAvailable: !unsupported.has(deps.model().providerId ?? ''), fastAvailable: !unsupported.has(deps.model().providerId ?? '') }]
  const preset = agent ? deps.profiles()[agent.presetId] : undefined
  const fallback = snapshot?.defaultModel && snapshot.defaultProviderId ? { model: snapshot.defaultModel, providerId: snapshot.defaultProviderId, accountId: snapshot.defaultAccountId } : deps.model()
  const complete = (binding: AgentModelBinding | undefined) => binding ? { ...binding, accountId: binding.accountId ?? snapshot?.providers.find((item) => item.id === binding.providerId)?.accountId } : undefined
  const inherited = complete({ model: preset?.model ?? fallback.model, providerId: preset?.providerId ?? fallback.providerId,
    accountId: !preset?.providerId || preset.providerId === fallback.providerId ? fallback.accountId : undefined })!
  const main = complete(agent?.modelRef ?? inherited)!
  const fast = complete(agentFastModel(deps, agent ?? {}, main))
  const room = roomId ? await deps.store.get<import('../contracts/rooms.js').Room>('room', roomId) : undefined
  const override = room?.value.members.find((member) => member.participantAgentId === agent?.id)?.modelRef
  const history = agent && deps.store ? await deps.store.list<import('../contracts/room-runs.js').RoomRunRecord>('room_run', { participantAgentId: agent.id, status: 'completed', limit: 100, summaryOnly: true }) : []
  const verifiedAt = (binding: AgentModelBinding | undefined) => history.find((row) => binding && row.value.model === binding.model && row.value.providerId === binding.providerId && row.value.accountId === binding.accountId)?.value.endedAt
  return { options, main, fast, mainVerifiedAt: verifiedAt(main), fastVerifiedAt: verifiedAt(fast), inheritedMain: inherited,
    inheritedFast: complete(agentFastModel(deps, {}, main)), mainSource: agent?.modelRef ? 'agent' : preset?.model ? 'preset' : 'default',
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
  if (!provider || binding.accountId && binding.accountId !== provider.accountId || !isModelConnectionProfileUsable(provider) || !provider.models.includes(binding.model)) throw new Error('The selected model is unavailable; choose an available model')
}
