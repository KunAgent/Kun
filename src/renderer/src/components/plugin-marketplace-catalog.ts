import type { SkillListItem, SkillRootListItem } from '@shared/kun-gui-api'
import {
  BUILTIN_GITHUB_MCP_MANAGED_BY,
  BUILTIN_GITHUB_MCP_SERVER_ID
} from '@shared/github-mcp'
import type { CoreRuntimeToolDiagnosticsJson } from '../agent/kun-contract'
import {
  GUI_SCHEDULE_MCP_SERVER_ID,
  buildMcpConfig,
  buildRemoteMcpConfig,
  isJsonRecord,
  mcpConfigHasServer,
  mcpServerDescription,
  mcpServerStatus,
  mcpServersFromConfig,
  mcpStatusTone,
  parseMcpJsonConfig,
  type JsonRecord,
  type MarketplaceItem,
  type SkillRootOption
} from './plugin-marketplace-config'

export function itemTitle(item: MarketplaceItem, t: (key: string) => string): string {
  return item.title ?? (item.titleKey ? t(item.titleKey) : item.id)
}

export function itemDescription(item: MarketplaceItem, t: (key: string) => string): string {
  return item.description ?? (item.descriptionKey ? t(item.descriptionKey) : '')
}

export function skillMarketplaceItemsFromDiscoveredSkills(
  skills: SkillListItem[],
  labels: { project: string; global: string }
): MarketplaceItem[] {
  return skills.map((skill) => ({
    id: skill.id,
    kind: 'skill' as const,
    title: skill.name,
    description: skill.description ?? skill.root,
    group: 'personal' as const,
    sourceLabel: skill.scope === 'project' ? labels.project : labels.global
  }))
}

/** Last two path segments, e.g. `/Users/me/.claude/skills` → `.claude/skills`. */
export function skillRootShortLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join('/') || path
}

/**
 * Builds the skill-root picker options from the backend's detected roots
 * (`skill:list-roots`) — the same source the settings page renders — so the
 * marketplace stays in sync instead of hardcoding a fixed subset of dirs.
 * Common dirs use their i18n label; user-added extra dirs fall back to a short
 * path label. (#321)
 */
export function skillRootOptionsFromRoots(
  roots: SkillRootListItem[],
  t: (key: string) => string
): SkillRootOption[] {
  return roots.map((root) => ({
    id: root.id,
    label: root.labelKey ? t(root.labelKey) : skillRootShortLabel(root.path),
    path: root.path,
    scope: root.scope,
    enabled: root.enabled,
    exists: root.exists,
    skillCount: root.skillCount
  }))
}

export function mcpMarketplaceItemsFromConfigAndDiagnostics(
  configText: string,
  diagnostics: CoreRuntimeToolDiagnosticsJson | null,
  labels: {
    configured: string
    connected: string
    error: string
    disabled: string
  }
): MarketplaceItem[] {
  const servers = new Map<string, {
    id: string
    config?: JsonRecord
    diagnostic?: JsonRecord
  }>()
  try {
    const configServers = mcpServersFromConfig(parseMcpJsonConfig(configText))
    for (const [id, value] of Object.entries(configServers)) {
      if (!id.trim()) continue
      servers.set(id, {
        id,
        config: isJsonRecord(value) ? value : {}
      })
    }
  } catch {
    /* Invalid config is surfaced elsewhere; keep the marketplace render resilient. */
  }
  for (const diagnostic of diagnostics?.mcpServers ?? []) {
    const id = typeof diagnostic.id === 'string' ? diagnostic.id.trim() : ''
    if (!id) continue
    const existing = servers.get(id)
    servers.set(id, {
      id,
      config: existing?.config,
      diagnostic
    })
  }
  return [...servers.values()].map(({ id, config, diagnostic }) => {
    const status = mcpServerStatus(diagnostic, config)
    const details = { ...(config ?? {}), ...(diagnostic ?? {}) }
    const sourceLabel =
      status === 'connected' || status === 'available' ? labels.connected :
      status === 'error' || status === 'unavailable' || status === 'authorization_required' ? labels.error :
      status === 'disabled' ? labels.disabled :
      labels.configured
    const detail = mcpServerDescription(details, labels.configured)
    const catalogItem = RECOMMENDED_ITEMS.find((entry) => entry.kind === 'mcp' && entry.id === id)
    return {
      id,
      kind: 'mcp' as const,
      title: id,
      // Keep the catalog description for known servers so installing an item
      // does not replace its human-readable intro with the raw status string (#211).
      ...(catalogItem?.descriptionKey
        ? { descriptionKey: catalogItem.descriptionKey }
        : catalogItem?.description
          ? { description: catalogItem.description }
          : { description: detail }),
      detail,
      group: 'personal' as const,
      sourceLabel,
      statusTone: mcpStatusTone(status)
    }
  }).sort((left, right) => left.title.localeCompare(right.title))
}

