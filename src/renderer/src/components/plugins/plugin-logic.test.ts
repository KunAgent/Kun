import { describe, expect, it } from 'vitest'
import type { SkillListItem } from '@shared/kun-gui-api'
import { RECOMMENDED_ITEMS } from '../plugin-marketplace-catalog'
import type { MarketplaceItem } from '../plugin-marketplace-config'
import { buildDiscoverCard, buildPluginDetail, filterDiscoverItems, launchOf, permissionsOf, requiredKeysOf } from './plugin-discover'
import { buildInstalledMcpRows, buildInstalledSkillRows, compareVersions, parentDirectory } from './plugin-installed'
import { paginate, pageWindow } from './plugin-pagination'
import { categoryLabels, categoryOptions, matchesQuery } from './plugin-taxonomy'

const t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key

const TAVILY: MarketplaceItem = {
  id: 'tavily',
  kind: 'mcp',
  title: 'Tavily 搜索',
  description: '实时网页搜索',
  group: 'recommended',
  categories: ['search'],
  supplyChain: { source: 'mcp', permissions: ['command', 'network', 'secret'] },
  market: { sourceId: 'youdao', sourceLabel: '有道市场', requiredEnvKeys: ['TAVILY_API_KEY'], optionalEnvKeys: [], launch: 'npx -y tavily-mcp@latest' }
}
const BRAVE = RECOMMENDED_ITEMS.find((item) => item.id === 'brave-search')!
const PLAYWRIGHT = RECOMMENDED_ITEMS.find((item) => item.id === 'playwright')!

describe('pagination', () => {
  it('slices pages and clamps out-of-range pages', () => {
    const items = Array.from({ length: 76 }, (_, index) => index)
    expect(paginate(items, 1, 12)).toMatchObject({ page: 1, pageCount: 7, start: 0, end: 12, total: 76 })
    expect(paginate(items, 7, 12).items).toEqual([72, 73, 74, 75])
    expect(paginate(items, 99, 12).page).toBe(7)
    expect(paginate([], 3, 12)).toMatchObject({ page: 1, pageCount: 1, total: 0, items: [] })
  })

  it('keeps the page window to at most seven slots', () => {
    expect(pageWindow(1, 2)).toEqual([1, 2])
    expect(pageWindow(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 'gap', 20])
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20])
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 17, 18, 19, 20])
  })
})

describe('taxonomy', () => {
  it('labels categories from market taxa with built-in fallbacks and counts them', () => {
    const labels = categoryLabels([{ id: 'search', name: { zh: '搜索（有道）', en: 'Search' } }, { id: 'design', name: { zh: '设计' } }], 'zh', t)
    expect(labels.get('search')).toBe('搜索（有道）')
    expect(labels.get('browser')).toBe('pluginsCatBrowser')
    const options = categoryOptions([TAVILY, { ...TAVILY, id: 'b' }, PLAYWRIGHT, { ...TAVILY, id: 'c', categories: ['mystery'] }], labels)
    expect(options).toEqual([
      { id: 'search', label: '搜索（有道）', count: 2 },
      // Ties sort by label.
      { id: 'mystery', label: 'mystery', count: 1 },
      { id: 'browser', label: 'pluginsCatBrowser', count: 1 }
    ])
  })

  it('matches queries case-insensitively over visible text', () => {
    expect(matchesQuery(['Tavily 搜索', undefined], 'tav')).toBe(true)
    expect(matchesQuery(['Tavily'], '  ')).toBe(true)
    expect(matchesQuery(['Tavily'], 'notion')).toBe(false)
  })
})

describe('discover cards', () => {
  it('reads required keys and launch from the market or from Kun placeholders', () => {
    expect(requiredKeysOf(TAVILY)).toEqual(['TAVILY_API_KEY'])
    expect(requiredKeysOf(BRAVE)).toEqual(['BRAVE_API_KEY'])
    expect(requiredKeysOf(PLAYWRIGHT)).toEqual([])
    expect(launchOf(PLAYWRIGHT)).toBe('npx -y @playwright/mcp@0.0.77')
    expect(permissionsOf(BRAVE)).toContain('secret')
  })

  it('filters by source, category and query', () => {
    const items = [TAVILY, BRAVE, PLAYWRIGHT]
    expect(filterDiscoverItems(items, { source: 'youdao', category: 'all', query: '', t }).map((item) => item.id)).toEqual(['tavily'])
    expect(filterDiscoverItems(items, { source: 'builtin', category: 'search', query: '', t }).map((item) => item.id)).toEqual(['brave-search'])
    expect(filterDiscoverItems(items, { source: 'all', category: 'all', query: 'playwright', t }).map((item) => item.id)).toEqual(['playwright'])
  })

  it('turns install state into the card action', () => {
    const labels = new Map([['search', '搜索']])
    expect(buildDiscoverCard(TAVILY, { t, state: 'new', categoryLabels: labels })).toMatchObject({
      key: 'youdao:mcp:tavily', meta: '搜索', keyCount: 1, sourceBadge: { tone: 'market', label: '有道市场' },
      action: { label: 'pluginsActionAdd', tone: 'soft' }
    })
    expect(buildDiscoverCard(TAVILY, { t, state: 'needs-config', categoryLabels: labels }).action).toEqual({ label: 'pluginsActionConfigure', tone: 'warn' })
    const skill: MarketplaceItem = { id: 's', kind: 'skill', title: 'S', group: 'recommended', market: { sourceId: 'youdao', sourceLabel: '有道市场', version: '1.0.9', originLabel: 'netease · Github' } }
    expect(buildDiscoverCard(skill, { t, state: 'new', categoryLabels: labels }).action.label).toBe('pluginsActionInstall')
    expect(buildDiscoverCard(skill, { t, state: 'update', categoryLabels: labels })).toMatchObject({ meta: 'netease · Github · v1.0.9', action: { tone: 'up' } })
  })

  it('builds the detail drawer model', () => {
    const detail = buildPluginDetail(TAVILY, { t, state: 'new', categoryLabels: new Map() })
    expect(detail).toMatchObject({
      requiredKeys: ['TAVILY_API_KEY'], launch: 'npx -y tavily-mcp@latest', remote: false,
      marketLabel: '有道市场', primaryLabel: 'pluginsPrimaryAddConfigure', statusLabel: 'pluginsStateNotAdded'
    })
    expect(buildPluginDetail(PLAYWRIGHT, { t, state: 'added', categoryLabels: new Map() }).primaryLabel).toBe('pluginsPrimaryManage')
  })
})

