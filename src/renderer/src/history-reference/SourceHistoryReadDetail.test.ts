import { describe, expect, it, vi } from 'vitest'
import { sourceReadTurnIds } from './SourceHistoryReadDetail'
vi.mock('../store/chat-store', () => ({ useChatStore: { getState: vi.fn() } }))
vi.mock('../agent/registry', () => ({ getProvider: vi.fn() }))
vi.mock('../components/chat/thread-turn-target', () => ({ activateThreadTurnTarget: vi.fn() }))
vi.mock('./use-codex-reference-enabled', () => ({ useCodexReferenceEnabled: () => false }))

describe('historical tool-result navigation', () => {
  it('deduplicates turn pointers from bounded tool output', () => {
    const text = '[codex:session:turn-1 / item-1 / user_message]\nPrompt\n\n[ codex:invalid / item / x]\n[normal / item / x]\n[ codex:invalid2]\n[ codex:invalid3 / x]\n[ codex:invalid4 / x]\n[codex:session:turn-1 / item-2 / assistant_text]\nAnswer\n[codex:session:turn-2 / item-3 / user_message]\nNext'
    expect(sourceReadTurnIds(JSON.stringify({ text }))).toEqual(['codex:session:turn-1', 'codex:session:turn-2'])
  })
  it('leaves a failed or unrelated tool response without history navigation', () => {
    expect(sourceReadTurnIds(JSON.stringify({ error: 'missing source' }))).toEqual([])
    expect(sourceReadTurnIds('Source unavailable')).toEqual([])
  })
})
