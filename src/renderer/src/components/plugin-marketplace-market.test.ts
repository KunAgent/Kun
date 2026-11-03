import { describe, expect, it } from 'vitest'
import type { MarketCatalog, MarketMcpInstallPlan, MarketSourceInfo } from '@shared/market/market-types'
import {
  auditMcpConfigSupplyChain,
  itemKey,
  mergeMcpJsonConfig,
  type MarketplaceItem
} from './plugin-marketplace-config'
import {
  marketItemsFromCatalogs,
  marketLanguage,
  matchesMarketSource,
  mcpConfigFromMarketPlan,
  pickMarketText
} from './plugin-marketplace-market'

const SOURCE: MarketSourceInfo = { id: 'youdao', label: { en: 'Youdao Market', zh: '有道市场' } }

const CATALOG: MarketCatalog = {
  sourceId: 'youdao',
  fetchedAt: 1,
  skillTags: [{ id: 'utility', name: { en: 'Productivity', zh: '效率工具' } }],
  mcpCategories: [{ id: 'search', name: { en: 'Search', zh: '搜索' } }],
  skills: [
    {
      sourceId: 'youdao',
      id: 'hr-recruitment',
      name: { en: 'HR Recruitment', zh: '招聘助手' },
      description: { en: 'Screen resumes', zh: '筛选简历' },
      version: '1.2.5',
      tags: ['utility'],
      downloadUrl: 'https://cdn.example.test/hr.zip',
      origin: { author: 'LobsterAI', from: 'youdao', url: 'https://github.com/example/hr' }
    },
    { sourceId: 'youdao', id: 'code-review', name: { en: 'Code Review' }, description: {}, tags: [], downloadUrl: 'https://cdn.example.test/cr.zip' }
  ],
  mcpServers: [
    {
      sourceId: 'youdao',
      id: 'tavily',
      name: { en: 'Tavily', zh: 'Tavily 搜索' },
      description: { en: 'Web search', zh: '网页搜索' },
      category: 'search',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      requiredEnvKeys: ['TAVILY_API_KEY'],
      optionalEnvKeys: ['TAVILY_REGION']
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

describe('market item conversion', () => {
  const reservedIds = { skill: new Set(['code-review']), mcp: new Set(['github']) }

  it('labels every card with its market, localizes copy and keeps provenance', () => {
    const zh = marketItemsFromCatalogs([{ source: SOURCE, catalog: CATALOG }], { language: 'zh', reservedIds })
    const hr = zh.find((item) => item.id === 'hr-recruitment')
    expect(hr).toMatchObject({
      kind: 'skill',
      title: '招聘助手',
      description: '筛选简历',
      group: 'recommended',
      categories: ['utility'],
      market: {
        sourceId: 'youdao',
        sourceLabel: '有道市场',
        version: '1.2.5',
        author: 'LobsterAI',
        originLabel: 'LobsterAI · youdao',
        originUrl: 'https://github.com/example/hr'
      }
    })
    const en = marketItemsFromCatalogs([{ source: SOURCE, catalog: CATALOG }], { language: 'en', reservedIds })
    expect(en.find((item) => item.id === 'hr-recruitment')?.market?.sourceLabel).toBe('Youdao Market')
  })

  it('skips ids Kun already ships so a market never duplicates a built-in card', () => {
    const items = marketItemsFromCatalogs([{ source: SOURCE, catalog: CATALOG }], { language: 'en', reservedIds })
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual(['skill:hr-recruitment', 'mcp:tavily'])
  })

  it('carries what the detail drawer and config sheet need for MCP servers', () => {
    const tavily = marketItemsFromCatalogs([{ source: SOURCE, catalog: CATALOG }], { language: 'en', reservedIds })
      .find((item) => item.id === 'tavily')
    expect(tavily?.supplyChain?.permissions).toEqual(['command', 'network', 'secret'])
    expect(tavily?.categories).toEqual(['search'])
    expect(tavily?.market).toMatchObject({
      requiredEnvKeys: ['TAVILY_API_KEY'],
      optionalEnvKeys: ['TAVILY_REGION'],
      launch: 'npx -y tavily-mcp@latest'
    })
    // The command is only written after the main process pins the version.
    expect(tavily?.mcpConfig).toBeUndefined()
  })

  it('ignores non-https origin links', () => {
    const catalog: MarketCatalog = {
      ...CATALOG,
      skills: [{ ...CATALOG.skills[0]!, origin: { author: 'x', url: 'http://example.com' } }]
    }
    const [item] = marketItemsFromCatalogs([{ source: SOURCE, catalog }], { language: 'en', reservedIds })
    expect(item?.market?.originUrl).toBeUndefined()
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
    { language: 'en', reservedIds: { skill: new Set(), mcp: new Set() } }
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
