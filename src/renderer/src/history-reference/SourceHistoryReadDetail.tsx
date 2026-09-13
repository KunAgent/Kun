import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolBlock } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import { getProvider } from '../agent/registry'
import { activateThreadTurnTarget } from '../components/chat/thread-turn-target'
import { useCodexReferenceEnabled } from './use-codex-reference-enabled'

export function sourceReadTurnIds(detail: string): string[] {
  let text = detail
  try {
    const parsed = JSON.parse(detail)
    if (typeof parsed?.text === 'string') text = parsed.text
  } catch { /* Plain-text tool responses also carry the record headings. */ }
  return [...new Set([...text.matchAll(/^\[(codex:[^\s/]+) \/ /gm)].map((match) => match[1]!))].slice(0, 20)
}

export function SourceHistoryReadDetail({ block }: { block: ToolBlock }): ReactElement {
  const { t } = useTranslation('common')
  const enabled = useCodexReferenceEnabled()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const turns = sourceReadTurnIds(block.detail ?? '')
  async function jump(turnId: string): Promise<void> {
    const threadId = useChatStore.getState().activeThreadId
    if (!threadId || !enabled || busy) return
    setBusy(true); setError('')
    try {
      const detail = await getProvider().getThreadDetail(threadId, { turnId, priority: 'foreground' })
      if (!detail.blocks.some((item) => item.turnId === turnId)) throw new Error(t('codexHistoryStatus_missing'))
      if (useChatStore.getState().activeThreadId === threadId) activateThreadTurnTarget(threadId, turnId, detail)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-2">
    {enabled && turns.length ? <div className="flex flex-wrap gap-2">
      {turns.map((turnId, index) => <button type="button" key={turnId} disabled={busy} title={turnId}
        className="rounded border border-ds-border-muted px-2 py-1 text-xs text-ds-muted hover:text-ds-ink"
        onClick={() => void jump(turnId)}>{t('codexHistoryReadTurn', { index: index + 1 })}</button>)}
    </div> : null}
    {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ds-ink">{block.detail}</pre>
  </div>
}
