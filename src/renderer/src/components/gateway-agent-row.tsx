import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { ChevronDown, KeyRound, Loader2 } from 'lucide-react'
import type { AgentWiringStatus, GatewayModelInfo } from '@shared/agent-wiring'
import { AgentIcon } from './agent-icon'
import { settingsButtonClass } from './settings-button'
import { Toggle } from './settings-controls'
import { homeRelativePath } from '../lib/home-relative-path'

const PROTOCOL_LABELS: Record<AgentWiringStatus['protocol'], string> = {
  anthropic: 'Anthropic Messages', responses: 'OpenAI Responses', chat: 'Chat Completions', gemini: 'Gemini API'
}

/** Agents with a separate fast/small model slot Kun can fill. */
const SMALL_MODEL_AGENTS = new Set(['claude-code', 'opencode', 'crush'])

const selectClass = 'h-8 min-w-0 max-w-full truncate rounded-lg border border-ds-border bg-ds-main px-2 text-[12px] text-ds-ink outline-none focus:border-accent disabled:opacity-60'

export function modelLabel(model: GatewayModelInfo): string {
  return model.displayName && model.displayName !== model.id ? `${model.displayName} · ${model.id}` : model.id
}

const TRANSLATED_ERRORS = new Set(['config_unreadable', 'config_unsupported', 'strict_json_required'])

/** A wiring failure in the user's language when its code is known; the runtime's own text otherwise. */
export function agentWiringErrorText(t: TFunction, failure: { error: string; code?: string; file?: string; agent?: string }): string {
  return failure.code && TRANSLATED_ERRORS.has(failure.code)
    ? t(`gatewayAgents.errors.${failure.code}`, { file: failure.file ? homeRelativePath(failure.file) : '', agent: failure.agent ?? '' })
    : failure.error
}

export type AgentConnectRequest = { model: string; smallModel?: string; effort?: string }

type RowStatus = 'connected' | 'drifted' | 'idle' | 'missing'

const STATUS_DOT: Record<RowStatus, string> = {
  connected: 'bg-ds-status-dot-success',
  drifted: 'bg-ds-status-dot-warning',
  idle: 'bg-ds-status-dot-muted',
  missing: 'bg-ds-status-dot-muted'
}

/**
 * One agent on one line: where its config lives, whether it goes through
 * Kun, the model it uses, and a switch. Turning the switch on previews the
 * config change first; turning it off restores the agent's own settings.
 */
