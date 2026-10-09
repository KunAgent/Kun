import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { McpConfigSheet } from './McpConfigSheet'
import { PluginDiscover, type DiscoverCardModel } from './PluginDiscover'
import { PluginsInstalledMcp } from './PluginsInstalledMcp'
import { PluginsRail } from './PluginsRail'
import { paginate } from './plugin-pagination'
import type { InstalledMcpRow } from './plugin-installed'

const t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}|${Object.values(values).join('|')}` : key

const FORM = {
  id: 'gitlab',
  transport: 'stdio' as const,
  remoteTransport: 'streamable-http',
  command: 'npx',
  args: ['-y', '@zereight/mcp-gitlab@2.1.30'],
  env: [
    { key: 'GITLAB_PERSONAL_ACCESS_TOKEN', value: 'glpat-1' },
    { key: 'GITLAB_PERMISSION_MODE', value: '' },
    { key: 'GITLAB_API_URL', value: '' }
  ],
  url: '',
  headers: [],
  timeoutSec: 30,
  enabled: true
}

function sheet(overrides: Partial<Parameters<typeof McpConfigSheet>[0]> = {}): string {
  return renderToStaticMarkup(createElement(McpConfigSheet, {
    t,
    mode: 'install',
    title: 'GitLab（新版）',
    initial: FORM,
    requiredKeys: ['GITLAB_PERSONAL_ACCESS_TOKEN', 'GITLAB_PERMISSION_MODE'],
    sourceBadge: { tone: 'market', label: '有道市场' },
    pinned: { packageName: '@zereight/mcp-gitlab', version: '2.1.30' },
    busy: false,
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides
  }))
}

describe('McpConfigSheet', () => {
  it('asks for every required key, masks secrets and counts what is left', () => {
    const html = sheet()
    expect(html).toContain('pluginsSheetAddTitle|GitLab（新版）')
    expect(html).toContain('GITLAB_PERSONAL_ACCESS_TOKEN')
    expect(html).toMatch(/id="mcp-env-GITLAB_PERSONAL_ACCESS_TOKEN" type="password"/)
    expect(html).toMatch(/id="mcp-env-GITLAB_PERMISSION_MODE" type="text"/)
    expect(html).toContain('pluginsRequiredLeft|1')
    expect(html).toContain('pluginsFieldMissing')
    expect(html).toContain('@zereight/mcp-gitlab@2.1.30')
    expect(html).toContain('有道市场')
  })

  it('offers save-later and blocks enabling while required keys are missing', () => {
    const html = sheet()
    expect(html).toContain('pluginsSaveLater')
    expect(html).toMatch(/disabled=""[^>]*>(<[^>]+>)*pluginsSaveEnable/)
  })

  it('enables directly once everything required is filled', () => {
    const html = sheet({ initial: { ...FORM, env: FORM.env.map((row) => ({ ...row, value: 'x' })) } })
    expect(html).not.toContain('pluginsSaveLater')
    expect(html).not.toContain('pluginsRequiredLeft')
  })

  it('edit mode shows the missing-key banner, the enable switch and delete', () => {
    const html = sheet({ mode: 'edit', onDelete: vi.fn(), statusPill: { tone: 'warn', label: 'pluginsStatusNeedsConfig' } })
    expect(html).toContain('pluginsNeedsKeysBanner|GITLAB_PERMISSION_MODE')
    expect(html).toContain('role="switch"')
    expect(html).toContain('pluginsDelete')
    expect(html).toContain('pluginsLaunchSection')
  })

  it('edits remote servers by URL and headers', () => {
    const html = sheet({
      mode: 'edit',
      requiredKeys: [],
      initial: { ...FORM, transport: 'remote', command: '', args: [], env: [], url: 'https://x.test/mcp', headers: [{ key: 'Authorization', value: 'Bearer t' }] },
      lastError: '401 Unauthorized'
    })
    expect(html).toContain('pluginsUrl')
    expect(html).toContain('https://x.test/mcp')
    expect(html).toContain('pluginsLastErrorBanner|401 Unauthorized')
    expect(html).toMatch(/value="Bearer t"[^>]*type="password"|type="password"[^>]*value="Bearer t"/)
  })
})

const ROW: InstalledMcpRow = {
  id: 'tavily', title: 'Tavily 搜索', description: '', source: 'market', sourceLabel: '有道市场',
  status: 'needs-config', group: 'attention', missingKeys: ['TAVILY_API_KEY'], enabled: false,
  hasConfig: true, systemManaged: false, launch: 'npx -y tavily-mcp@0.2.22'
}

describe('PluginsInstalledMcp', () => {
  const render = (rows: InstalledMcpRow[]): string => renderToStaticMarkup(createElement(PluginsInstalledMcp, {
    t,
    rows,
    summary: { services: rows.length, connected: 1, tools: 23, attention: 1, runtimeAvailable: true, loading: false },
    toggleBusyId: null,
    onRefreshStatus: vi.fn(),
    onToggle: vi.fn(),
    onConfigure: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onManageBuiltin: vi.fn(),
    onDiscover: vi.fn()
  }))

  it('groups rows with one status and puts the missing key on the row', () => {
    const html = render([
      ROW,
      { ...ROW, id: 'playwright', title: 'Playwright', source: 'kun', sourceLabel: undefined, status: 'connected', group: 'enabled', toolCount: 23, missingKeys: [], enabled: true },
      { ...ROW, id: 'gui_schedule', title: 'Kun 定时任务', source: 'builtin', sourceLabel: undefined, status: 'connected', group: 'enabled', missingKeys: [], enabled: true, hasConfig: false, systemManaged: true }
    ])
    expect(html).toContain('pluginsFilterAttention · 1')
    expect(html).toContain('pluginsFilterEnabled · 2')
    expect(html).toContain('pluginsMissingKeysLine|TAVILY_API_KEY')
    expect(html).toContain('pluginsStatusNeedsConfig')
    expect(html).toContain('pluginsStatusConnectedTools|23')
    expect(html).toContain('pluginsActionConfigure')
    expect(html).toContain('pluginsBuiltinLocked')
    expect(html).toContain('pluginsSummaryTools')
  })

  it('shows an empty state that links to discover', () => {
    const html = render([])
    expect(html).toContain('pluginsInstalledEmpty')
    expect(html).toContain('pluginsGoDiscover')
  })
})

function card(index: number): DiscoverCardModel {
  return {
    key: `youdao:skill:s${index}`,
    item: { id: `s${index}`, kind: 'skill', title: `Skill ${index}`, group: 'recommended' },
    title: `Skill ${index}`,
    description: 'desc',
    sourceBadge: { tone: 'market', label: '有道市场' },
    meta: 'bytedance · Github · v1.0.0',
    keyCount: 0,
    footer: '效率工具',
    action: { label: 'pluginsActionInstall', tone: 'soft' }
  }
}

describe('PluginDiscover', () => {
  const render = (cards: DiscoverCardModel[], page: number, overrides: Partial<Parameters<typeof PluginDiscover>[0]> = {}): string =>
    renderToStaticMarkup(createElement(PluginDiscover, {
      t,
      toolbar: null,
      scopeLabel: '有道市场',
      page: paginate(cards, page, 12),
      pageSize: 12,
      compact: false,
      loading: false,
      empty: null,
      busyKey: null,
      onPage: vi.fn(),
      onOpen: vi.fn(),
      onAction: vi.fn(),
      onClearFilters: vi.fn(),
      onOnlyKun: vi.fn(),
      onRetry: vi.fn(),
      ...overrides
    }))

  it('shows one page of cards with a pager', () => {
    const cards = Array.from({ length: 76 }, (_, index) => card(index))
    const html = render(cards, 2)
    expect(html).toContain('Skill 12')
    expect(html).not.toContain('Skill 11<')
    expect(html).not.toContain('Skill 24<')
    expect(html).toContain('pluginsRange|13|24|76')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('pluginsScope|有道市场|76')
  })

  it('explains empty searches and unreachable markets', () => {
    expect(render([], 1, { empty: { kind: 'query', query: '飞书', scope: '有道市场' } })).toContain('pluginsEmptySearchTitle|飞书')
    const offline = render([], 1, { empty: { kind: 'unavailable', source: '有道市场', message: 'timeout' } })
    expect(offline).toContain('pluginsMarketUnavailableTitle|有道市场')
    expect(offline).toContain('pluginsOnlyKun')
  })
})

describe('PluginsRail', () => {
  const props = {
    t,
    view: 'discover' as const,
    installedCount: 3,
    installedBadge: { tone: 'warn' as const, label: 'pluginsNeedsConfigCount|1' },
    onInstalled: vi.fn(),
    sources: [{ id: 'all', label: 'pluginsSourceAll', count: 16 }, { id: 'youdao', label: '有道市场', count: 10 }],
    source: 'youdao',
    onSource: vi.fn(),
    categories: [{ id: 'search', label: '搜索', count: 1 }],
    categoryTotal: 10,
    category: 'all',
    onCategory: vi.fn(),
    location: 'all',
    onLocation: vi.fn(),
    sync: { text: 'pluginsSyncOffline|有道市场|10/10 00:10', tone: 'warn' as const, syncing: false },
    onRefresh: vi.fn()
  }

  it('lists installed, sources, categories and the sync state', () => {
    const html = renderToStaticMarkup(createElement(PluginsRail, { ...props, compact: false }))
    expect(html).toContain('pluginsNeedsConfigCount|1')
    expect(html).toContain('有道市场')
    expect(html).toContain('pluginsCategoryAll')
    expect(html).toContain('pluginsSyncOffline')
  })

  it('folds into a filter row on narrow windows', () => {
    const html = renderToStaticMarkup(createElement(PluginsRail, { ...props, compact: true }))
    expect(html).toContain('<select')
    expect(html).toContain('搜索 1')
    expect(html).not.toContain('<aside')
  })
})
