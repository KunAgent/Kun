import type { ChatBlock, NormalizedThread } from '../agent/types'
import {
  CLAW_MANAGED_INSTRUCTIONS_HEADING,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImPlatformCredentialV1,
  type ClawImProvider
} from '@shared/app-settings'
import type { ChatState } from './chat-store-types'
import { loadTurnModelMap, saveTurnModelMap } from './chat-store-helper-storage'

export function newClawChannel(
  provider: ClawImProvider,
  agentProfile?: Partial<ClawImAgentProfileV1>,
  platformCredential?: ClawImPlatformCredentialV1
): ClawImChannelV1 {
  const now = new Date().toISOString()
  const fallbackId = `im-${provider}-${Date.now()}`
  const defaultName = defaultClawProviderLabel(provider)
  const profileName = agentProfile?.name?.trim() || defaultName
  return {
    id: globalThis.crypto?.randomUUID?.() ?? fallbackId,
    provider,
    label: profileName,
    enabled: true,
    model: 'auto',
    threadId: '',
    workspaceRoot: '',
    conversations: [],
    agentProfile: {
      name: profileName,
      description: agentProfile?.description?.trim() ?? '',
      identity: agentProfile?.identity ?? '',
      personality: agentProfile?.personality ?? '',
      userContext: agentProfile?.userContext ?? '',
      replyRules: agentProfile?.replyRules ?? ''
    },
    ...(platformCredential ? { platformCredential } : {}),
    createdAt: now,
    updatedAt: now
  }
}

export function normalizeClawComposerModel(raw: string): string {
  const trimmed = raw.trim()
  return trimmed || 'auto'
}

export function activeClawChannel(
  state: Pick<ChatState, 'clawChannels' | 'activeClawChannelId'>
): ClawImChannelV1 | null {
  return state.clawChannels.find((channel) => channel.id === state.activeClawChannelId) ?? null
}

function addClawThreadId(ids: Set<string>, threadId: string | undefined): void {
  const id = threadId?.trim() ?? ''
  if (id) ids.add(id)
}

export function clawThreadIdsFromChannels(
  channels: ClawImChannelV1[]
): Set<string> {
  const ids = new Set<string>()
  for (const channel of channels) {
    addClawThreadId(ids, channel.threadId)
    for (const conversation of channel.conversations) {
      addClawThreadId(ids, conversation.localThreadId)
    }
  }
  return ids
}

export function clawThreadTitleLooksManaged(title: string | undefined): boolean {
  const trimmed = title?.trim() ?? ''
  return trimmed.startsWith(CLAW_MANAGED_INSTRUCTIONS_HEADING) ||
    trimmed.startsWith('[Claw:') ||
    trimmed.startsWith('[Claw IM:') ||
    trimmed.startsWith('[Claw]')
}

export function isClawThread(
  thread: Pick<NormalizedThread, 'id' | 'title'>,
  channels: ClawImChannelV1[] = []
): boolean {
  return clawThreadTitleLooksManaged(thread.title) || clawThreadIdsFromChannels(channels).has(thread.id)
}

export function optimisticUserModelLabel(
  composerModel: string,
  threadModel: string | undefined
): string | undefined {
  const composer = composerModel.trim()
  if (composer) return composer.toLowerCase() === 'auto' ? 'auto' : composer
  const model = threadModel?.trim()
  return model || undefined
}

export function rememberTurnModel(threadId: string, itemId: string, model: string): void {
  const thread = threadId.trim()
  const item = itemId.trim()
  const label = model.trim()
  if (!thread || !item || !label) return
  const key = `${thread}|${item}`
  const map = loadTurnModelMap()
  delete map[key]
  map[key] = label
  saveTurnModelMap(map)
}

export function hydrateBlockModelLabels(threadId: string, blocks: ChatBlock[]): ChatBlock[] {
  const map = loadTurnModelMap()
  let changed = false
  const next = blocks.map((block) => {
    if (block.kind !== 'user') return block
    if (block.modelLabel) return block
    const label = map[`${threadId}|${block.id}`]
    if (!label) return block
    changed = true
    return { ...block, modelLabel: label }
  })
  return changed ? next : blocks
}

function defaultClawProviderLabel(provider: ClawImProvider): string {
  if (provider === 'weixin') return 'weixin agent'
  return 'feishu agent'
}
