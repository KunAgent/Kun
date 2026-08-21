/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { TurnUsageSummary } from '../../hooks/use-turn-usage'
import { TurnUsageRow } from './TurnUsageRow'

const usage: TurnUsageSummary = {
  turnId: 'turn-interaction',
  requests: 1,
  inputTokens: 1_000,
  outputTokens: 200,
  reasoningTokens: 0,
  cachedTokens: 800,
  cacheWriteTokens: 0,
  totalTokens: 1_200,
  actualCost: null,
  referenceEstimateUsd: 0.01,
  referencePriceBreakdown: null,
  estimateCoverage: 'complete',
  providerIds: ['codex'],
  models: ['gpt-5.6-sol']
}

function setReactActEnvironment(value: boolean): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = value
}

describe('TurnUsageRow interactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    setReactActEnvironment(true)
    vi.useFakeTimers()
    await i18n.changeLanguage('en')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    await act(async () => root.render(createElement(TurnUsageRow, { usage })))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.querySelectorAll('[data-turn-usage-details]').forEach((node) => node.remove())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setReactActEnvironment(false)
  })

  it('opens after hover delay and stays open while the pointer crosses into the card', async () => {
    const trigger = container.querySelector<HTMLButtonElement>('[data-turn-usage]')!
    await act(async () => trigger.dispatchEvent(new Event('pointerover', { bubbles: true })))
    await act(async () => vi.advanceTimersByTimeAsync(119))
    expect(document.querySelector('[data-turn-usage-details]')).toBeNull()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    const card = document.querySelector<HTMLElement>('[data-turn-usage-details]')
    expect(card).not.toBeNull()

    await act(async () => {
      trigger.dispatchEvent(new Event('pointerout', { bubbles: true }))
      card!.dispatchEvent(new Event('pointerover', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(document.querySelector('[data-turn-usage-details]')).not.toBeNull()
  })

  it('opens on focus, pins on click, and dismisses outside', async () => {
    const trigger = container.querySelector<HTMLButtonElement>('[data-turn-usage]')!
    await act(async () => trigger.focus())
    expect(document.querySelector('[data-turn-usage-details]')).not.toBeNull()

    await act(async () => trigger.click())
    expect(trigger.dataset.pinned).toBe('true')
    await act(async () => {
      trigger.dispatchEvent(new Event('pointerout', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(document.querySelector('[data-turn-usage-details]')).not.toBeNull()

    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(document.querySelector('[data-turn-usage-details]')).toBeNull()
  })

  it('dismisses a pinned card with Escape and restores trigger focus', async () => {
    const trigger = container.querySelector<HTMLButtonElement>('[data-turn-usage]')!
    await act(async () => trigger.click())
    expect(document.querySelector('[data-turn-usage-details]')).not.toBeNull()

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.querySelector('[data-turn-usage-details]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
