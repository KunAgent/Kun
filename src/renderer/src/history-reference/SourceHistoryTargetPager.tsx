import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { loadThreadTurnTargetPage, useThreadTurnTarget } from '../components/chat/thread-turn-target'
import { useCodexReferenceEnabled } from './use-codex-reference-enabled'

/** Target pages are independent of the main timeline's older-history cursor. */
export function SourceHistoryTargetPager({ threadId, turnId }: { threadId: string | null; turnId?: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const enabled = useCodexReferenceEnabled(turnId?.startsWith('opencode:') ? 'opencode' : turnId?.startsWith('claude-code:') ? 'claude-code' : 'codex')
  const target = useThreadTurnTarget((state) => state.target)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setError('') }, [target?.revision])
  if (!enabled || !target || target.threadId !== threadId || target.turnId !== turnId || !target.historyTarget) return null
  const { previousCursor, nextCursor } = target.historyTarget
  if (!previousCursor && !nextCursor && !error) return null
  async function load(direction: 'previous' | 'next'): Promise<void> {
    if (busy) return
    setBusy(true); setError('')
    try { await loadThreadTurnTargetPage(direction) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <div className="my-2 space-y-2 text-xs text-ds-muted">
    <div className="flex gap-2">
      <button type="button" disabled={busy || !previousCursor} onClick={() => void load('previous')}
        className="rounded border border-ds-border-muted px-2 py-1 disabled:opacity-40">{t('codexHistoryEarlierRecords')}</button>
      <button type="button" disabled={busy || !nextCursor} onClick={() => void load('next')}
        className="rounded border border-ds-border-muted px-2 py-1 disabled:opacity-40">{t('codexHistoryLaterRecords')}</button>
    </div>
    {error ? <p role="alert" className="text-red-500">{error}</p> : null}
  </div>
}