export function hasUserConfiguredGitHubMcp(configText: string): boolean {
  return mcpConfigHasServer(configText, BUILTIN_GITHUB_MCP_SERVER_ID)
}

export function isSystemManagedMcpServerId(
  id: string,
  configText: string,
  diagnostics?: CoreRuntimeToolDiagnosticsJson | null
): boolean {
  if (id === GUI_SCHEDULE_MCP_SERVER_ID) return true
  if (id !== BUILTIN_GITHUB_MCP_SERVER_ID || hasUserConfiguredGitHubMcp(configText)) return false
  const runtimeGitHub = diagnostics?.mcpServers?.find((server) => server.id === id)
  return runtimeGitHub
    ? runtimeGitHub.managedBy === BUILTIN_GITHUB_MCP_MANAGED_BY
    : true
}

/** Hide the built-in card when the user deliberately supplies `github`. */
export function recommendedMarketplaceItemsForMcpConfig(
  configText: string,
  diagnostics?: CoreRuntimeToolDiagnosticsJson | null
): MarketplaceItem[] {
  if (isSystemManagedMcpServerId(BUILTIN_GITHUB_MCP_SERVER_ID, configText, diagnostics)) {
    return RECOMMENDED_ITEMS
  }
  return RECOMMENDED_ITEMS.filter((item) =>
    item.kind !== 'mcp' || item.id !== BUILTIN_GITHUB_MCP_SERVER_ID
  )
}

/** Put managed-server connection and credential errors on their built-in cards. */
export function overlaySystemManagedMcpDiagnostics(
  items: readonly MarketplaceItem[],
  diagnostics: CoreRuntimeToolDiagnosticsJson | null,
  labels: Parameters<typeof mcpMarketplaceItemsFromConfigAndDiagnostics>[2]
): MarketplaceItem[] {
  const runtimeItems = mcpMarketplaceItemsFromConfigAndDiagnostics('', diagnostics, labels)
  const runtimeById = new Map(runtimeItems.map((item) => [item.id, item]))
  return items.map((item) => {
    if (item.kind !== 'mcp' || !item.systemManaged) return item
    const runtime = runtimeById.get(item.id)
    if (!runtime) return item
    return {
      ...item,
      sourceLabel: runtime.sourceLabel,
      detail: runtime.detail,
      statusTone: runtime.statusTone
    }
  })
}