export function GatewayAgentRow({ agent, models, busy, disabled, onConnect, onDisconnect, onCopyKey, children, t }: {
  t: TFunction
  agent: AgentWiringStatus
  models: GatewayModelInfo[]
  busy: boolean
  disabled: boolean
  onConnect: (request: AgentConnectRequest) => void
  onDisconnect: () => void
  /** For agents that keep their key in a keychain: issue a new one and copy it. */
  onCopyKey?: () => void
  /** Shown under the row, e.g. the config change awaiting confirmation. */
  children?: ReactNode
}): ReactElement {
  const initialModel = agent.model && models.some((model) => model.id === agent.model) ? agent.model : models[0]?.id ?? ''
  const [model, setModel] = useState(initialModel)
  const [smallModel, setSmallModel] = useState(agent.smallModel ?? '')
  const [effort, setEffort] = useState(agent.effort ?? '')
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => { setModel(initialModel) }, [initialModel])
  useEffect(() => { setSmallModel(agent.smallModel ?? ''); setEffort(agent.effort ?? '') }, [agent.smallModel, agent.effort])
  const selected = models.find((entry) => entry.id === model)
  // Offer only levels both the agent and the chosen model understand, when the model says.
  const efforts = useMemo(() => agent.efforts.filter((level) => !selected?.reasoningLevels ||
    selected.reasoningLevels.includes(level) || (level === 'xhigh' && selected.reasoningLevels.includes('max'))), [agent.efforts, selected])
  const changed = agent.connected && (model !== agent.model || (smallModel || undefined) !== agent.smallModel ||
    (effort || undefined) !== agent.effort)
  const status: RowStatus = !agent.installed && !agent.connected ? 'missing' : agent.drifted ? 'drifted' : agent.connected ? 'connected' : 'idle'
  const facts = selected ? [selected.contextWindow ? t('gatewayAgents.window', { tokens: Math.round(selected.contextWindow / 1000) }) : '',
    selected.reasoningLevels?.length ? t('gatewayAgents.levels', { levels: selected.reasoningLevels.join(' / ') }) : '',
    selected.images ? t('gatewayAgents.images') : ''].filter(Boolean).join(' · ') : ''
  const submit = (): void => onConnect({ model, ...(smallModel ? { smallModel } : {}), ...(effort ? { effort } : {}) })
  const statusText = status === 'connected' && agent.restartRequired
    ? `${t('gatewayAgents.status.connected')} · ${t('gatewayAgents.newSessions')}` : t(`gatewayAgents.status.${status}`)
  const detail = 'pl-11'
  return <li className="grid min-w-0 gap-1.5 px-4 py-3" data-agent-wiring-row={agent.id} data-agent-status={status}>
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ds-border-muted bg-ds-main">
        <AgentIcon harnessId={agent.id} size={18} />
      </span>
      <div className="min-w-[11rem] flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-ds-ink">{agent.name}</span>
          <span className="rounded border border-ds-border-muted px-1.5 text-[10px] leading-4 text-ds-faint">{PROTOCOL_LABELS[agent.protocol]}</span>
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ds-muted" title={agent.configFiles.join('\n')}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
          <span className={`shrink-0 ${status === 'drifted' ? 'text-ds-status-warning' : status === 'connected' ? 'text-ds-status-success' : ''}`}>{statusText}</span>
          <span className="text-ds-faint">·</span>
          <span className="min-w-0 truncate font-mono text-[11px] text-ds-faint">{agent.configFiles.map(homeRelativePath).join(' · ')}</span>
        </p>
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
        {agent.connected && agent.keyDelivery === 'clipboard' && onCopyKey ? <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact' })}
          disabled={busy} onClick={onCopyKey} title={t('gatewayAgents.copyKeyHint', { agent: agent.name })}>
          <KeyRound className="h-3.5 w-3.5" />{t('gatewayAgents.copyKey')}
        </button> : null}
        {efforts.length ? <select aria-label={t('gatewayAgents.effortFor', { agent: agent.name })} className={`${selectClass} w-[7.5rem]`}
          value={effort} disabled={busy || disabled} onChange={(event) => setEffort(event.target.value)} title={t('gatewayAgents.effort')}>
          <option value="">{t('gatewayAgents.effortDefault')}</option>
          {efforts.map((level) => <option key={level} value={level}>{t(`gatewayAgents.efforts.${level}`, { defaultValue: level })}</option>)}
        </select> : null}
        <select aria-label={t('gatewayAgents.modelFor', { agent: agent.name })} className={`${selectClass} w-[14rem]`} value={model}
          disabled={busy || disabled || !models.length} onChange={(event) => setModel(event.target.value)} title={facts || undefined}>
          {!models.length ? <option value="">{t('gatewayAgents.noModels')}</option> : null}
          {models.map((entry) => <option key={entry.id} value={entry.id}>{modelLabel(entry)}</option>)}
        </select>
        {agent.connected && (changed || agent.drifted) ? <button type="button" className={settingsButtonClass({ variant: 'primary', size: 'compact' })}
          disabled={busy || disabled || !model} onClick={submit}>
          {t(agent.drifted && !changed ? 'gatewayAgents.reconnect' : 'gatewayAgents.apply')}
        </button> : null}
        <span className="grid w-9 place-items-center">
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-ds-muted" aria-label={t('gatewayAgents.working')} />
            : <Toggle checked={agent.connected} onChange={(on) => on ? submit() : onDisconnect()}
              disabled={!agent.connected && (disabled || !model)} ariaLabel={t('gatewayAgents.toggleFor', { agent: agent.name })} />}
        </span>
      </div>
    </div>
    {SMALL_MODEL_AGENTS.has(agent.id) ? <div className={`${detail} flex min-w-0 flex-wrap items-center gap-2`}>
      <button type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-ds-muted hover:text-ds-ink"
        aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
        <ChevronDown className={`h-3 w-3 transition ${moreOpen ? 'rotate-180' : ''}`} />{t('gatewayAgents.smallModel')}
        {!moreOpen && smallModel ? <span className="font-mono text-ds-faint">· {smallModel}</span> : null}
      </button>
      {moreOpen ? <select aria-label={t('gatewayAgents.smallModelFor', { agent: agent.name })} className={`${selectClass} w-[14rem]`}
        value={smallModel} disabled={busy || disabled} onChange={(event) => setSmallModel(event.target.value)}>
        <option value="">{t('gatewayAgents.sameAsMain')}</option>
        {models.map((entry) => <option key={entry.id} value={entry.id}>{modelLabel(entry)}</option>)}
      </select> : null}
    </div> : null}
    {agent.drifted ? <p className={`${detail} text-[11.5px] leading-5 text-ds-status-warning`}>{t('gatewayAgents.driftedHint')}</p> : null}
    {agent.connected && agent.pickInAgent ? <p className={`${detail} text-[11.5px] leading-5 text-ds-muted`}>{t('gatewayAgents.pickInAgent', { agent: agent.name })}</p> : null}
    {agent.notice ? <p className={`${detail} text-[11.5px] leading-5 text-ds-status-warning`} data-agent-notice={agent.notice}>{t(`gatewayAgents.notices.${agent.notice}`, { agent: agent.name })}</p> : null}
    {agent.error ? <p role="alert" className={`${detail} text-[11.5px] leading-5 text-ds-status-danger`} data-agent-error={agent.errorCode}>
      {agentWiringErrorText(t, { error: agent.error, code: agent.errorCode, file: agent.errorFile, agent: agent.name })}</p> : null}
    {children ? <div className="mt-1 min-w-0">{children}</div> : null}
  </li>
}
