import type { ToolBlock } from '../agent/types'
import type { ChatState } from '../store/chat-store-types'

type Progress = { kind: 'tool'; tool: ToolBlock } | { kind: 'assistant'; text: string } | { kind: 'thinking' | 'working' }
type Candidate = { kind: 'assistant' | 'thinking'; text?: string; at: number; order: number }

const timestamp = (value: string | undefined): number => Date.parse(value ?? '') || 0
const preview = (value: string): string => {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 180 ? `${text.slice(0, 180).trimEnd()}…` : text
}

/** Select the current phase, rather than letting an earlier assistant paragraph win forever. */
export function currentPetProgress(state: Pick<ChatState,
  'blocks' | 'currentTurnId' | 'liveAssistant' | 'liveAssistantItemId' | 'liveAssistantTurnId' | 'liveAssistantCreatedAt' |
  'liveReasoning' | 'liveReasoningItemId' | 'liveReasoningTurnId' | 'liveReasoningCreatedAt'>): Progress {
  const candidates: Candidate[] = []
  let runningTool: ToolBlock | undefined
  for (let index = 0; index < state.blocks.length; index++) {
    const block = state.blocks[index]
    if (state.currentTurnId && block.turnId && block.turnId !== state.currentTurnId) continue
    if (block.kind === 'tool') {
      if (block.status === 'running') runningTool = block
      else candidates.push({ kind: 'thinking', at: timestamp(block.createdAt), order: index })
    } else if ((block.kind === 'assistant' || block.kind === 'reasoning') && block.text.trim()) {
      candidates.push({ kind: block.kind === 'assistant' ? 'assistant' : 'thinking',
        text: block.kind === 'assistant' ? preview(block.text) : undefined, at: timestamp(block.createdAt), order: index })
    }
  }
  if (runningTool) return { kind: 'tool', tool: runningTool }
  const live = (kind: 'assistant' | 'thinking', text: string, itemId?: string, turnId?: string, createdAt?: string): void => {
    if (!text.trim() || (state.currentTurnId && turnId && state.currentTurnId !== turnId)) return
    const index = itemId ? state.blocks.findIndex((block) => block.id === itemId) : -1
    candidates.push({ kind, text: kind === 'assistant' ? preview(text) : undefined, at: timestamp(createdAt),
      order: index >= 0 ? index : state.blocks.length + (kind === 'thinking' ? 1 : 0) })
  }
  live('assistant', state.liveAssistant, state.liveAssistantItemId, state.liveAssistantTurnId, state.liveAssistantCreatedAt)
  live('thinking', state.liveReasoning, state.liveReasoningItemId, state.liveReasoningTurnId, state.liveReasoningCreatedAt)
  const latest = candidates.sort((a, b) => b.at - a.at || b.order - a.order)[0]
  return latest?.kind === 'assistant' ? { kind: 'assistant', text: latest.text ?? '' }
    : { kind: latest ? 'thinking' : 'working' }
}
