import { describe, expect, it } from 'vitest'
import type { CoreTurnItemJson } from './kun-contract-runtime'
import { restoredThreadLiveProjection } from './kun-runtime-thread-live-projection'
import { chatBlockFromItem } from './kun-mapper-events'
import { normalizeKunTurnItem, type KunEventNormalizerDeps } from './kun-event-normalizer'

const item = (kind: 'assistant_text' | 'assistant_reasoning', renderMode?: 'plain-text' | 'safe-markdown'): CoreTurnItemJson => ({
  id: kind, kind, threadId: 'paper-thread', turnId: 'paper-turn', role: 'assistant',
  status: 'running', createdAt: '', text: '# Partial answer\n\n![private](https://untrusted.test)',
  ...(renderMode ? { renderMode } : {})
})

describe('constrained answer hydration', () => {
  it.each(['plain-text', 'safe-markdown'] as const)('keeps %s policy before exposing a running reply', (renderMode) => {
    const items = [item('assistant_text', renderMode), item('assistant_reasoning', renderMode)]
    for (const value of items) {
      expect(normalizeKunTurnItem(value, undefined, {} as KunEventNormalizerDeps))
        .toMatchObject({ type: 'assistant_item_upserted', payload: { renderMode, text: value.text } })
    }
    const result = restoredThreadLiveProjection(items, 'paper-turn', 'running')
    expect(result.liveProjection).toBeUndefined()
    expect(result.liveItemIds.size).toBe(0)
    expect(items.filter(value => !result.liveItemIds.has(value.id)).map(value => chatBlockFromItem(value)))
      .toEqual(items.map(value => expect.objectContaining({ id: value.id, renderMode, text: value.text })))
  })

  it('keeps ordinary Work/Code streaming in the existing live projection', () => {
    const result = restoredThreadLiveProjection([item('assistant_text')], 'paper-turn', 'running')
    expect(result.liveProjection?.assistant?.text).toContain('# Partial answer')
    expect(result.liveItemIds.has('assistant_text')).toBe(true)
  })
})
