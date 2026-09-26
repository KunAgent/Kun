import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import {
  collectWindowContextInstructions,
  WINDOW_INIT_ITEM_PREFIX
} from './context-window-instructions.js'

function boundary(id: string): TurnItem {
  return {
    id, turnId: 't', threadId: 'th',
    kind: 'context_window', role: 'system', status: 'completed', createdAt: 'c',
    schemaVersion: 1, windowId: id, previousWindowId: null, reason: 'model',
    sourceHistoryRevision: 1, splitBefore: { kind: 'seq', seq: 0 },
    initializationRef: 'init', operationId: `op-${id}`, replacedTokens: 0
  }
}

function initItem(id: string, content: string): TurnItem {
  return {
    id, turnId: 't', threadId: 'th',
    kind: 'runtime_context_source', role: 'system', status: 'completed',
    contextKind: 'host-control', createdAt: 'c', content
  }
}

describe('collectWindowContextInstructions', () => {
  it('collects initialization items after the latest boundary plus the transient notice', () => {
    const history: TurnItem[] = [
      { ...initItem('cw_init_old', 'stale window init'), id: 'cw_init_old' },
      boundary('win-1'),
      initItem(`${WINDOW_INIT_ITEM_PREFIX}op-1`, 'current window init'),
      { id: 'u2', turnId: 't', threadId: 'th', kind: 'user_message', role: 'user', status: 'completed', createdAt: 'c', text: 'after' }
    ]
    const instructions = collectWindowContextInstructions(history, 'transient notice')
    expect(instructions).toEqual(['current window init', 'transient notice'])
  })

  it('returns nothing without a boundary or notice and ignores non-init host control', () => {
    const history: TurnItem[] = [
      initItem('other_host_control', 'not a window init'),
      { id: 'u1', turnId: 't', threadId: 'th', kind: 'user_message', role: 'user', status: 'completed', createdAt: 'c', text: 'plain' }
    ]
    expect(collectWindowContextInstructions(history)).toEqual([])
    expect(collectWindowContextInstructions(history, '  ')).toEqual([])
  })

  it('P2-b: re-collecting from a rebuilt post-transition history yields the NEW window init', () => {
    // The send-boundary fallback rebuilds history after a transition; the
    // instructions must be re-collected from THAT history, never reused from
    // the first preflight's window.
    const rebuilt: TurnItem[] = [
      boundary('win-1'),
      initItem(`${WINDOW_INIT_ITEM_PREFIX}op-1`, 'old window 1 init'),
      boundary('win-2'),
      initItem(`${WINDOW_INIT_ITEM_PREFIX}op-2`, 'new window 2 init'),
      { id: 'u3', turnId: 't', threadId: 'th', kind: 'user_message', role: 'user', status: 'completed', createdAt: 'c', text: 'after fallback' }
    ]
    const stale = collectWindowContextInstructions([rebuilt[0]!, rebuilt[1]!], undefined)
    expect(stale).toEqual(['old window 1 init'])
    const fresh = collectWindowContextInstructions(rebuilt, undefined)
    expect(fresh).toEqual(['new window 2 init'])
    expect(fresh.some((entry) => entry.includes('old window 1'))).toBe(false)
  })

  it('collects initialization for the active window zero before any boundary', () => {
    const history: TurnItem[] = [initItem(`${WINDOW_INIT_ITEM_PREFIX}op-0`, 'window 0 init')]
    expect(collectWindowContextInstructions(history)).toEqual(['window 0 init'])
  })
})
