import { describe, expect, it, vi } from 'vitest'
import { pageText } from './page-model.js'
import { key } from './keys.test-support.js'
import { stripAnsi } from './layout.js'
import {
  ProviderQuotaPage,
  providerQuotaBody,
  providerQuotaVisibleWidth
} from './provider-quota.js'
import type { ProviderQuotaListResponse } from '../contracts/provider-quota.js'

const snapshot: ProviderQuotaListResponse = {
  entries: [
    {
      providerId: 'codex',
      providerName: 'Codex subscription',
      status: 'available',
      summary: 'plus',
      metrics: [
        {
          id: 'primary',
          label: 'Primary usage window',
          unit: 'percent',
          usedPercent: 18,
          resetsAt: '2026-07-28T02:30:00.000Z'
        },
        {
          id: 'secondary',
          label: 'Weekly usage window',
          unit: 'percent',
          usedPercent: 64,
          resetsAt: '2026-08-03T01:30:00.000Z'
        }
      ],
      localCost: {
        kind: 'reference_api_estimate',
        currency: 'USD',
        today: { requests: 2, totalTokens: 1_500, amount: 0.025, coverage: 'complete' },
        last30Days: { requests: 8, totalTokens: 12_000, amount: 0.15, coverage: 'partial' },
        updatedAt: '2026-07-28T01:31:00.000Z'
      }
    },
    {
      providerId: 'deepseek',
      providerName: 'DeepSeek',
      status: 'available',
      metrics: [{
        id: 'balance',
        label: 'Account balance',
        unit: 'CNY',
        remaining: 40.76
      }]
    },
    {
      providerId: 'custom',
      providerName: 'Custom provider',
      status: 'unsupported',
      metrics: [],
      message: 'No supported quota endpoint is available.'
    }
  ],
  refreshedAt: '2026-07-28T01:31:00.000Z'
}

describe('provider quota TUI', () => {
  it.each([120, 80, 42])('renders useful quota content within %i columns', (width) => {
    const lines = providerQuotaBody(snapshot, width, Date.parse('2026-07-28T01:31:00.000Z'))
    const plain = lines.map(stripAnsi).join('\n')

    expect(plain).toContain('Codex subscription')
    expect(plain).toContain('18%')
    expect(plain).toContain('Local API reference value')
    expect(plain).toContain('$0.025')
    expect(plain).toContain('partial')
    expect(plain).toContain('API reference estimate')
    expect(plain).toContain('DeepSeek')
    expect(plain).toContain('40.76 CNY')
    expect(plain).toContain('Custom provider')
    expect(providerQuotaVisibleWidth(lines)).toBeLessThanOrEqual(width)
  })

  it('shows loading and refresh errors without discarding the previous snapshot', async () => {
    const requestRender = vi.fn()
    let reject = false
    const load = vi.fn(async () => {
      if (reject) throw new Error('refresh failed with token=super-secret-value')
      return snapshot
    })
    const dialog = new ProviderQuotaPage(
      load,
      vi.fn(),
      requestRender,
      () => Date.parse('2026-07-28T01:31:00.000Z')
    )

    const pending = dialog.refresh()
    expect(pageText(dialog.view({ width: 70, height: 12 }))).toContain('Loading provider quota')
    await pending
    expect(pageText(dialog.view({ width: 70, height: 12 }))).toContain('Codex subscription')

    reject = true
    await dialog.refresh()
    const rendered = pageText(dialog.view({ width: 70, height: 12 }))
    expect(rendered).toContain('Refresh failed')
    expect(rendered).toContain('Codex subscription')
    expect(rendered).not.toContain('super-secret-value')
  })

  it('scrolls a constrained route and supports refresh and close controls', async () => {
    const requestRender = vi.fn()
    const close = vi.fn()
    const load = vi.fn(async () => snapshot)
    const dialog = new ProviderQuotaPage(
      load,
      close,
      requestRender,
      () => Date.parse('2026-07-28T01:31:00.000Z')
    )
    await dialog.refresh()

    const first = pageText(dialog.view({ width: 60, height: 9 }))
    dialog.handleKey(key('\x1b[6~'))
    const second = pageText(dialog.view({ width: 60, height: 9 }))
    expect(second).not.toBe(first)
    expect(second).toContain('/')

    dialog.handleKey(key('r'))
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    dialog.handleKey(key('\x1b'))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