describe('installed rows', () => {
  const config = JSON.stringify({
    servers: {
      tavily: { enabled: false, command: 'npx', args: ['-y', 'tavily-mcp@0.2.22'], env: { TAVILY_API_KEY: '' } },
      playwright: { enabled: true, command: 'npx', args: ['-y', '@playwright/mcp@0.0.77'], env: {} },
      context7: { enabled: false, command: 'npx', args: ['-y', '@upstash/context7-mcp@3.2.2'] },
      custom: { enabled: true, transport: 'streamable-http', url: 'https://x.test/mcp' }
    }
  })
  const rows = buildInstalledMcpRows({
    configText: config,
    diagnostics: { mcpServers: [
      { id: 'playwright', status: 'connected', toolCount: 23 },
      { id: 'custom', status: 'error', lastError: '401 Unauthorized' },
      { id: 'gui_schedule', status: 'connected', toolCount: 4 }
    ] } as never,
    builtins: RECOMMENDED_ITEMS.filter((item) => item.id === 'gui_schedule'),
    kunPicks: RECOMMENDED_ITEMS.filter((item) => !item.systemManaged && item.kind === 'mcp'),
    market: (id) => (id === 'tavily' ? { sourceId: 'youdao', label: '有道市场', requiredEnvKeys: ['TAVILY_API_KEY'], title: 'Tavily 搜索' } : undefined),
    translate: (item) => ({ title: item.titleKey ?? item.id, description: item.descriptionKey ?? '' })
  })

  it('puts problems first and gives every row one status', () => {
    // Within a group: user servers before built-ins, then by title.
    expect(rows.map((row) => [row.id, row.group, row.status])).toEqual([
      ['custom', 'attention', 'error'],
      ['tavily', 'attention', 'needs-config'],
      ['playwright', 'enabled', 'connected'],
      ['gui_schedule', 'enabled', 'connected'],
      ['context7', 'disabled', 'disabled']
    ])
  })

  it('labels sources and carries missing keys, tools and errors', () => {
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(byId.get('tavily')).toMatchObject({ source: 'market', sourceLabel: '有道市场', title: 'Tavily 搜索', missingKeys: ['TAVILY_API_KEY'], hasConfig: true })
    expect(byId.get('playwright')).toMatchObject({ source: 'kun', toolCount: 23, launch: 'npx -y @playwright/mcp@0.0.77' })
    expect(byId.get('custom')).toMatchObject({ source: 'custom', lastError: '401 Unauthorized', launch: 'https://x.test/mcp' })
    expect(byId.get('gui_schedule')).toMatchObject({ source: 'builtin', systemManaged: true, hasConfig: false })
  })

  it('flags market skills with a newer catalog version', () => {
    const skills: SkillListItem[] = [
      { id: 'note', name: 'Note', root: '/u/.kun/skills/note', entryPath: '/u/.kun/skills/note/SKILL.md', scope: 'global', legacy: true, market: { sourceId: 'youdao', version: '1.0.8' } },
      { id: 'mine', name: 'Mine', root: '/u/.claude/skills/mine', entryPath: '', scope: 'global', legacy: true }
    ]
    const result = buildInstalledSkillRows({
      skills,
      disabledIds: ['mine'],
      marketLabel: (id) => (id === 'youdao' ? '有道市场' : undefined),
      latestVersion: () => '1.0.10'
    })
    expect(result[0]).toMatchObject({ rootPath: '/u/.kun/skills', canUpdate: true, latestVersion: '1.0.10', market: { label: '有道市场', version: '1.0.8' }, enabled: true })
    expect(result[1]).toMatchObject({ canUpdate: false, enabled: false })
    expect(result[1]?.market).toBeUndefined()
  })

  it('compares versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1)
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.2', '1.2.1')).toBe(-1)
    expect(parentDirectory('C:\\Users\\me\\skills\\x\\')).toBe('C:\\Users\\me\\skills')
  })
})
