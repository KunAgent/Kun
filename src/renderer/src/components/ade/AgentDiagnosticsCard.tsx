import { useState, type ReactElement } from 'react'
import { Check, Copy, LoaderCircle, RefreshCw } from 'lucide-react'
import type { AdeHarnessReadiness, AdeHarnessTestResult } from '@shared/ade-harnesses'
import { SettingsCard } from '../settings-controls'
import { settingsButtonClass } from '../settings-button'
import { AgentDiagnosticRows } from './AgentDiagnosticRows'
import { AgentSetupHelpButton } from './AgentSetupHelpButton'
import type { AgentSetupIssue } from './agent-setup-help'

type T = (key: string, options?: Record<string, unknown>) => string

/**
 * What the last readiness check found, kept on screen: the diagnostic rows,
 * the failure and its details, and the actions that follow from it. A trial
 * turn is a separate, confirmed step because it spends the Agent's quota.
 */
export function AgentDiagnosticsCard({ harnessId, readiness, error, errorDetail, checking, busy, onRecheck, onTrial, reportText, issue, t }: {
  harnessId: string
  readiness?: AdeHarnessReadiness
  /** An i18n key under `agentEnablement.` or a raw message. */
  error: string
  errorDetail: string
  checking: boolean
  busy: boolean
  onRecheck: () => void
  onTrial?: () => Promise<AdeHarnessTestResult>
  reportText: () => string
  issue: (failure: string) => AgentSetupIssue
  t: T
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const [confirmTrial, setConfirmTrial] = useState(false)
  const [trial, setTrial] = useState<{ pending: boolean; result?: AdeHarnessTestResult; error?: string }>({ pending: false })
  const failure = error ? (error.startsWith('agentEnablement.') ? t(error) : error) : ''
  const checkedAt = readiness?.checkedAt ? new Date(readiness.checkedAt) : null

  const copy = (): void => {
    void navigator.clipboard?.writeText(reportText()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    }).catch(() => undefined)
  }
  const runTrial = async (): Promise<void> => {
    if (!onTrial) return
    setConfirmTrial(false)
    setTrial({ pending: true })
    try {
      setTrial({ pending: false, result: await onTrial() })
    } catch (cause) {
      setTrial({ pending: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }
  const trialResult = trial.result?.trial

  return <SettingsCard title={t('agentCenter.diagnostics.title')}
    description={checkedAt ? t('agentCenter.diagnostics.checkedAt', { time: checkedAt.toLocaleString() }) : t('agentCenter.diagnostics.never')}
    action={<div className="flex shrink-0 items-center gap-2">
      <button type="button" onClick={copy} data-agent-copy-diagnostics className={settingsButtonClass({ size: 'compact' })}>
        {copied ? <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />}
        {copied ? t('adeAgentCopied') : t('agentCenter.diagnostics.copy')}
      </button>
      <button type="button" onClick={onRecheck} disabled={busy} aria-busy={checking} data-agent-recheck
        className={settingsButtonClass({ size: 'compact' })}>
        <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} strokeWidth={2} />
        {t('agentEnablement.recheck')}
      </button>
    </div>}>
    <div className="space-y-3 px-3 py-3.5 text-[12px] text-ds-muted" data-agent-diagnostics-card={harnessId}>
      {failure ? <p role="alert" className="break-words text-ds-status-danger" data-agent-enable-error>{failure}</p> : null}
      {errorDetail ? <details className="break-words text-[11px]">
        <summary className="cursor-pointer">{t('agentEnablement.errorDetails')}</summary>
        <p className="mt-1 whitespace-pre-wrap">{errorDetail}</p>
      </details> : null}
      {readiness ? <div className="space-y-1.5" data-agent-readiness-result>
        {readiness.diagnostics?.length
          ? <AgentDiagnosticRows rows={readiness.diagnostics} />
          : readiness.checks.map((check) => <div key={check.id} data-agent-readiness-check={check.id} data-ok={check.ok}>
            {check.ok ? '✓ ' : '✗ '}{t(`agentEnablement.checks.${check.id}`)}{check.detail ? `: ${check.detail}` : ''}
          </div>)}
        <p>{t(readiness.authentication === 'verified' ? 'agentEnablement.authVerified' : 'agentEnablement.authUnverified')}</p>
      </div> : !failure ? <p>{t('agentCenter.diagnostics.empty')}</p> : null}
      {failure && !checking ? <AgentSetupHelpButton t={t} issue={issue(errorDetail || failure)} /> : null}
      <p className="text-[11px] text-ds-faint">{t('agentEnablement.quotaUnverified')}</p>
    </div>
    {onTrial ? <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-[12px]" data-agent-trial>
      {trial.pending ? <span role="status" className="flex items-center gap-2 text-ds-muted"><LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />{t('agentCenter.diagnostics.trialRunning')}</span>
        : trialResult ? <span role="status" data-agent-trial-result={trialResult.ok ? 'ok' : 'failed'}
          className={trialResult.ok ? 'text-ds-status-success' : 'text-ds-status-danger'}>
          {trialResult.ok ? '✓ ' : '✗ '}{t('agentCenter.diagnostics.trialDone', { ms: Math.round(trialResult.durationMs) })}
          {trialResult.usage ? ` · ${t('adeAgentTest.tokens', { count: trialResult.usage.totalTokens })}` : ''}
          {trialResult.error ? ` · ${trialResult.error}` : ''}
        </span>
          : trial.error ? <span role="alert" className="text-ds-status-danger">{trial.error}</span>
            : confirmTrial ? <span className="text-ds-muted">{t('agentAdd.trialWarning')}</span>
              : <span className="text-ds-faint">{t('agentCenter.diagnostics.trialHint')}</span>}
      {confirmTrial ? <span className="flex gap-2">
        <button type="button" onClick={() => setConfirmTrial(false)} className={settingsButtonClass({ size: 'compact' })}>{t('agentCenter.cancel')}</button>
        <button type="button" onClick={() => void runTrial()} data-agent-trial-confirm className={settingsButtonClass({ size: 'compact', variant: 'primary' })}>{t('adeAgentAction.trial')}</button>
      </span> : <button type="button" disabled={busy || trial.pending} onClick={() => setConfirmTrial(true)} data-agent-trial-start
        className={settingsButtonClass({ size: 'compact' })}>{t('agentCenter.diagnostics.trialStart')}</button>}
    </div> : null}
  </SettingsCard>
}
