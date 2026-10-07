import { Fragment, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Bookmark, ChevronDown, Loader2, RefreshCw, Save, Users, X } from 'lucide-react'
import type { AgentWiringAction, AgentWiringOverview, AgentWiringPreview } from '@shared/agent-wiring'
import { GatewayAgentPreview } from './gateway-agent-preview'
import { agentWiringErrorText, GatewayAgentRow, type AgentConnectRequest } from './gateway-agent-row'
import { settingsButtonClass } from './settings-button'

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string }

/**
 * Agents page: connect coding agents installed on this computer to Kun's
 * gateway. Kun edits only the keys it owns in each agent's config and puts
 * the user's values back on disconnect; each agent gets its own gateway key.
 */
export function GatewayAgentsPanel({ active, translation }: { active: boolean; translation?: TFunction }): ReactElement {
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
  const profiles = Object.entries(overview?.profiles ?? {})
  const gatewayOff = overview !== null && !overview.gatewayEnabled
  const disabled = gatewayOff || !overview?.models.length
  // Connecting shows the exact config diff first; nothing is written until it is confirmed.
  const connect = (agentId: string, request: AgentConnectRequest): void => { void run({ action: 'preview', agentId, ...request }, agentId) }
  const confirm = (): void => { if (pending) void run({ action: 'connect', agentId: pending.preview.agentId, ...pending.request }, pending.preview.agentId) }
  const noticeClass = { ok: 'text-emerald-700 dark:text-emerald-200', warn: 'text-amber-700 dark:text-amber-200', error: 'text-red-600' }

  return <section className="grid min-w-0 gap-3 rounded-2xl border border-ds-border bg-ds-card p-4" data-gateway-agents>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ds-ink">
          <Users className="h-4 w-4 text-accent" />{t('gatewayAgents.title')}
          {connectedCount ? <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] font-medium text-accent">
            {t('gatewayAgents.connectedCount', { count: connectedCount })}</span> : null}
        </h3>
        <p className="mt-1 max-w-[46rem] text-[12px] leading-5 text-ds-muted">{t('gatewayAgents.description')}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button type="button" className={settingsButtonClass()} disabled={loading || disabled || !connectedCount}
          title={t('gatewayAgents.syncHint')} onClick={() => void run({ action: 'sync' })}>{t('gatewayAgents.sync')}</button>
        <button type="button" className={settingsButtonClass()} disabled={loading} onClick={() => void run({ action: 'list' })}
          aria-label={t('gatewayAgents.refresh')}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
    {gatewayOff ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{t('gatewayAgents.gatewayOff')}</p>
      : overview && !overview.models.length ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{t('gatewayAgents.noModelsHint')}</p> : null}
    {notice ? <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`text-[12px] leading-5 ${noticeClass[notice.tone]}`}>{notice.text}</p> : null}
    {!overview && loading ? <p className="text-[12px] text-ds-faint">{t('gatewayAgents.loading')}</p> : null}
    {overview && !visible.length ? <p className="text-[12px] text-ds-muted">{t('gatewayAgents.noneInstalled')}</p> : null}
    <ul className="grid min-w-0 gap-2">
      {visible.map((agent) => <Fragment key={agent.id}>
        <GatewayAgentRow agent={agent} models={overview?.models ?? []}
          t={t} busy={busyAgent === agent.id} disabled={disabled || (busyAgent !== null && busyAgent !== agent.id) || (pending !== null && pending.preview.agentId !== agent.id)}
          onConnect={(request) => connect(agent.id, request)} onDisconnect={() => { setPending(null); void run({ action: 'disconnect', agentId: agent.id }, agent.id) }} />
        {pending?.preview.agentId === agent.id ? <li className="min-w-0"><GatewayAgentPreview preview={pending.preview} agentName={agent.name}
          busy={busyAgent === agent.id} t={t} onConfirm={confirm} onCancel={() => setPending(null)} /></li> : null}
      </Fragment>)}
    </ul>
    {missing.length ? <div>
      <button type="button" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ds-muted hover:text-ds-ink"
        aria-expanded={showMissing} onClick={() => setShowMissing((open) => !open)}>
        <ChevronDown className={`h-3.5 w-3.5 transition ${showMissing ? 'rotate-180' : ''}`} />
        {t('gatewayAgents.notFound', { count: missing.length })}
      </button>
      {showMissing ? <ul className="mt-2 grid gap-1.5">
        {missing.map((agent) => <li key={agent.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-ds-main/60 px-3 py-2 text-[12px]">
          <span className="min-w-0 truncate text-ds-muted">{agent.name}</span>
          <button type="button" className="shrink-0 text-[11.5px] font-medium text-accent hover:underline"
            onClick={() => void window.kunGui.openExternal(agent.homepage)}>{t('gatewayAgents.install')}</button>
        </li>)}
      </ul> : null}
    </div> : null}
    <div className="grid min-w-0 gap-2 rounded-xl border border-dashed border-ds-border p-3" data-gateway-agent-profiles>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ds-ink"><Bookmark className="h-3.5 w-3.5 text-accent" />{t('gatewayAgents.profiles')}</div>
      <p className="text-[11px] leading-5 text-ds-faint">{t('gatewayAgents.profilesHint')}</p>
      {profiles.length ? <div className="flex flex-wrap gap-1.5">
        {profiles.map(([name, profile]) => <span key={name} className="inline-flex items-center overflow-hidden rounded-full border border-ds-border text-[11.5px]">
          <button type="button" className="px-2.5 py-1 text-ds-ink hover:bg-ds-hover disabled:opacity-60" disabled={loading || disabled}
            title={Object.entries(profile).map(([agent, selection]) => `${agent}: ${selection.model}`).join('\n')}
            onClick={() => void run({ action: 'apply-profile', name })}>{name}</button>
          <button type="button" className="border-l border-ds-border px-1.5 py-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('gatewayAgents.deleteProfile', { name })} onClick={() => void run({ action: 'delete-profile', name })}>
            <X className="h-3 w-3" /></button>
        </span>)}
      </div> : null}
      <form className="flex min-w-0 gap-1.5" onSubmit={(event) => { event.preventDefault(); if (profileName.trim()) void run({ action: 'save-profile', name: profileName.trim() }) }}>
        <input value={profileName} maxLength={48} onChange={(event) => setProfileName(event.target.value)} placeholder={t('gatewayAgents.profilePlaceholder')}
          aria-label={t('gatewayAgents.profilePlaceholder')}
          className="min-w-0 flex-1 rounded-lg border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12px] text-ds-ink" />
        <button type="submit" className={settingsButtonClass()} disabled={!profileName.trim() || !connectedCount || loading}>
          <Save className="h-3.5 w-3.5" />{t('gatewayAgents.saveProfile')}</button>
      </form>
    </div>
    <p className="text-[11px] leading-5 text-ds-faint">{t('gatewayAgents.boundaries')}</p>
  </section>
}
