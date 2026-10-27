import { describe, expect, it, vi } from 'vitest'
import type { AssistantHost, AssistantSummary } from '@kun/assistant-agent'
import { AssistantLiveSubscriptions } from './live-subscriptions'
describe('assistant notification subscriptions', () => {
  it('reuses a subscription and stops it when its assistant leaves or the account changes', () => {
    const close = vi.fn(), wake = vi.fn(), host = { subscribe: vi.fn(() => ({ stop: close, finished: new Promise<void>(() => {}) })) } as unknown as AssistantHost
    const subscriptions = new AssistantLiveSubscriptions(wake, vi.fn())
    const a = { id: 'a' } as AssistantSummary, b = { id: 'b' } as AssistantSummary
    subscriptions.reconcile(host, [a, b]); subscriptions.reconcile(host, [a, b])
    expect(host.subscribe).toHaveBeenCalledTimes(2)
    subscriptions.reconcile(host, [b]); expect(close).toHaveBeenCalledTimes(1)
    subscriptions.stop(); expect(close).toHaveBeenCalledTimes(2)
  })
})
