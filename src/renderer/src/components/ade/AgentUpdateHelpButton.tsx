import { useState, type ReactElement } from 'react'
import { LoaderCircle } from 'lucide-react'
import { AgentIcon } from '../agent-icon'
import { settingsButtonClass } from '../settings-button'
import { askKunToUpdateAgent, type AgentUpdateRequest } from './agent-setup-help'

type T = (key: string, options?: Record<string, unknown>) => string

/** Drafts an update request into 小 Kun's chat. Nothing runs until the user sends it. */
export function AgentUpdateHelpButton({ request, t }: { request: AgentUpdateRequest; t: T }): ReactElement {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const ask = async (): Promise<void> => {
    setPending(true)
    setError('')
    try {
      await askKunToUpdateAgent(request)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="ml-auto flex min-w-0 flex-col items-end gap-1" data-agent-update-ask-kun={request.harnessId}>
      <button type="button" className={settingsButtonClass({ size: 'compact' })} aria-busy={pending || undefined} disabled={pending}
        onClick={() => void ask()} data-agent-update-ask-kun-button>
        {pending ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <AgentIcon harnessId="kun" size={14} />}
        {t('agentIntegrations.askKunUpdate')}
      </button>
      <span className="max-w-[16rem] text-right text-[11px] leading-[1.4] text-ds-faint">{t('agentIntegrations.askKunUpdateHint')}</span>
      {error ? <p role="alert" className="max-w-[16rem] break-words text-right text-[11px] text-ds-status-danger">{t('agentIntegrations.askKunFailed', { error })}</p> : null}
    </div>
  )
}
