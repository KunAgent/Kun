import { useState, type ReactElement } from 'react'
import { Check, Copy, LoaderCircle, RefreshCw } from 'lucide-react'
import type { AdeHarnessReadiness, AdeHarnessTestResult } from '@shared/ade-harnesses'
import { settingsButtonClass } from '../settings-button'
import { AgentSection } from './AgentCenterParts'
import { AgentDiagnosticRows } from './AgentDiagnosticRows'
import { AgentSetupHelpButton } from './AgentSetupHelpButton'
import type { AgentSetupIssue } from './agent-setup-help'

type T = (key: string, options?: Record<string, unknown>) => string

function summaryOf(readiness: AdeHarnessReadiness | undefined): { passed: number; issues: number } {
  if (!readiness) return { passed: 0, issues: 0 }
  if (readiness.diagnostics?.length) {
    return { passed: readiness.diagnostics.filter((row) => row.status === 'ok').length,
      issues: readiness.diagnostics.filter((row) => row.status === 'error').length }
  }
  return { passed: readiness.checks.filter((check) => check.ok).length, issues: readiness.checks.filter((check) => !check.ok).length }
}

/**
 * What the last readiness check found, kept on screen: one summary line
 * (works / did not pass / never checked), the diagnostic rows, the failure
 * and its details. A trial turn is a separate, confirmed step because it
 * spends the Agent's quota.
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
  const { passed, issues } = summaryOf(readiness)
  const outcome = checking ? 'checking' : failure || issues > 0 ? 'failed' : readiness ? 'ok' : 'never'

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
  const detail = [
    passed ? t('agentCenter.check.passed', { count: passed }) : '',
    issues ? t('agentCenter.check.issues', { count: issues }) : '',
    readiness && readiness.authentication !== 'verified' ? t('agentCenter.check.unverified') : '',
    checkedAt ? t('agentCenter.check.at', { time: checkedAt.toLocaleString() }) : ''
  ].filter(Boolean).join(' · ')
  const mark = outcome === 'checking' ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin text-accent" />
    : outcome === 'ok' ? <Check aria-hidden className="h-4 w-4" strokeWidth={2.6} />
      : outcome === 'failed' ? <span aria-hidden className="text-[13px] font-bold">!</span> : <span aria-hidden className="h-2 w-2 rounded-full bg-ds-faint" />
  const markClass = outcome === 'ok' ? 'bg-ds-success-soft text-ds-status-success' : outcome === 'failed'
    ? 'bg-[var(--ds-warning-soft)] text-ds-status-warning' : 'bg-ds-subtle text-ds-muted'

  return <div className="space-y-2.5" data-agent-diagnostics-section>
    <AgentSection title={t('agentCenter.diagnostics.title')} description={t('agentCenter.check.free')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3.5" data-agent-diagnostics-card={harnessId} data-outcome={outcome}>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${markClass}`}>{mark}</span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-[13px] font-semibold text-ds-ink">{outcome === 'checking' ? t('agentEnablement.recheck')
            : t(`agentCenter.check.${outcome === 'ok' ? 'ok' : outcome === 'failed' ? 'failed' : 'never'}`)}</p>
          <p className="mt-0.5 text-[12px] leading-[1.45] text-ds-muted">{detail || t('agentCenter.diagnostics.empty')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={copy} data-agent-copy-diagnostics className={settingsButtonClass({ size: 'compact', variant: 'ghost' })}>
            {copied ? <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />}
            {copied ? t('adeAgentCopied') : t('agentCenter.diagnostics.copy')}
          </button>
          <button type="button" onClick={onRecheck} disabled={busy} aria-busy={checking} data-agent-recheck
            className={settingsButtonClass({ size: 'compact' })}>
            <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} strokeWidth={2} />
            {t('agentEnablement.recheck')}
          </button>
        </div>
      </div>
      {failure || errorDetail ? <div className="space-y-2 px-3 py-3 text-[12px]">
        {failure ? <p role="alert" className="break-words font-medium text-ds-status-danger" data-agent-enable-error>{failure}</p> : null}
        {errorDetail ? <details className="break-words text-[11.5px] text-ds-muted">
          <summary className="cursor-pointer">{t('agentEnablement.errorDetails')}</summary>
          <p className="mt-1 whitespace-pre-wrap font-mono">{errorDetail}</p>
        </details> : null}
        {failure && !checking ? <AgentSetupHelpButton t={t} issue={issue(errorDetail || failure)} /> : null}
      </div> : null}
      {readiness ? <div className="space-y-2 px-3 py-3 text-[12.5px] text-ds-muted" data-agent-readiness-result>
        {readiness.diagnostics?.length
          ? <AgentDiagnosticRows rows={readiness.diagnostics} />
          : readiness.checks.map((check) => <div key={check.id} data-agent-readiness-check={check.id} data-ok={check.ok}>
            {check.ok ? '✓ ' : '✗ '}{t(`agentEnablement.checks.${check.id}`)}{check.detail ? `: ${check.detail}` : ''}
          </div>)}
        <p className="text-[11.5px] text-ds-faint">{t(readiness.authentication === 'verified' ? 'agentEnablement.authVerified' : 'agentEnablement.authUnverified')}</p>
      </div> : null}
    </AgentSection>
    {onTrial ? <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12px]" data-agent-trial>
      {trial.pending ? <span role="status" className="flex items-center gap-2 text-ds-muted"><LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />{t('agentCenter.diagnostics.trialRunning')}</span>
        : trialResult ? <span role="status" data-agent-trial-result={trialResult.ok ? 'ok' : 'failed'}
          className={trialResult.ok ? 'text-ds-status-success' : 'text-ds-status-danger'}>
          {trialResult.ok ? '✓ ' : '✗ '}{t('agentCenter.diagnostics.trialDone', { ms: Math.round(trialResult.durationMs) })}
          {trialResult.usage ? ` · ${t('adeAgentTest.tokens', { count: trialResult.usage.totalTokens })}` : ''}
          {trialResult.error ? ` · ${trialResult.error}` : ''}
        </span>
          : trial.error ? <span role="alert" className="text-ds-status-danger">{trial.error}</span>
            : confirmTrial ? <span className="text-ds-muted">{t('agentAdd.trialWarning')}</span>
              : <span className="text-ds-faint">{t('agentCenter.check.trialAsk')}</span>}
      {confirmTrial ? <span className="flex gap-2">
        <button type="button" onClick={() => setConfirmTrial(false)} className={settingsButtonClass({ size: 'compact' })}>{t('agentCenter.cancel')}</button>
        <button type="button" onClick={() => void runTrial()} data-agent-trial-confirm className={settingsButtonClass({ size: 'compact', variant: 'primary' })}>{t('adeAgentAction.trial')}</button>
      </span> : <button type="button" disabled={busy || trial.pending} onClick={() => setConfirmTrial(true)} data-agent-trial-start
        className={settingsButtonClass({ size: 'compact', variant: 'link' })}>{t('agentCenter.diagnostics.trialStart')}</button>}
    </div> : null}
  </div>
}
