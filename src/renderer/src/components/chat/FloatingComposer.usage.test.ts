import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadUsageSnapshot } from '../../agent/thread-runtime-types'
import { resetUsageRequestCacheForTests } from '../../hooks/usage-request-cache'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { FloatingComposer } from './FloatingComposer'

const threadId = 'thr_composer_usage'
const usagePath = `/v1/usage?group_by=thread&thread_id=${threadId}`
const persistedBucket = {
  thread_id: threadId,
  input_tokens: 100,
  output_tokens: 20,
  cached_tokens: 80,
  cache_miss_tokens: 20,
  cache_hit_rate: 0.8,
  turns: 1,
  value_estimate_usd: 0.03,
  value_estimate_coverage: 'complete'
}

function liveUsage(totalTokens = 220): ThreadUsageSnapshot {
  return {
    inputTokens: totalTokens - 40,
    outputTokens: 40,
    reasoningTokens: 0,
    cachedTokens: 150,
    cacheMissTokens: 30,
    cacheHitRate: 5 / 6,
    lastRequestCacheHitRate: 0.92,
    totalTokens,
    costUsd: 0.02,
    costCny: null,
    tokenEconomySavingsTokens: 0,
    turns: 2,
    avgTtftMs: 900,
    avgTokensPerSecond: 45,
    turnAvgTtftMs: 900,
    turnAvgTokensPerSecond: 45
  }
}

describe('FloatingComposer usage wiring', () => {
  const previousState = useChatStore.getState()
  const previousLanguage = i18n.language
  const runtimeRequest = vi.fn()
  let renderer: ReactTestRenderer | undefined
  let buckets: typeof persistedBucket[]

  beforeEach(async () => {
    resetUsageRequestCacheForTests()
    buckets = [persistedBucket]
    runtimeRequest.mockReset().mockImplementation(async (path: string) => ({
      ok: true,
      status: 200,
      body: JSON.stringify(path === usagePath ? { buckets } : { sessions: [] })
    }))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('document', { activeElement: null, body: {} })
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('window', {
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      kunGui: { runtimeRequest }
    })
    await i18n.changeLanguage('en')
    useChatStore.setState({
      activeThreadId: threadId,
      activeThreadGoal: null,
      activeThreadTodos: null,
      threadLoadingId: null,
      lastTurnUsage: null,
      usageRefreshKey: 0,
      blocks: [{ kind: 'user', id: 'user-usage', text: 'Hello' }],
      route: 'chat',
      threads: [],
      workspaceRoot: '/test/composer-usage'
    })
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    useChatStore.setState(previousState)
    resetUsageRequestCacheForTests()
    vi.unstubAllGlobals()
    await i18n.changeLanguage(previousLanguage)
  })

  async function mountComposer(): Promise<void> {
    await act(async () => {
      renderer = create(createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: 'test-model',
        composerPickList: ['test-model'],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined
      }))
    })
  }

  function metricText(className: string): string {
    const metric = renderer!.root.findByProps({
      className: `ds-composer-usage-metric ${className} shrink-0 tabular-nums`
    })
    return metric.findAllByType('span').flatMap((span) =>
      span.children.filter((child) => typeof child === 'string')
    ).join(' ')
  }

  it('shows persisted session usage and refreshes it after a completed turn', async () => {
    await mountComposer()
    expect(runtimeRequest).toHaveBeenCalledWith(usagePath, 'GET')
    expect(metricText('ds-composer-usage-tokens')).toContain('120')
    expect(metricText('ds-composer-usage-cache')).toContain('80%')
    expect(metricText('ds-composer-usage-turns')).toContain('1')
    expect(metricText('ds-composer-usage-money')).toContain('$0.0300')

    buckets = [{ ...persistedBucket, output_tokens: 120, turns: 2 }]
    await act(async () => { useChatStore.setState({ usageRefreshKey: 1 }) })
    expect(metricText('ds-composer-usage-tokens')).toContain('220')
    expect(metricText('ds-composer-usage-turns')).toContain('2')
  })

  it('updates live usage through the composer while retaining persisted reference prices', async () => {
    await mountComposer()
    await act(async () => {
      useChatStore.setState({ lastTurnUsage: { threadId, snapshot: liveUsage() } })
    })
    expect(metricText('ds-composer-usage-tokens')).toContain('220')
    expect(metricText('ds-composer-usage-cache')).toContain('92%')
    const money = renderer!.root.findAll((node) =>
      typeof node.props.className === 'string' && node.props.className.includes('ds-composer-usage-money')
    )
    expect(money.flatMap((node) => node.children).join(' ')).toContain('$0.0300')

    await act(async () => {
      useChatStore.setState({ lastTurnUsage: { threadId, snapshot: liveUsage(320) } })
    })
    expect(metricText('ds-composer-usage-tokens')).toContain('320')
  })

  it('shows live usage before the first persisted summary is available', async () => {
    buckets = []
    useChatStore.setState({ lastTurnUsage: { threadId, snapshot: liveUsage() } })
    await mountComposer()
    expect(metricText('ds-composer-usage-tokens')).toContain('220')
    expect(metricText('ds-composer-usage-cache')).toContain('92%')
  })

  it('ignores live usage belonging to another thread', async () => {
    useChatStore.setState({ lastTurnUsage: { threadId: 'thr_other', snapshot: liveUsage() } })
    await mountComposer()
    expect(metricText('ds-composer-usage-tokens')).toContain('120')
    expect(metricText('ds-composer-usage-cache')).toContain('80%')
  })
})
