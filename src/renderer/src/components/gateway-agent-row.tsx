import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { AlertTriangle, CheckCircle2, ChevronDown, FileCode2, Link2, Loader2, Unlink } from 'lucide-react'
import type { AgentWiringStatus, GatewayModelInfo } from '@shared/agent-wiring'
import { AgentIcon } from './agent-icon'
import { settingsButtonClass } from './settings-button'

const PROTOCOL_LABELS: Record<AgentWiringStatus['protocol'], string> = {
  anthropic: 'Anthropic Messages', responses: 'OpenAI Responses', chat: 'Chat Completions', gemini: 'Gemini API'
}

/** Agents with a separate fast/small model slot Kun can fill. */
const SMALL_MODEL_AGENTS = new Set(['claude-code', 'opencode', 'crush'])

const selectClass = 'w-full min-w-0 max-w-full rounded-lg border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12px] text-ds-ink disabled:opacity-60'

export function modelLabel(model: GatewayModelInfo): string {
  return model.displayName && model.displayName !== model.id ? `${model.displayName} · ${model.id}` : model.id
}

const TRANSLATED_ERRORS = new Set(['config_unreadable', 'config_unsupported', 'strict_json_required'])

/** A wiring failure in the user's language when its code is known; the runtime's own text otherwise. */
export function agentWiringErrorText(t: TFunction, failure: { error: string; code?: string; file?: string; agent?: string }): string {
  return failure.code && TRANSLATED_ERRORS.has(failure.code)
    ? t(`gatewayAgents.errors.${failure.code}`, { file: failure.file ? shortPath(failure.file) : '', agent: failure.agent ?? '' })
    : failure.error
}

function shortPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/i, '~')
}

export type AgentConnectRequest = { model: string; smallModel?: string; effort?: string }

export function GatewayAgentRow({ agent, models, busy, disabled, onConnect, onDisconnect, t }: {
  t: TFunction
  agent: AgentWiringStatus
  models: GatewayModelInfo[]
  busy: boolean
  disabled: boolean
  onConnect: (request: AgentConnectRequest) => void
  onDisconnect: () => void
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
  const status = !agent.installed && !agent.connected ? 'missing' : agent.drifted ? 'drifted' : agent.connected ? 'connected' : 'idle'
  const pill = {
    connected: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200',
    drifted: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200',
    idle: 'bg-ds-main text-ds-muted',
    missing: 'bg-ds-main text-ds-faint'
  }[status]
  const submit = (): void => onConnect({ model, ...(smallModel ? { smallModel } : {}), ...(effort ? { effort } : {}) })
  return <li className="grid min-w-0 gap-2.5 rounded-xl border border-ds-border bg-ds-card p-3" data-agent-wiring-row={agent.id}>
    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ds-border-muted bg-ds-main/50">
        <AgentIcon harnessId={agent.id} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-ds-ink">{agent.name}</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${pill}`}>
            {status === 'connected' ? <CheckCircle2 className="h-3 w-3" /> : status === 'drifted' ? <AlertTriangle className="h-3 w-3" /> : null}
            {t(`gatewayAgents.status.${status}`)}
          </span>
          <span className="rounded-full border border-ds-border-muted px-1.5 py-px text-[10px] text-ds-faint">{PROTOCOL_LABELS[agent.protocol]}</span>
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-ds-faint" title={agent.configFiles.join('\n')}>
          <FileCode2 className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono">{agent.configFiles.map(shortPath).join(' · ')}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {agent.connected ? <button type="button" className={settingsButtonClass()} disabled={busy} onClick={onDisconnect}>
          <Unlink className="h-3.5 w-3.5" />{t('gatewayAgents.disconnect')}
        </button> : null}
        {!agent.connected || changed || agent.drifted ? <button type="button" className={settingsButtonClass({ variant: 'primary' })}
          disabled={busy || disabled || !model} onClick={submit} aria-busy={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          {agent.connected ? t(agent.drifted ? 'gatewayAgents.reconnect' : 'gatewayAgents.apply') : t('gatewayAgents.connect')}
        </button> : null}
      </div>
    </div>
    <div className={`grid min-w-0 gap-2 ${efforts.length ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]' : ''}`}>
      <label className="grid min-w-0 gap-1 text-[11px] text-ds-muted">{t('gatewayAgents.model')}
        <select aria-label={t('gatewayAgents.modelFor', { agent: agent.name })} className={selectClass} value={model}
          disabled={busy || disabled || !models.length} onChange={(event) => setModel(event.target.value)}>
          {!models.length ? <option value="">{t('gatewayAgents.noModels')}</option> : null}
          {models.map((entry) => <option key={entry.id} value={entry.id}>{modelLabel(entry)}</option>)}
        </select>
      </label>
      {efforts.length ? <label className="grid min-w-0 gap-1 text-[11px] text-ds-muted">{t('gatewayAgents.effort')}
        <select aria-label={t('gatewayAgents.effortFor', { agent: agent.name })} className={selectClass} value={effort}
          disabled={busy || disabled} onChange={(event) => setEffort(event.target.value)}>
          <option value="">{t('gatewayAgents.effortDefault')}</option>
          {efforts.map((level) => <option key={level} value={level}>{t(`gatewayAgents.efforts.${level}`, { defaultValue: level })}</option>)}
        </select>
      </label> : null}
    </div>
    {SMALL_MODEL_AGENTS.has(agent.id) ? <div>
      <button type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-ds-muted hover:text-ds-ink"
        aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
        <ChevronDown className={`h-3 w-3 transition ${moreOpen ? 'rotate-180' : ''}`} />{t('gatewayAgents.smallModel')}
      </button>
      {moreOpen ? <select aria-label={t('gatewayAgents.smallModelFor', { agent: agent.name })} className={`${selectClass} mt-1.5`}
        value={smallModel} disabled={busy || disabled} onChange={(event) => setSmallModel(event.target.value)}>
        <option value="">{t('gatewayAgents.sameAsMain')}</option>
        {models.map((entry) => <option key={entry.id} value={entry.id}>{modelLabel(entry)}</option>)}
      </select> : null}
    </div> : null}
    {selected?.contextWindow || selected?.reasoningLevels?.length ? <p className="text-[10.5px] text-ds-faint">
      {[selected.contextWindow ? t('gatewayAgents.window', { tokens: Math.round(selected.contextWindow / 1000) }) : '',
        selected.reasoningLevels?.length ? t('gatewayAgents.levels', { levels: selected.reasoningLevels.join(' / ') }) : '',
        selected.images ? t('gatewayAgents.images') : ''].filter(Boolean).join(' · ')}
    </p> : null}
    {agent.drifted ? <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-200">{t('gatewayAgents.driftedHint')}</p> : null}
    {agent.connected && agent.pickInAgent ? <p className="text-[11px] leading-5 text-ds-muted">{t('gatewayAgents.pickInAgent', { agent: agent.name })}</p> : null}
    {agent.notice ? <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-200" data-agent-notice={agent.notice}>{t(`gatewayAgents.notices.${agent.notice}`, { agent: agent.name })}</p> : null}
    {agent.error ? <p role="alert" className="text-[11px] leading-5 text-red-600" data-agent-error={agent.errorCode}>
      {agentWiringErrorText(t, { error: agent.error, code: agent.errorCode, file: agent.errorFile, agent: agent.name })}</p> : null}
  </li>
}
