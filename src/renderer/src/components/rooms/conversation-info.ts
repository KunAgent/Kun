import type { AgentDirectActivity, AgentIdentity, AgentModelBinding, RoomMember } from '@shared/rooms-api'
import { modelBindingKey } from './agent-client'

export type ConversationStatus = 'idle' | 'working' | 'queued' | 'approval' | 'input' | 'setup' | 'waiting' | 'paused' | 'archived'

/** What the private Agent is doing now; the user's pending decisions outrank plain activity. */
export function agentConversationStatus(agent: AgentIdentity | null | undefined,
  activity: AgentDirectActivity | null | undefined): ConversationStatus {
  if (agent?.archivedAt) return 'archived'
  if (activity?.approvals.length) return 'approval'
  if (activity?.userInputs.length) return 'input'
  if (activity?.active) return activity.active.status === 'pending' ? 'queued' : 'working'
  if (agent?.setup?.status === 'pending') return 'setup'
  return 'idle'
}

export function memberConversationStatus(member: RoomMember, responding: readonly string[],
  waiting: readonly string[]): ConversationStatus {
  if (!member.enabled) return 'paused'
  if (responding.includes(member.id)) return 'working'
  if (waiting.includes(member.id)) return 'waiting'
  return 'idle'
}

type ModelOption = { model: string; providerId?: string; accountId?: string; providerLabel?: string }

/** The provider's display name; options carry it, bindings only carry identifiers. */
export function modelProviderLabel(binding: AgentModelBinding | undefined, options: readonly ModelOption[] = []): string {
  if (!binding) return ''
  const key = modelBindingKey(binding)
  const option = options.find((item) => modelBindingKey(item) === key) ??
    options.find((item) => item.providerId === binding.providerId && item.model === binding.model)
  return option?.providerLabel ?? binding.providerId ?? ''
}

/** Accounts named after their provider add nothing; distinct accounts stay visible. */
export function modelAccountLabel(binding: AgentModelBinding | undefined): string {
  const account = binding?.accountId?.replace(/^account:/, '')
  if (!account || account === binding?.providerId) return ''
  return account
}

/** The last path segment names a workspace; the full path stays available as detail. */
export function workspaceName(path: string | undefined): string {
  if (!path) return ''
  return path.replaceAll('\\', '/').replace(/\/+$/, '').split('/').at(-1) ?? path
}
