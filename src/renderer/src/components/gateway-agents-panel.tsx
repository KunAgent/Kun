import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ChevronDown, Loader2, RefreshCw, X } from 'lucide-react'
import type { AgentWiringAction, AgentWiringOverview, AgentWiringPreview } from '@shared/agent-wiring'
import { GatewayAgentPreview } from './gateway-agent-preview'
import { agentWiringErrorText, GatewayAgentRow, type AgentConnectRequest } from './gateway-agent-row'
import { GatewaySectionHead } from './gateway-section-head'
import { settingsButtonClass } from './settings-button'

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string }

/**
 * Agents page: connect coding agents installed on this computer to Kun's
 * gateway. Kun edits only the keys it owns in each agent's config and puts
 * the user's values back on disconnect; each agent gets its own gateway key.
 */
export function GatewayAgentsPanel({ active, translation, onConnectedCount, onPrepareModels }: {
  active: boolean
  translation?: TFunction
  /** Reports how many agents go through Kun after every load or change. */
  onConnectedCount?: (count: number) => void
  /** Leads to where models are set up when the gateway has none. */
  onPrepareModels?: () => void
}): ReactElement {
  const { t: localT } = useTranslation('settings')
  const t = translation ?? localT
  const [overview, setOverview] = useState<AgentWiringOverview | null>(null)
  // Agent names for error text, read inside the action callback without re-creating it.
  const agentNames = useRef(new Map<string, string>())
  agentNames.current = new Map(overview?.agents.map((agent) => [agent.id, agent.name]))
  const [loading, setLoading] = useState(false)
  const [busyAgent, setBusyAgent] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [showMissing, setShowMissing] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [pending, setPending] = useState<{ request: AgentConnectRequest; preview: AgentWiringPreview } | null>(null)

  const run = useCallback(async (action: AgentWiringAction, busy?: string): Promise<boolean> => {
    if (busy) setBusyAgent(busy)
    else setLoading(true)
    try {
      const result = await window.kunGui.agentWiring(action)
      if (!result.ok) {
        const agent = 'agentId' in action ? agentNames.current.get(action.agentId) : undefined
        setNotice({ tone: 'error', text: agentWiringErrorText(t, { error: result.error, code: result.code, file: result.file, agent }) })
        return false
      }
      const { ok: _ok, notice: hint, applied, failed, preview, ...next } = result
      setOverview(next)
      if (action.action === 'preview') {
        if (preview) setPending({ request: { model: action.model, ...(action.smallModel ? { smallModel: action.smallModel } : {}),
          ...(action.effort ? { effort: action.effort } : {}) }, preview })
        setNotice(null)
        return true
      }
      if (action.action === 'connect') setPending(null)
      if (failed?.length) {
        setNotice({ tone: 'warn', text: t('gatewayAgents.profilePartial', { failed: failed.map((entry) => `${entry.agentId}: ${entry.error}`).join('; ') }) })
      } else if (hint === 'key-copied') {
        // Connecting a keychain agent, a new key for it, or a profile that connected one.
        const name = 'agentId' in action ? next.agents.find((agent) => agent.id === action.agentId)?.name ?? action.agentId
          : next.agents.find((agent) => agent.connected && agent.keyDelivery === 'clipboard')?.name ?? ''
        setNotice({ tone: 'ok', text: t('gatewayAgents.keyCopied', { agent: name }) })
      } else if (action.action === 'connect') {
        const name = next.agents.find((agent) => agent.id === action.agentId)?.name ?? action.agentId
        setNotice({ tone: 'ok', text: t(hint === 'restart' ? 'gatewayAgents.connectedRestart' : 'gatewayAgents.connected', { agent: name }) })
      } else if (action.action === 'disconnect') {
        const name = next.agents.find((agent) => agent.id === action.agentId)?.name ?? action.agentId
        setNotice({ tone: 'ok', text: t('gatewayAgents.disconnected', { agent: name }) })
      } else if (action.action === 'sync') {
        setNotice({ tone: 'ok', text: applied?.length ? t('gatewayAgents.synced', { count: applied.length }) : t('gatewayAgents.syncedNone') })
      } else if (action.action === 'apply-profile') {
        setNotice({ tone: 'ok', text: t('gatewayAgents.profileApplied', { name: action.name, count: applied?.length ?? 0 }) })
      } else if (action.action === 'save-profile') {
        setNotice({ tone: 'ok', text: t('gatewayAgents.profileSaved', { name: action.name }) })
        setProfileName('')
      }
      return true
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      setBusyAgent(null)
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (active) void run({ action: 'list' })
  }, [active, run])

  const agents = overview?.agents ?? []
  const visible = agents.filter((agent) => agent.installed || agent.connected)
  const missing = agents.filter((agent) => !agent.installed && !agent.connected)
  const connectedCount = agents.filter((agent) => agent.connected).length
  useEffect(() => { if (overview) onConnectedCount?.(connectedCount) }, [connectedCount, onConnectedCount, overview])
  const profiles = Object.entries(overview?.profiles ?? {})
  const gatewayOff = overview !== null && !overview.gatewayEnabled
  const disabled = gatewayOff || !overview?.models.length
  // Connecting shows the exact config diff first; nothing is written until it is confirmed.
  const connect = (agentId: string, request: AgentConnectRequest): void => { void run({ action: 'preview', agentId, ...request }, agentId) }
  const confirm = (): void => { if (pending) void run({ action: 'connect', agentId: pending.preview.agentId, ...pending.request }, pending.preview.agentId) }
  const noticeClass = { ok: 'text-ds-status-success', warn: 'text-ds-status-warning', error: 'text-ds-status-danger' }
  const callout = 'flex flex-wrap items-center gap-2 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2 text-[12px] text-ds-status-warning'

  return <section className="grid min-w-0 gap-2.5" data-gateway-agents>
    <GatewaySectionHead title={t('gatewayAgents.title')}
      badge={connectedCount ? <span className="rounded-full bg-ds-success-soft px-2 py-0.5 text-[10.5px] font-medium text-ds-status-success">
        {t('gatewayAgents.connectedCount', { count: connectedCount })}</span> : null}
      description={t('gatewayAgents.description')}
      actions={<>
        <button type="button" className={settingsButtonClass({ size: 'compact' })} disabled={loading || disabled || !connectedCount}
          title={t('gatewayAgents.syncHint')} onClick={() => void run({ action: 'sync' })}>{t('gatewayAgents.sync')}</button>
        <button type="button" className={settingsButtonClass({ size: 'compact' })} disabled={loading} onClick={() => void run({ action: 'list' })}
          aria-label={t('gatewayAgents.refresh')} title={t('gatewayAgents.refresh')}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </>} />
    {gatewayOff ? <p className={callout}>{t('gatewayAgents.gatewayOff')}</p>
      : overview && !overview.models.length ? <p className={callout}>{t('gatewayAgents.noModelsHint')}
        {onPrepareModels ? <button type="button" className={settingsButtonClass({ variant: 'link', size: 'compact' })} onClick={onPrepareModels}>
          {t('gatewaySetup.prepareModels')}</button> : null}</p> : null}
    {notice ? <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`px-1 text-[12px] leading-5 ${noticeClass[notice.tone]}`}>{notice.text}</p> : null}
    <div className="min-w-0 overflow-hidden rounded-2xl border border-ds-border bg-ds-card">
      {!overview && loading ? <p className="px-4 py-6 text-center text-[12px] text-ds-faint">{t('gatewayAgents.loading')}</p> : null}
      {overview && !visible.length ? <p className="px-4 py-6 text-center text-[12px] text-ds-muted">{t('gatewayAgents.noneInstalled')}</p> : null}
      {visible.length ? <ul className="grid min-w-0 divide-y divide-ds-border-muted">
        {visible.map((agent) => <GatewayAgentRow key={agent.id} agent={agent} models={overview?.models ?? []}
          t={t} busy={busyAgent === agent.id} disabled={disabled || (busyAgent !== null && busyAgent !== agent.id) || (pending !== null && pending.preview.agentId !== agent.id)}
          onConnect={(request) => connect(agent.id, request)} onDisconnect={() => { setPending(null); void run({ action: 'disconnect', agentId: agent.id }, agent.id) }}
          onCopyKey={() => void run({ action: 'copy-key', agentId: agent.id }, agent.id)}>
          {pending?.preview.agentId === agent.id ? <GatewayAgentPreview preview={pending.preview} agentName={agent.name}
            busy={busyAgent === agent.id} t={t} onConfirm={confirm} onCancel={() => setPending(null)} /> : null}
        </GatewayAgentRow>)}
      </ul> : null}
      {missing.length ? <div className="border-t border-ds-border-muted px-4 py-2.5">
        <button type="button" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ds-muted hover:text-ds-ink"
          aria-expanded={showMissing} onClick={() => setShowMissing((open) => !open)}>
          <ChevronDown className={`h-3.5 w-3.5 transition ${showMissing ? 'rotate-180' : ''}`} />
          {t('gatewayAgents.notFound', { count: missing.length })}
        </button>
        {showMissing ? <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {missing.map((agent) => <li key={agent.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[12px] hover:bg-ds-hover">
            <span className="min-w-0 truncate text-ds-muted">{agent.name}</span>
            <button type="button" className="shrink-0 text-[11.5px] font-medium text-accent hover:underline"
              onClick={() => void window.kunGui.openExternal(agent.homepage)}>{t('gatewayAgents.install')}</button>
          </li>)}
        </ul> : null}
      </div> : null}
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-1 text-[12px]" data-gateway-agent-profiles>
      <span className="font-medium text-ds-ink" title={t('gatewayAgents.profilesHint')}>{t('gatewayAgents.profiles')}</span>
      {profiles.length ? profiles.map(([name, profile]) => <span key={name} className="inline-flex items-center overflow-hidden rounded-full border border-ds-border bg-ds-card text-[11.5px]">
        <button type="button" className="px-2.5 py-0.5 text-ds-ink hover:bg-ds-hover disabled:opacity-60" disabled={loading || disabled}
          title={Object.entries(profile).map(([agent, selection]) => `${agent}: ${selection.model}`).join('\n')}
          onClick={() => void run({ action: 'apply-profile', name })}>{name}</button>
        <button type="button" className="border-l border-ds-border px-1.5 py-0.5 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
          aria-label={t('gatewayAgents.deleteProfile', { name })} onClick={() => void run({ action: 'delete-profile', name })}>
          <X className="h-3 w-3" /></button>
      </span>) : <span className="text-ds-faint">{t('gatewayAgents.profilesHint')}</span>}
      <form className="ml-auto flex min-w-0 gap-1.5" onSubmit={(event) => { event.preventDefault(); if (profileName.trim()) void run({ action: 'save-profile', name: profileName.trim() }) }}>
        <input value={profileName} maxLength={48} onChange={(event) => setProfileName(event.target.value)} placeholder={t('gatewayAgents.profilePlaceholder')}
          aria-label={t('gatewayAgents.profilePlaceholder')}
          className="h-7 w-40 min-w-0 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] text-ds-ink outline-none focus:border-accent" />
        <button type="submit" className={settingsButtonClass({ size: 'compact' })} disabled={!profileName.trim() || !connectedCount || loading}>
          {t('gatewayAgents.saveProfile')}</button>
      </form>
    </div>
    <p className="px-1 text-[11px] leading-5 text-ds-faint">{t('gatewayAgents.boundaries')}</p>
  </section>
}
