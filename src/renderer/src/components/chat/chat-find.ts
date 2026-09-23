import { create } from 'zustand'
import type { ChatBlock } from '../../agent/types'
import { groupTurns, stableTurnKey, type Turn } from './message-timeline-turns'

/**
 * In-conversation find. Hits are computed synchronously over the loaded
 * blocks — unlike the palette's server search, this surface only navigates
 * content the timeline can already render, so a jump never needs a fetch.
 */
export type ChatFindHit = {
  blockId: string
  turnKey: string
  /** One-line context shown as the row tooltip. */
  preview: string
}

type ChatFindJump = {
  threadId: string
  turnKey: string
  blockId: string | null
  nonce: number
}

type ChatFindState = {
  /** Thread whose find bar is open; null means closed. */
  openThreadId: string | null
  jump: ChatFindJump | null
}

export const useChatFindStore = create<ChatFindState>(() => ({
  openThreadId: null,
  jump: null
}))

let jumpNonce = 0

export function openChatFind(threadId: string): void {
  useChatFindStore.setState({ openThreadId: threadId })
}

export function closeChatFind(): void {
  useChatFindStore.setState({ openThreadId: null })
}

export function requestChatFindJump(threadId: string, turnKey: string, blockId: string | null): void {
  useChatFindStore.setState({
    jump: { threadId, turnKey, blockId, nonce: ++jumpNonce }
  })
}

/** Text a find query can match for each block kind. */
export function chatFindBlockText(block: ChatBlock): string {
  switch (block.kind) {
    case 'user':
    case 'assistant':
    case 'reasoning':
    case 'system':
      return block.text
    case 'tool':
    case 'compaction':
      return [block.summary, block.detail ?? '', block.kind === 'tool' ? (block.filePath ?? '') : '']
        .filter(Boolean)
        .join('\n')
    case 'approval':
      return [block.summary, block.toolName ?? ''].filter(Boolean).join('\n')
    case 'approval_review':
      return [block.summary, block.toolName ?? '', block.rationale ?? ''].filter(Boolean).join('\n')
    case 'user_input':
      return block.questions
        .map((question) =>
          [question.header, question.question, ...question.options.map((option) => option.label)]
            .filter(Boolean)
            .join(' ')
        )
        .join('\n')
    case 'review':
      return [block.title, block.reviewText ?? '', block.output?.overallExplanation ?? '']
        .filter(Boolean)
        .join('\n')
    case 'chart': {
      const spec = block.spec as { title?: unknown; description?: unknown }
      return [spec.title, spec.description]
        .filter((value): value is string => typeof value === 'string')
        .join('\n')
    }
    default:
      return ''
  }
}

function previewAroundMatch(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return ''
  const start = Math.max(0, at - 30)
  const end = Math.min(text.length, at + needle.length + 30)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`
}

function turnFindKey(turn: Turn, index: number): string {
  return stableTurnKey(turn, index)
}

/**
 * Collects find hits in display order. The turn key (not the index) travels
 * with each hit so a jump stays correct even if blocks stream in between
 * typing and navigating.
 */
export function collectChatFindHits(blocks: ChatBlock[], query: string): ChatFindHit[] {
  const needle = query.trim()
  if (!needle) return []
  const lowered = needle.toLowerCase()
  const turns = groupTurns(blocks)
  const hits: ChatFindHit[] = []
  turns.forEach((turn, turnIndex) => {
    const turnKey = turnFindKey(turn, turnIndex)
    const turnBlocks = turn.user ? [turn.user, ...turn.blocks] : turn.blocks
    for (const block of turnBlocks) {
      const text = chatFindBlockText(block)
      if (!text || !text.toLowerCase().includes(lowered)) continue
      hits.push({ blockId: block.id, turnKey, preview: previewAroundMatch(text, needle) })
    }
  })
  return hits
}