export function skillNameLooksValid(raw: string): boolean {
  const value = raw.trim()
  return !!value && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

export const RECOMMENDED_ITEMS: MarketplaceItem[] = [
  {
    id: GUI_SCHEDULE_MCP_SERVER_ID,
    kind: 'mcp',
    titleKey: 'pluginMcpGuiScheduleTitle',
    descriptionKey: 'pluginMcpGuiScheduleDesc',
    group: 'recommended',
    systemManaged: true
  },
  {
    id: 'playwright',
    kind: 'mcp',
    titleKey: 'pluginMcpPlaywrightTitle',
    descriptionKey: 'pluginMcpPlaywrightDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'playwright',
        'npx',
        ['-y', '@playwright/mcp@0.0.77']
      ),
    supplyChain: { source: 'mcp', packageName: '@playwright/mcp', version: '0.0.77', permissions: ['command', 'network', 'file'] }
  },
  {
    id: BUILTIN_GITHUB_MCP_SERVER_ID,
    kind: 'mcp',
    titleKey: 'pluginMcpGithubTitle',
    descriptionKey: 'pluginMcpGithubDesc',
    group: 'recommended',
    systemManaged: true,
    serverIds: [BUILTIN_GITHUB_MCP_SERVER_ID],
    supplyChain: { source: 'remote-mcp', permissions: ['network', 'secret'] }
  },
  {
    id: 'vercel',
    kind: 'mcp',
    titleKey: 'pluginMcpVercelTitle',
    descriptionKey: 'pluginMcpVercelDesc',
    group: 'recommended',
    sourceLabel: 'OAuth',
    statusTone: 'warning',
    serverIds: ['vercel'],
    oauth: {
      docsUrl: 'https://vercel.com/docs/agent-resources/vercel-mcp.md',
      permissionKeys: [
        'pluginOAuthVercelPermissionAccount',
        'pluginOAuthVercelPermissionProjects',
        'pluginOAuthVercelPermissionDeployments',
        'pluginOAuthVercelPermissionLogs'
      ],
      setupKeys: [
        'pluginOAuthSetupInstall',
        'pluginOAuthVercelSetupProject',
        'pluginOAuthSetupAuthorize',
        'pluginOAuthSetupRestart'
      ],
      noteKey: 'pluginOAuthVercelNote'
    },
    supplyChain: { source: 'remote-mcp', permissions: ['network', 'secret'] },
    mcpConfig: () =>
      buildRemoteMcpConfig({
        vercel: 'https://mcp.vercel.com'
      })
  },
  {
    id: 'context7',
    kind: 'mcp',
    titleKey: 'pluginMcpContext7Title',
    descriptionKey: 'pluginMcpContext7Desc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'context7',
        'npx',
        ['-y', '@upstash/context7-mcp@3.2.2']
      ),
    supplyChain: { source: 'mcp', packageName: '@upstash/context7-mcp', version: '3.2.2', permissions: ['command', 'network'] }
  },
  {
    id: 'sequential-thinking',
    kind: 'mcp',
    titleKey: 'pluginMcpSequentialThinkingTitle',
    descriptionKey: 'pluginMcpSequentialThinkingDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'sequential-thinking',
        'npx',
        ['-y', '@modelcontextprotocol/server-sequential-thinking@2025.12.18']
      ),
    supplyChain: { source: 'mcp', packageName: '@modelcontextprotocol/server-sequential-thinking', version: '2025.12.18', permissions: ['command'] }
  },
  {
    id: 'memory',
    kind: 'mcp',
    titleKey: 'pluginMcpMemoryTitle',
    descriptionKey: 'pluginMcpMemoryDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'memory',
        'npx',
        ['-y', '@modelcontextprotocol/server-memory@2026.1.26']
      ),
    supplyChain: { source: 'mcp', packageName: '@modelcontextprotocol/server-memory', version: '2026.1.26', permissions: ['command', 'file'] }
  },
  {
    id: 'brave-search',
    kind: 'mcp',
    titleKey: 'pluginMcpBraveSearchTitle',
    descriptionKey: 'pluginMcpBraveSearchDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'brave-search',
        'npx',
        ['-y', '@modelcontextprotocol/server-brave-search@0.6.2'],
        { env: { BRAVE_API_KEY: '' } }
      ),
    supplyChain: { source: 'mcp', packageName: '@modelcontextprotocol/server-brave-search', version: '0.6.2', permissions: ['command', 'network', 'secret'] }
  },
  {
    id: 'code-review',
    kind: 'skill',
    titleKey: 'pluginSkillReviewTitle',
    descriptionKey: 'pluginSkillReviewDesc',
    group: 'recommended',
    supplyChain: { source: 'skill', permissions: ['file'] },
    skillInstructions:
      'Use this skill when reviewing a code change. Prioritize correctness, regressions, security, performance, and missing tests. Lead with concrete findings and file references.'
  },
  {
    id: 'frontend-polish',
    kind: 'skill',
    titleKey: 'pluginSkillFrontendTitle',
    descriptionKey: 'pluginSkillFrontendDesc',
    group: 'recommended',
    supplyChain: { source: 'skill', permissions: ['file'] },
    skillInstructions:
      'Use this skill when improving UI. Preserve the product style, check responsive states, avoid generic layouts, and verify the result visually before handing it back.'
  },
  {
    id: 'bug-hunt',
    kind: 'skill',
    titleKey: 'pluginSkillBugTitle',
    descriptionKey: 'pluginSkillBugDesc',
    group: 'recommended',
    supplyChain: { source: 'skill', permissions: ['file', 'command'] },
    skillInstructions:
      'Use this skill when investigating bugs. Reproduce or narrow the symptom, trace the data flow, identify the smallest fix, and add focused verification where possible.'
  },
  {
    id: 'release-notes',
    kind: 'skill',
    titleKey: 'pluginSkillReleaseTitle',
    descriptionKey: 'pluginSkillReleaseDesc',
    group: 'recommended',
    supplyChain: { source: 'skill', permissions: ['file'] },
    skillInstructions:
      'Use this skill when preparing release notes. Group user-facing changes by outcome, call out migrations or risks, and keep wording concise and scannable.'
  }
]

export function recommendedMarketplaceItemIds(): string[] {
  return RECOMMENDED_ITEMS.map((item) => item.id)
}
