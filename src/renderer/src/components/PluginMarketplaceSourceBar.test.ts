import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PluginMarketplaceSourceBar } from './PluginMarketplaceSourceBar'
import { PluginSection } from './PluginMarketplaceItemPanels'
import type { MarketplaceItem } from './plugin-marketplace-config'

const t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}|${Object.values(values).join('|')}` : key

const SOURCES = [{ id: 'youdao', label: '有道市场' }]

function bar(overrides: Partial<Parameters<typeof PluginMarketplaceSourceBar>[0]> = {}): string {
  return renderToStaticMarkup(createElement(PluginMarketplaceSourceBar, {
    sources: SOURCES,
    filter: 'all',
    onFilter: vi.fn(),
    syncing: false,
    statuses: [{ sourceId: 'youdao', label: '有道市场', fetchedAt: Date.UTC(2026, 9, 10), offline: false }],
    onRefresh: vi.fn(),
    t,
    ...overrides
  }))
}

describe('PluginMarketplaceSourceBar', () => {
  it('lists All, Kun and every registered market as filter chips', () => {
    const html = bar()
    expect(html).toContain('marketSourceAll')
    expect(html).toContain('marketSourceKun')
    expect(html).toContain('有道市场')
    expect(html).toContain('marketSyncedAt')
  })

  it('renders nothing when no market is registered (for example the remote web build)', () => {
    expect(bar({ sources: [], statuses: [] })).toBe('')
  })

  it('shows the syncing state while a sync is running', () => {
    const html = bar({ syncing: true })
    expect(html).toContain('marketSyncing')
    expect(html).not.toContain('marketSyncedAt')
    expect(html).toContain('disabled')
  })

  it('tells the user when the list on screen is the offline cache', () => {
    const html = bar({
      statuses: [{ sourceId: 'youdao', label: '有道市场', fetchedAt: Date.UTC(2026, 9, 9), offline: true, error: 'network down' }]
    })
    expect(html).toContain('marketOfflineCache')
    expect(html).not.toContain('marketSyncedAt')
  })

  it('surfaces a load failure when there is nothing cached to show', () => {
    const html = bar({ statuses: [{ sourceId: 'youdao', label: '有道市场', offline: false, error: 'HTTP 503' }] })
    expect(html).toContain('marketLoadFailed')
    expect(html).toContain('HTTP 503')
  })
})

describe('PluginSection market badge', () => {
  const market: MarketplaceItem = {
    id: 'hr-recruitment',
    kind: 'skill',
    title: '招聘助手',
    description: '筛选简历',
    detail: 'LobsterAI · youdao · v1.2.5',
    group: 'recommended',
    market: { sourceId: 'youdao', sourceLabel: '有道市场', version: '1.2.5' }
  }
  const plain: MarketplaceItem = { id: 'bug-hunt', kind: 'skill', title: 'Bug hunt', description: 'd', group: 'recommended' }

  function section(items: MarketplaceItem[]): string {
    return renderToStaticMarkup(createElement(PluginSection, {
      title: 'Section',
      emptyText: 'empty',
      items,
      busyId: null,
      isInstalled: () => false,
      onAdd: vi.fn(async () => undefined),
      t
    }))
  }

  it('marks market cards with their market name and version', () => {
    const html = section([market])
    expect(html).toContain('有道市场')
    expect(html).toContain('title="v1.2.5"')
    expect(html).toContain('LobsterAI · youdao · v1.2.5')
  })

  it('leaves Kun-owned cards without a market badge', () => {
    expect(section([plain])).not.toContain('有道市场')
  })

  it('keeps the same id from two markets as separate cards', () => {
    const other: MarketplaceItem = { ...market, market: { sourceId: 'other', sourceLabel: 'Other' } }
    const html = section([market, other])
    expect(html.match(/hr-recruitment|招聘助手/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('Other')
  })
})
