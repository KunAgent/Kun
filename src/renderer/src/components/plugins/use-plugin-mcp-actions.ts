import { useCallback, useRef, useState } from 'react'
import { BUILTIN_GITHUB_MCP_SERVER_ID } from '@shared/github-mcp'
import { itemTitle } from '../plugin-marketplace-catalog'
import {
  auditMarketplaceInstall,
  auditMcpConfigSupplyChain,
  isJsonRecord,
  mcpServersFromConfig,
  mergeMcpJsonConfig,
  setMcpServerEnabled,
  type MarketplaceItem
} from '../plugin-marketplace-config'
import type { MarketCatalogsState } from '../use-market-catalogs'
import type { BadgeTone, PillTone } from './PluginPrimitives'
import type { PluginToastState } from './PluginDialogs'
import { mcpSourceBadge, mcpStatusView } from './PluginsInstalledMcp'
import {
  applyMcpServerForm,
  formFromPlan,
  missingEnvKeys,
  readMcpServer,
  removeMcpServer,
  requiredEnvKeys,
  serverToForm,
  type McpServerForm
} from './mcp-server-form'
import { requiredKeysOf } from './plugin-discover'
import type { InstalledMcpRow } from './plugin-installed'
import type { PluginMcpState } from './use-plugin-mcp'
import { KUN_PICKS } from './use-plugin-discover'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type McpSheetState = {
  mode: 'install' | 'edit'
  title: string
  form: McpServerForm
  original?: McpServerForm
  requiredKeys: string[]
  sourceBadge?: { tone: BadgeTone; label: string }
  statusPill?: { tone: PillTone; label: string }
  pinned?: { packageName: string; version: string }
  lastError?: string
  /** Set for market installs so the server keeps its market badge. */
  marketSourceId?: string
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** The exact `pkg@1.2.3` an npx server launches, when it has one. */
export function pinnedSpec(form: Pick<McpServerForm, 'transport' | 'command' | 'args'>): { packageName: string; version: string } | undefined {
  if (form.transport !== 'stdio' || !/(^|[\\/])npx(\.cmd|\.exe)?$/i.test(form.command.trim())) return undefined
  const spec = form.args.find((arg) => arg && !arg.startsWith('-'))
  const at = spec ? spec.lastIndexOf('@') : -1
  if (!spec || at <= 0) return undefined
  const version = spec.slice(at + 1)
  return EXACT_VERSION.test(version) ? { packageName: spec.slice(0, at), version } : undefined
}

function launchChanged(a: McpServerForm | undefined, b: McpServerForm): boolean {
  if (!a) return true
  return a.command !== b.command || a.args.join('\n') !== b.args.join('\n') || a.url !== b.url
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function usePluginMcpActions(input: {
  t: Translate
  workspaceRoot: string
  mcp: PluginMcpState
  market: MarketCatalogsState
  rows: readonly InstalledMcpRow[]
  notify: (toast: PluginToastState | null) => void
  inspectGithub: () => Promise<void>
}) {
  const { t, workspaceRoot, mcp, market, rows, notify, inspectGithub } = input
  const [sheet, setSheet] = useState<McpSheetState | null>(null)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [sheetError, setSheetError] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null)
  const [confirmRow, setConfirmRow] = useState<InstalledMcpRow | null>(null)
  const [oauthItem, setOauthItem] = useState<MarketplaceItem | null>(null)

  const openSheet = useCallback((next: McpSheetState) => {
    setSheetError('')
    setSheet(next)
  }, [])

  const openEdit = useCallback((id: string): void => {
    const server = readMcpServer(mcp.configText, id)
    if (!server) {
      notify({ tone: 'error', message: t('pluginsNotInConfig', { name: id }) })
      return
    }
    const row = rows.find((entry) => entry.id === id)
    const pick = KUN_PICKS.find((item) => item.kind === 'mcp' && item.id === id)
    const declared = market.mcpOriginInfo(id)?.requiredEnvKeys ?? (pick ? requiredKeysOf(pick) : [])
    const form = serverToForm(id, server)
    openSheet({
      mode: 'edit',
      title: row?.title ?? id,
      form,
      original: form,
      requiredKeys: requiredEnvKeys(server, declared),
      ...(row ? { sourceBadge: mcpSourceBadge(t, row), statusPill: mcpStatusView(t, row) } : {}),
      ...(pinnedSpec(form) ? { pinned: pinnedSpec(form) } : {}),
      ...(row?.lastError ? { lastError: row.lastError } : {})
    })
  }, [market, mcp.configText, notify, openSheet, rows, t])

  // A toast action runs after later renders; it must see the config as saved.
  const openEditRef = useRef(openEdit)
  openEditRef.current = openEdit

  const installDirect = useCallback(async (item: MarketplaceItem): Promise<void> => {
    if (!item.mcpConfig) return
    const audit = auditMarketplaceInstall(item, workspaceRoot)
    if (!audit.ok) throw new Error(audit.errors.join('\n'))
    const merged = mergeMcpJsonConfig(await mcp.current(), item.mcpConfig(workspaceRoot))
    const name = itemTitle(item, t)
    if (merged.alreadyExists) {
      notify({ tone: 'info', message: t('pluginAlreadyAdded') })
      return
    }
    await mcp.write(merged.text)
    notify({ tone: 'success', message: t('pluginsToastMcpEnabled', { name }) })
    void mcp.refreshOverlay()
  }, [mcp, notify, t, workspaceRoot])

  const saveForm = useCallback(async (form: McpServerForm, state: McpSheetState): Promise<void> => {
    if (state.mode === 'install' || launchChanged(state.original, form)) {
      const fragment = JSON.parse(applyMcpServerForm('{}', form, { requiredKeys: state.requiredKeys })) as Record<string, unknown>
      const audit = auditMcpConfigSupplyChain(fragment)
      if (!audit.ok) throw new Error(audit.errors.join('\n'))
    }
    const text = await mcp.current()
    if (state.mode === 'install' && readMcpServer(text, form.id)) throw new Error(t('pluginAlreadyAdded'))
    await mcp.write(applyMcpServerForm(text, form, { requiredKeys: state.requiredKeys }))
    if (state.marketSourceId) market.setMcpOrigin(form.id, state.marketSourceId)
    const missing = missingEnvKeys(form.env, state.requiredKeys)
    if (state.mode === 'edit') {
      notify({ tone: 'success', message: t('pluginsToastSaved', { name: state.title }) })
    } else if (form.enabled) {
      notify({ tone: 'success', message: t('pluginsToastMcpEnabled', { name: state.title }) })
    } else {
      notify({
        tone: 'info',
        message: t('pluginsToastMcpSavedDisabled', { name: state.title, keys: missing.join(', ') }),
        action: { label: t('pluginsActionConfigure'), run: () => openEditRef.current(form.id) }
      })
    }
    void mcp.refreshOverlay()
  }, [market, mcp, notify, t])

  const startInstall = useCallback(async (item: MarketplaceItem, cardKey: string): Promise<void> => {
    if (item.id === BUILTIN_GITHUB_MCP_SERVER_ID) {
      await inspectGithub()
      return
    }
    if (item.oauth) {
      setOauthItem(item)
      return
    }
    const title = itemTitle(item, t)
    setBusyKey(cardKey)
    try {
      if (item.market) {
        const plan = await market.planMcp(item)
        const form = formFromPlan(plan)
        const state: McpSheetState = {
          mode: 'install',
          title,
          form,
          requiredKeys: plan.requiredEnvKeys,
          sourceBadge: { tone: 'market', label: item.market.sourceLabel },
          ...(plan.transport === 'stdio' && (plan.pinned ?? pinnedSpec(form)) ? { pinned: plan.pinned ?? pinnedSpec(form) } : {}),
          marketSourceId: item.market.sourceId
        }
        if (form.env.length === 0) await saveForm(form, state)
        else openSheet(state)
        return
      }
      const required = requiredKeysOf(item)
      const servers = item.mcpConfig ? mcpServersFromConfig(item.mcpConfig(workspaceRoot)) : {}
      const server = servers[item.id]
      if (required.length === 0 || !isJsonRecord(server)) {
        await installDirect(item)
        return
      }
      const form = serverToForm(item.id, server)
      openSheet({
        mode: 'install',
        title,
        form,
        requiredKeys: required,
        sourceBadge: { tone: 'kun', label: t('pluginsSourceKun') },
        ...(pinnedSpec(form) ? { pinned: pinnedSpec(form) } : {})
      })
    } catch (error) {
      notify({ tone: 'error', message: errorMessage(error) })
    } finally {
      setBusyKey(null)
    }
  }, [inspectGithub, installDirect, market, notify, openSheet, saveForm, t, workspaceRoot])

  const saveSheet = useCallback(async (form: McpServerForm): Promise<void> => {
    if (!sheet) return
    setSheetBusy(true)
    setSheetError('')
    try {
      await saveForm(form, sheet)
      setSheet(null)
    } catch (error) {
      setSheetError(errorMessage(error))
    } finally {
      setSheetBusy(false)
    }
  }, [saveForm, sheet])

  const toggle = useCallback(async (row: InstalledMcpRow, enabled: boolean): Promise<void> => {
    if (enabled && row.status === 'needs-config') {
      openEdit(row.id)
      return
    }
    setToggleBusyId(row.id)
    try {
      await mcp.write(setMcpServerEnabled(await mcp.current(), row.id, enabled))
      notify({ tone: 'success', message: enabled ? t('pluginMcpEnabled') : t('pluginMcpDisabled') })
      void mcp.refreshOverlay()
    } catch (error) {
      notify({ tone: 'error', message: errorMessage(error) })
    } finally {
      setToggleBusyId(null)
    }
  }, [mcp, notify, openEdit, t])

  const remove = useCallback(async (row: InstalledMcpRow): Promise<void> => {
    try {
      await mcp.write(removeMcpServer(await mcp.current(), row.id))
      market.setMcpOrigin(row.id, null)
      setConfirmRow(null)
      setSheet(null)
      notify({ tone: 'success', message: t('pluginsToastDeleted', { name: row.title }) })
      void mcp.refreshOverlay()
    } catch (error) {
      notify({ tone: 'error', message: errorMessage(error) })
    }
  }, [market, mcp, notify, t])

  const copy = useCallback(async (row: InstalledMcpRow): Promise<void> => {
    const server = readMcpServer(mcp.configText, row.id)
    if (!server) return
    try {
      await navigator.clipboard.writeText(`${JSON.stringify({ [row.id]: server }, null, 2)}\n`)
      notify({ tone: 'success', message: t('pluginsCopied') })
    } catch (error) {
      notify({ tone: 'error', message: errorMessage(error) })
    }
  }, [mcp.configText, notify, t])

  const confirmOauth = useCallback(async (item: MarketplaceItem): Promise<void> => {
    setOauthItem(null)
    setBusyKey(item.id)
    try {
      await installDirect(item)
    } catch (error) {
      notify({ tone: 'error', message: errorMessage(error) })
    } finally {
      setBusyKey(null)
    }
  }, [installDirect, notify])

  return {
    sheet,
    sheetBusy,
    sheetError,
    closeSheet: () => setSheet(null),
    saveSheet,
    busyKey,
    toggleBusyId,
    confirmRow,
    setConfirmRow,
    oauthItem,
    setOauthItem,
    confirmOauth,
    openEdit,
    startInstall,
    toggle,
    remove,
    copy
  }
}
