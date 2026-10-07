import { useState, type ReactElement } from 'react'
import { LoaderCircle } from 'lucide-react'
import { AgentIcon } from '../agent-icon'
import { askKunAboutAgentSetup, type AgentSetupIssue } from './agent-setup-help'

type T = (key: string, options?: Record<string, unknown>) => string

/** Shown under a failed install or update: opens 小 Kun with the failure drafted. */
export function AgentSetupHelpButton({ issue, t }: { issue: AgentSetupIssue; t: T }): ReactElement {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const ask = async (): Promise<void> => {
    setPending(true)
    setError('')
    try {
      await askKunAboutAgentSetup(issue)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-agent-ask-kun={issue.harnessId}>
      <button type="button" data-settings-action="secondary" data-settings-size="default" aria-busy={pending} disabled={pending}
        onClick={() => void ask()} data-agent-ask-kun-button
        className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-3 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-45">
        {pending ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <AgentIcon harnessId="kun" size={14} />}
        {t('agentIntegrations.askKun')}
      </button>
      <span className="min-w-0 text-[11px] text-ds-faint">{t('agentIntegrations.askKunHint')}</span>
      {error ? <p role="alert" className="w-full break-words text-[11px] text-red-600">{t('agentIntegrations.askKunFailed', { error })}</p> : null}
    </div>
  )
}
