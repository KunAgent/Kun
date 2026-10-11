import type { TFunction } from 'i18next'
import { AlertTriangle, Check, Copy, XCircle } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { settingsButtonClass } from './settings-button'
import { Toggle } from './settings-controls'

/** What the gateway is doing right now, as one word the header can color. */
export type GatewayHealth = 'running' | 'off' | 'pending' | 'problem' | 'down'

export type GatewayProblem = {
  id: string
  tone: 'warn' | 'error'
  text: string
  /** Longer runtime text, kept on one line with the full value in its title. */
  detail?: string
  action?: { label: string; onClick: () => void; disabled?: boolean }
}

const DOT: Record<GatewayHealth, string> = {
  running: 'bg-ds-status-dot-success',
  off: 'bg-ds-status-dot-muted',
  pending: 'bg-ds-status-dot-warning',
  problem: 'bg-ds-status-dot-danger',
  down: 'bg-ds-status-dot-muted'
}

const LABEL: Record<GatewayHealth, string> = {
  running: 'text-ds-status-success',
  off: 'text-ds-faint',
  pending: 'text-ds-status-warning',
  problem: 'text-ds-status-danger',
  down: 'text-ds-muted'
}

/**
 * The gateway in one row: whether it answers, what it offers, the address to
 * give an agent, and its switch. Problems appear under it only while they last.
 */
export function GatewayStatusHeader({ t, health, stateLabel, enabled, togglePending, onToggle, address, modelCount, agentCount, problems }: {
  t: TFunction
  health: GatewayHealth
  stateLabel: string
  enabled: boolean
  togglePending: boolean
  onToggle: (enabled: boolean) => void
  address: string
  /** Models the runtime says it exports; undefined while the runtime is unreachable. */
  modelCount?: number
  agentCount: number
  problems: GatewayProblem[]
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      globalThis.setTimeout(() => setCopied(false), 1_500)
    } catch { setCopied(false) }
  }
  const summary = enabled
    ? [t('gatewaySetup.summaryModels', { count: modelCount ?? 0 }), t('gatewaySetup.summaryAgents', { count: agentCount }), t('gatewaySetup.protocols')]
      .filter((_, index) => index !== 0 || modelCount !== undefined).join(' · ')
    : t('gatewaySetup.summaryOff')
  return <section className="grid min-w-0 gap-3 rounded-2xl border border-ds-border bg-ds-card px-4 py-3.5" data-gateway-status={health}>
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
      <span className="relative grid h-3 w-3 shrink-0 place-items-center" aria-hidden="true">
        {health === 'running' ? <span className={`absolute inset-0 animate-ping rounded-full opacity-40 ${DOT[health]}`} /> : null}
        <span className={`relative h-2.5 w-2.5 rounded-full ${DOT[health]}`} />
      </span>
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-[14px] font-semibold text-ds-ink">{t('gatewaySetup.title')}</h3>
          <span className={`text-[12px] font-medium ${LABEL[health]}`} data-gateway-state>{stateLabel}</span>
        </div>
        <p className="mt-0.5 text-[12px] leading-5 text-ds-muted">{summary}</p>
      </div>
      <div className="flex min-w-0 max-w-full items-center gap-0.5 rounded-lg border border-ds-border bg-ds-main py-0.5 pl-2.5 pr-0.5">
        <code className="min-w-0 truncate font-mono text-[11.5px] text-ds-ink" title={address}>{address}</code>
        <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'inline-icon' })}
          aria-label={t('gatewaySetup.copyAddress')} title={t('gatewaySetup.copyAddress')} onClick={() => void copy()}>
          {copied ? <Check className="h-3.5 w-3.5 text-ds-status-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <Toggle checked={enabled} disabled={togglePending} onChange={onToggle} ariaLabel={t('gatewaySetup.toggle')} />
    </div>
    {problems.length ? <ul className="grid min-w-0 gap-1.5 border-t border-ds-border-muted pt-2.5">
      {problems.map((problem) => <li key={problem.id} role={problem.tone === 'error' ? 'alert' : 'status'}
        className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-5 ${problem.tone === 'error' ? 'text-ds-status-danger' : 'text-ds-status-warning'}`}>
        {problem.tone === 'error' ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
        <span className="font-medium">{problem.text}</span>
        {problem.detail ? <span className="min-w-0 max-w-full flex-1 truncate text-ds-muted" title={problem.detail}>{problem.detail}</span> : null}
        {problem.action ? <button type="button" className={settingsButtonClass({ size: 'compact' })} disabled={problem.action.disabled}
          onClick={problem.action.onClick}>{problem.action.label}</button> : null}
      </li>)}
    </ul> : null}
  </section>
}
