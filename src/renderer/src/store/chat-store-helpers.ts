import type { ChatBlock } from '../agent/types'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import {
  CLAW_MODEL_IDS,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImPlatformCredentialV1,
  type ClawImProvider,
  type ClawModel
} from '@shared/app-settings'
import type { ChatState } from './chat-store-types'

const COMPOSER_MODEL_STORAGE_KEY = 'deepseekgui.composerModel'
const TURN_MODEL_STORAGE_KEY = 'deepseekgui.turnModelLabel'

export const CLAW_COMPOSER_MODEL_IDS = [...CLAW_MODEL_IDS]

export function readStoredComposerModel(allowedIds: readonly string[]): string {
  try {
    const raw = localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)
    if (raw === null) return ''
    if (raw === '') return ''
    if (allowedIds.includes(raw)) return raw
  } catch {
    /* ignore */
  }
  return ''
}

export function persistComposerModel(model: string): void {
  try {
    localStorage.setItem(COMPOSER_MODEL_STORAGE_KEY, model)
  } catch {
    /* ignore */
  }
}

export function mergeComposerPickList(upstreamOk: boolean, upstreamIds: string[]): string[] {
  const ordered = new Set<string>()
  ordered.add('auto')
  for (const id of DEFAULT_COMPOSER_MODEL_IDS) {
    if (id !== 'auto') ordered.add(id)
  }
  if (upstreamOk) {
    for (const id of upstreamIds) {
      if (id.trim()) ordered.add(id.trim())
    }
  }
  const tail = [...ordered].filter((id) => id !== 'auto').sort((a, b) => a.localeCompare(b))
  return ['auto', ...tail]
}

export function newClawChannel(
  provider: ClawImProvider,
  agentProfile?: Partial<ClawImAgentProfileV1>,
  platformCredential?: ClawImPlatformCredentialV1
): ClawImChannelV1 {
  const now = new Date().toISOString()
  const fallbackId = `im-${provider}-${Date.now()}`
  const profileName = agentProfile?.name?.trim() ?? ''
  return {
    id: globalThis.crypto?.randomUUID?.() ?? fallbackId,
    provider,
    label: profileName || defaultClawProviderLabel(provider),
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

export function normalizeClawComposerModel(raw: string): ClawModel {
  return raw === 'deepseek-v4-pro' || raw === 'deepseek-v4-flash' ? raw : 'auto'
}

export function activeClawChannel(
  state: Pick<ChatState, 'clawChannels' | 'activeClawChannelId'>
): ClawImChannelV1 | null {
  return state.clawChannels.find((channel) => channel.id === state.activeClawChannelId) ?? null
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
  if (!threadId || !itemId || !model.trim()) return
  const key = `${threadId}|${itemId}`
  const map = loadTurnModelMap()
  if (map[key] === model) return
  map[key] = model
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
  void provider
  return 'Feishu / Lark'
}

function loadTurnModelMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TURN_MODEL_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string' && value) out[key] = value
      }
      return out
    }
    return {}
  } catch {
    return {}
  }
}

function saveTurnModelMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(TURN_MODEL_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* localStorage may be unavailable (private window, quota) */
  }
}
