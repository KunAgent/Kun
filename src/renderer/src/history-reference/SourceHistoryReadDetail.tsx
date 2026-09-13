import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolBlock } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import { activateThreadTurnTarget, prepareThreadTurnTarget } from '../components/chat/thread-turn-target'
import { useCodexReferenceEnabled } from './use-codex-reference-enabled'

export type SourceReadTarget = { turnId: string; itemId: string }

export function sourceReadTargets(detail: string): SourceReadTarget[] {
  let text = detail
  try {
    const parsed = JSON.parse(detail)
    if (typeof parsed?.text === 'string') text = parsed.text
  } catch { /* Plain-text tool responses also carry the record headings. */ }
  const records = [...text.matchAll(/^\[((?:codex|claude-code):[^\s/]+) \/ ([^\s/]+) \/ /gm)]
    .map((match) => ({ turnId: match[1]!, itemId: match[2]! }))
  return [...new Map(records.map((record) => [`${record.turnId}/${record.itemId}`, record])).values()].slice(0, 20)
}

export function SourceHistoryReadDetail({ block }: { block: ToolBlock }): ReactElement {
  const { t } = useTranslation('common')
  const targets = sourceReadTargets(block.detail ?? '')
  const enabled = useCodexReferenceEnabled(targets[0]?.turnId.startsWith('claude-code:') ? 'claude-code' : 'codex')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function jump({ turnId, itemId }: SourceReadTarget): Promise<void> {
    const threadId = useChatStore.getState().activeThreadId
    if (!threadId || !enabled || busy) return
    setBusy(true); setError('')
    try {
      const detail = await prepareThreadTurnTarget(threadId, turnId, itemId)
      if (useChatStore.getState().activeThreadId === threadId) activateThreadTurnTarget(threadId, turnId, detail, itemId)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-2">
    {enabled && targets.length ? <div className="flex flex-wrap gap-2">
      {targets.map((target, index) => <button type="button" key={`${target.turnId}/${target.itemId}`} disabled={busy} title={target.itemId}
        className="rounded border border-ds-border-muted px-2 py-1 text-xs text-ds-muted hover:text-ds-ink"
        onClick={() => void jump(target)}>{t('codexHistoryReadTurn', { index: index + 1 })}</button>)}
    </div> : null}
    {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ds-ink">{block.detail}</pre>
  </div>
}
