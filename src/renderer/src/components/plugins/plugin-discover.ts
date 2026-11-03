import { itemDescription, itemTitle } from '../plugin-marketplace-catalog'
import { isJsonRecord, mcpServersFromConfig, type MarketplaceItem, type SupplyChainPermission } from '../plugin-marketplace-config'
import { matchesMarketSource } from '../plugin-marketplace-market'
import type { CardActionTone, DiscoverCardModel } from './PluginDiscover'
import type { PluginDetail } from './PluginDetailDrawer'
import { matchesCategory, matchesQuery } from './plugin-taxonomy'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type DiscoverState = 'new' | 'added' | 'needs-config' | 'installed' | 'update'

function configServer(item: MarketplaceItem): Record<string, unknown> | undefined {
  try {
    const server = item.mcpConfig ? mcpServersFromConfig(item.mcpConfig(''))[item.id] : undefined
    return isJsonRecord(server) ? server : undefined
  } catch {
    return undefined
  }
}

/** Env keys a card's server needs: the market's list, or Kun's empty placeholders. */
export function requiredKeysOf(item: MarketplaceItem): string[] {
  if (item.market?.requiredEnvKeys) return item.market.requiredEnvKeys
  const env = configServer(item)?.env
  return isJsonRecord(env) ? Object.entries(env).filter(([, value]) => value === '').map(([key]) => key) : []
}

export function launchOf(item: MarketplaceItem): string {
  if (item.market?.launch) return item.market.launch
  const server = configServer(item)
  if (!server) return ''
  if (typeof server.url === 'string') return server.url
  const args = Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === 'string') : []
  return [typeof server.command === 'string' ? server.command : '', ...args].filter(Boolean).join(' ')
}

function isRemote(item: MarketplaceItem): boolean {
  return item.supplyChain?.source === 'remote-mcp' || /^https:\/\//.test(launchOf(item))
}

export function permissionsOf(item: MarketplaceItem): SupplyChainPermission[] {
  const permissions = new Set<SupplyChainPermission>(item.supplyChain?.permissions ?? [])
  if (item.kind === 'mcp' && requiredKeysOf(item).length > 0) permissions.add('secret')
  const order: SupplyChainPermission[] = ['command', 'network', 'secret', 'file']
  return order.filter((permission) => permissions.has(permission))
}

function permissionLine(t: Translate, item: MarketplaceItem): string {
  const labels: string[] = []
  const permissions = permissionsOf(item)
  if (isRemote(item)) labels.push(t('pluginsPermRemote'))
  else if (permissions.includes('command')) labels.push(t('pluginsPermCommand'))
  if (permissions.includes('network')) labels.push(t('pluginsPermNetwork'))
  if (item.kind === 'skill' && permissions.includes('file')) labels.push(t('pluginsPermFile'))
  return labels.join(' · ')
}

const ACTION: Record<DiscoverState, { key: string; tone: CardActionTone }> = {
  new: { key: 'pluginsActionAdd', tone: 'soft' },
  added: { key: 'pluginsActionAdded', tone: 'done' },
  'needs-config': { key: 'pluginsActionConfigure', tone: 'warn' },
  installed: { key: 'pluginsActionInstalled', tone: 'done' },
  update: { key: 'pluginsActionUpdate', tone: 'up' }
}

export function filterDiscoverItems(items: readonly MarketplaceItem[], input: {
  source: string
  category: string
  query: string
  t: Translate
}): MarketplaceItem[] {
  return items.filter((item) =>
    matchesMarketSource(item, input.source) &&
    matchesCategory(item, input.category) &&
    matchesQuery([item.id, itemTitle(item, input.t), itemDescription(item, input.t), item.market?.originLabel, launchOf(item)], input.query)
  )
}

export function buildDiscoverCard(item: MarketplaceItem, input: {
  t: Translate
  state: DiscoverState
  categoryLabels: ReadonlyMap<string, string>
}): DiscoverCardModel {
  const { t } = input
  const category = item.categories?.[0] ? input.categoryLabels.get(item.categories[0]) ?? item.categories[0] : ''
  const meta = item.kind === 'skill'
    ? [item.market?.originLabel, item.market?.version ? `v${item.market.version}` : ''].filter(Boolean).join(' · ') || category
    : category
  const tags = (item.categories ?? []).slice(0, 2).map((id) => input.categoryLabels.get(id) ?? id)
  const action = ACTION[item.kind === 'skill' && input.state === 'new' ? 'new' : input.state]
  return {
    key: `${item.market?.sourceId ?? 'kun'}:${item.kind}:${item.id}`,
    item,
    title: itemTitle(item, t),
    description: itemDescription(item, t),
    sourceBadge: item.market ? { tone: 'market', label: item.market.sourceLabel } : { tone: 'kun', label: t('pluginsSourceKun') },
    meta,
    keyCount: item.kind === 'mcp' ? requiredKeysOf(item).length : 0,
    footer: item.kind === 'skill' ? [tags.join(' · '), permissionLine(t, item)].filter(Boolean).join(' · ') : permissionLine(t, item),
    action: {
      label: item.kind === 'skill' && input.state === 'new' ? t('pluginsActionInstall') : t(action.key),
      tone: action.tone
    }
  }
}

export function buildPluginDetail(item: MarketplaceItem, input: {
  t: Translate
  state: DiscoverState
  categoryLabels: ReadonlyMap<string, string>
}): PluginDetail {
  const { t, state } = input
  const required = item.kind === 'mcp' ? requiredKeysOf(item) : []
  const optional = item.kind === 'mcp' ? (item.market?.optionalEnvKeys ?? []).filter((key) => !required.includes(key)) : []
  const statusKey = state === 'new' ? 'pluginsStateNotAdded'
    : state === 'needs-config' ? 'pluginsStatusNeedsConfig'
      : state === 'update' ? 'pluginsFilterUpdates'
        : item.kind === 'skill' ? 'pluginsActionInstalled' : 'pluginsActionAdded'
  const primaryKey = item.kind === 'skill'
    ? state === 'update' ? 'pluginsActionUpdate' : state === 'installed' ? 'pluginsActionInstalled' : 'pluginsActionInstall'
    : state === 'new' ? (required.length > 0 ? 'pluginsPrimaryAddConfigure' : 'pluginsActionAdd')
      : state === 'needs-config' ? 'pluginsActionConfigure' : 'pluginsPrimaryManage'
  const launch = launchOf(item)
  return {
    id: item.id,
    kind: item.kind,
    title: itemTitle(item, t),
    description: itemDescription(item, t),
    sourceBadge: item.market ? { tone: 'market', label: item.market.sourceLabel } : { tone: 'kun', label: t('pluginsSourceKun') },
    ...(item.market ? { marketLabel: item.market.sourceLabel } : {}),
    ...(item.categories?.length ? { categoryLabel: item.categories.map((id) => input.categoryLabels.get(id) ?? id).join(' · ') } : {}),
    requiredKeys: required,
    optionalKeys: optional,
    ...(launch ? { launch } : {}),
    remote: isRemote(item),
    permissions: permissionsOf(item),
    ...(item.market?.version ? { version: item.market.version } : {}),
    ...(item.market?.originLabel ? { originLabel: item.market.originLabel } : {}),
    ...(item.market?.originUrl ? { originUrl: item.market.originUrl } : {}),
    statusLabel: t(statusKey),
    primaryLabel: t(primaryKey),
    primaryDisabled: item.kind === 'skill' && state === 'installed'
  }
}
