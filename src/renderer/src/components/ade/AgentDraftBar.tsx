import type { ReactElement } from 'react'
import { settingsButtonClass } from '../settings-button'

type T = (key: string, options?: Record<string, unknown>) => string

/**
 * Shown while a connection edit is unsaved: it is checked first, and the saved
 * connection keeps working until that check passes.
 */
export function AgentDraftBar({ dirty, busy, onDiscard, onRecheck, t }: {
  dirty: boolean
  busy: boolean
  onDiscard: () => void
  onRecheck: () => void
  t: T
}): ReactElement | null {
  if (!dirty) return null
  return <div role="status" data-agent-draft
    className="mx-3 my-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--ds-warning-soft)] px-3 py-2.5 text-[12.5px] text-ds-ink">
    <span className="min-w-0 flex-1">{t('agentCenter.connection.draftNote')}</span>
    <span className="flex shrink-0 gap-2">
      <button type="button" disabled={busy} onClick={onDiscard} data-agent-draft-discard className={settingsButtonClass({ size: 'compact' })}>
        {t('agentCenter.connection.discard')}
      </button>
      <button type="button" disabled={busy} onClick={onRecheck} data-agent-draft-check className={settingsButtonClass({ size: 'compact', variant: 'primary' })}>
        {t('agentEnablement.recheck')}
      </button>
    </span>
  </div>
}
