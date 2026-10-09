import { describe, expect, it } from 'vitest'
import type { MarketCatalog, MarketMcpInstallPlan, MarketSourceInfo } from '@shared/market/market-types'
import {
  auditMcpConfigSupplyChain,
  itemKey,
  mergeMcpJsonConfig,
  type MarketplaceItem
} from './plugin-marketplace-config'
import {
  groupMarketItemsBySource,
  marketItemsFromCatalogs,
  marketLanguage,
  matchesMarketSource,
  mcpConfigFromMarketPlan,
  pickMarketText
} from './plugin-marketplace-market'

const SOURCE: MarketSourceInfo = { id: 'youdao', label: { en: 'Youdao Market', zh: '有道市场' } }
const OTHER: MarketSourceInfo = { id: 'other', label: { en: 'Other Market' } }

const CATALOG: MarketCatalog = {
  sourceId: 'youdao',
  fetchedAt: 1,
  skillTags: [],
  mcpCategories: [],
  skills: [
    {
      sourceId: 'youdao',
      id: 'hr-recruitment',
      name: { en: 'HR Recruitment', zh: '招聘助手' },
      description: { en: 'Screen resumes', zh: '筛选简历' },
      version: '1.2.5',
      tags: [],
      downloadUrl: 'https://cdn.example.test/hr.zip',
      origin: { author: 'LobsterAI', from: 'youdao' }
    },
    { sourceId: 'youdao', id: 'code-review', name: { en: 'Code Review' }, description: {}, tags: [], downloadUrl: 'https://cdn.example.test/cr.zip' }
  ],
  mcpServers: [
    {
      sourceId: 'youdao',
      id: 'tavily',
      name: { en: 'Tavily', zh: 'Tavily 搜索' },
      description: { en: 'Web search', zh: '网页搜索' },
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      requiredEnvKeys: ['TAVILY_API_KEY'],
      optionalEnvKeys: []
    },
    {
      sourceId: 'youdao',
      id: 'github',
      name: { en: 'GitHub' },
      description: {},
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      requiredEnvKeys: [],
      optionalEnvKeys: []
    }
  ]
}

const t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key

describe('market item conversion', () => {
  const reservedIds = { skill: new Set(['code-review']), mcp: new Set(['github']) }

  it('labels every card with its market and localizes copy', () => {
    const zh = marketItemsFromCatalogs([{ source: SOURCE, catalog: CATALOG }], { language: 'zh', t, reservedIds })
    const hr = zh.find((item) => item.id === 'hr-recruitment')
    expect(hr).toMatchObject({
      kind: 'skill',
      title: '招聘助手',
      description: '筛选简历',
      detail: 'LobsterAI · youdao · v1.2.5',
      group: 'recommended',
      market: { sourceId: 'youdao', sourceLabel: '有道市场', version: '1.2.5' }
    })
    const en = marketItemsFromCatalogs([{ source: SOURCE, catalog: CATALOG }], { language: 'en', t, reservedIds })
    expect(en.find((item) => item.id === 'hr-recruitment')?.market?.sourceLabel).toBe('Youdao Market')
  })

  it('skips ids Kun already ships so a market never duplicates a built-in card', () => {
    const items = marketItemsFromCatalogs([{ source: SOURCE, catalog: CATALOG }], { language: 'en', t, reservedIds })
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual(['skill:hr-recruitment', 'mcp:tavily'])
  })

  it('flags MCP servers that need keys and exposes the secret permission', () => {
    const tavily = marketItemsFromCatalogs([{ source: SOURCE, catalog: CATALOG }], { language: 'en', t, reservedIds })
      .find((item) => item.id === 'tavily')
    expect(tavily?.supplyChain?.permissions).toEqual(['command', 'network', 'secret'])
    expect(tavily?.market?.requiredEnvKeys).toEqual(['TAVILY_API_KEY'])
    expect(tavily?.detail).toContain('TAVILY_API_KEY')
    // The command is only known after the main process pins the version.
    expect(tavily?.mcpConfig).toBeUndefined()
  })

  it('gives the same id from two markets distinct card keys', () => {
    const a: MarketplaceItem = { id: 'x', kind: 'skill', group: 'recommended', market: { sourceId: 'a', sourceLabel: 'A' } }
    const b: MarketplaceItem = { ...a, market: { sourceId: 'b', sourceLabel: 'B' } }
    expect(itemKey(a)).not.toBe(itemKey(b))
    expect(itemKey({ id: 'x', kind: 'skill' })).toBe('skill:x')
  })
})

describe('market filters', () => {
  const items = marketItemsFromCatalogs(
    [{ source: SOURCE, catalog: CATALOG }],
    { language: 'en', t, reservedIds: { skill: new Set(), mcp: new Set() } }
  )

  it('splits cards by source filter', () => {
    const own: MarketplaceItem = { id: 'mine', kind: 'skill', group: 'personal' }
    expect(matchesMarketSource(own, 'all')).toBe(true)
    expect(matchesMarketSource(own, 'builtin')).toBe(true)
    expect(matchesMarketSource(own, 'youdao')).toBe(false)
    const market = items[0] as MarketplaceItem
    expect(matchesMarketSource(market, 'builtin')).toBe(false)
    expect(matchesMarketSource(market, 'youdao')).toBe(true)
  })

  it('groups cards per source in registration order and drops empty sources', () => {
    const sections = groupMarketItemsBySource(items, [OTHER, SOURCE], 'zh')
    expect(sections.map((section) => [section.sourceId, section.label, section.items.length])).toEqual([
      ['youdao', '有道市场', 4]
    ])
  })

  it('picks the right language with fallbacks', () => {
    expect(marketLanguage('zh-CN')).toBe('zh')
    expect(marketLanguage('ja')).toBe('en')
    expect(pickMarketText({ zh: '中' }, 'en')).toBe('中')
    expect(pickMarketText({ en: 'EN' }, 'zh')).toBe('EN')
  })
})

describe('market MCP install plan', () => {
  const pinned: MarketMcpInstallPlan = {
    transport: 'stdio',
    id: 'tavily',
    command: 'npx',
    args: ['-y', 'tavily-mcp@0.2.9'],
    requiredEnvKeys: ['TAVILY_API_KEY'],
    optionalEnvKeys: [],
    pinned: { packageName: 'tavily-mcp', version: '0.2.9' }
  }

  it('builds a config Kun accepts, with empty placeholders for required keys', () => {
    const config = mcpConfigFromMarketPlan(pinned)
    expect(auditMcpConfigSupplyChain(config)).toMatchObject({ ok: true, permissions: expect.arrayContaining(['secret']) })
    const merged = mergeMcpJsonConfig('', config)
    const servers = (JSON.parse(merged.text) as { servers: Record<string, { env: Record<string, string>; command: string }> }).servers
    expect(servers.tavily?.env).toEqual({ TAVILY_API_KEY: '' })
    expect(servers.tavily?.command).toBe('npx')
  })

  it('the unpinned catalog spec would have been rejected by the audit', () => {
    const unpinned = mcpConfigFromMarketPlan({ ...pinned, args: ['-y', 'tavily-mcp@latest'] })
    expect(auditMcpConfigSupplyChain(unpinned).ok).toBe(false)
  })

  it('builds https remote servers', () => {
    const config = mcpConfigFromMarketPlan({
      transport: 'remote',
      id: 'remote',
      url: 'https://example.com/mcp',
      requiredEnvKeys: [],
      optionalEnvKeys: []
    })
    expect(auditMcpConfigSupplyChain(config).ok).toBe(true)
  })
})
