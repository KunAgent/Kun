import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import type { ChatBlock } from '../agent/types'
import { historyRequest, type HistoryPage } from './history-reference-api'
import { useCodexReferenceEnabled } from './use-codex-reference-enabled'
import { useThreadTurnTarget } from '../components/chat/thread-turn-target'

type SourceRecord = { itemId: string; turnId: string; kind: string; label?: string }
type Content = NonNullable<HistoryPage['content']>

export function sourceHistoryRecords(blocks: ChatBlock[]): SourceRecord[] {
  const records = blocks.flatMap((block): SourceRecord[] => {
    if (!block.turnId?.startsWith('codex:') || (!block.sourceRecords?.length && !['user', 'assistant', 'reasoning', 'tool'].includes(block.kind))) return []
    const itemId = block.sourceItemId || (block.kind === 'tool' && typeof block.meta?.sourceItemId === 'string'
      ? block.meta.sourceItemId : block.id)
    return (block.sourceRecords ?? [{ itemId, kind: block.kind }]).map((record) => ({
      ...record, turnId: block.turnId!, ...(block.kind === 'tool' ? { label: block.summary } : {})
    }))
  })
  return [...new Map(records.map((record) => [record.itemId, record])).values()]
}

/** Reads one bounded source segment into component memory; never adds it to chat history. */
export function SourceHistoryRecordViewer({ blocks, referenceId, threadId }: { blocks: ChatBlock[]; referenceId?: string; threadId?: string | null }): ReactElement | null {
  const { t } = useTranslation('common')
  const enabled = useCodexReferenceEnabled()
  const records = useMemo(() => sourceHistoryRecords(blocks), [blocks])
  const target = useThreadTurnTarget((state) => state.target)
  const targetRecord = target && target.threadId === threadId ? records.find((record) => record.itemId === target.itemId && record.turnId === target.turnId) : undefined
  const handledTarget = useRef<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<SourceRecord | null>(null)
  const [content, setContent] = useState<Content | null>(null)
  const [previousOffsets, setPreviousOffsets] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    handledTarget.current = null
    setExpanded(false); setContent(null); setSelected(null); setLoading(false); setError('')
    return () => { request.current?.abort(); request.current = null }
  }, [referenceId, enabled])

  const read = useCallback(async (record: SourceRecord, offset: number, previous: number[]): Promise<void> => {
    if (!enabled || !referenceId) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setSelected(record); setContent(null); setError(''); setLoading(true)
    try {
      const query = new URLSearchParams({ itemId: record.itemId, turnId: record.turnId, contentOffset: String(offset), limit: '1' })
      const page = await historyRequest<HistoryPage>(`/v1/history-sources/${encodeURIComponent(referenceId)}/timeline?${query}`, undefined, controller.signal)
      if (controller.signal.aborted) return
      if (!page.content || page.content.itemId !== record.itemId || page.content.offset !== offset) {
        throw new Error(page.warnings.join(' · ') || t('codexHistoryRecordUnavailable'))
      }
      setContent(page.content); setPreviousOffsets(previous)
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err)) }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [enabled, referenceId, t])
  useEffect(() => {
    if (!enabled || !referenceId || !targetRecord || !target || handledTarget.current === target.revision) return
    handledTarget.current = target.revision
    setExpanded(true)
    void read(targetRecord, 0, [])
  }, [enabled, referenceId, targetRecord, target, read])
  function toggle(): void {
    if (expanded) {
      request.current?.abort(); request.current = null
      setContent(null); setSelected(null); setLoading(false); setError('')
    }
    setExpanded(!expanded)
  }
  if (!records.length) return null
  return <section data-source-history-target={targetRecord ? 'true' : undefined} className="mt-3 text-xs text-ds-muted" aria-label={t('codexHistoryRecordViewer')}>
    <button type="button" onClick={toggle} aria-expanded={expanded} className="flex items-center gap-1.5 hover:text-ds-ink">
      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<FileText size={13} />{t('codexHistoryRecordViewer')}
    </button>
    {expanded ? <div className="mt-2 space-y-2 rounded-lg border border-ds-border-muted p-3">
      <p>{t(referenceId ? 'codexHistoryRecordHint' : 'codexHistoryRecordAfterBranch')}</p>
      <div className="flex flex-wrap gap-2">{records.map((record, index) => <button key={record.itemId} type="button"
        disabled={!enabled || !referenceId} aria-pressed={selected?.itemId === record.itemId}
        onClick={() => void read(record, 0, [])} title={record.itemId}
        className="max-w-full truncate rounded border border-ds-border-muted px-2 py-1 hover:bg-ds-hover aria-pressed:bg-ds-subtle disabled:opacity-50">
        {index + 1}. {record.label ? `${record.label} · ` : ''}{t(`codexHistoryRecord_${record.kind}`)}
      </button>)}</div>
      {loading ? <p role="status">{t('loading')}</p> : null}
      {error ? <p role="alert" className="text-red-500">{error}</p> : null}
      {content && selected ? <>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-ds-ink">{content.text}</pre>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('codexHistoryRecordPosition', { start: content.totalChars ? content.offset + 1 : 0,
            end: content.offset + content.text.length, total: content.totalChars })}</span>
          <div className="flex gap-2">
            <button type="button" disabled={!previousOffsets.length || loading} className="rounded border border-ds-border-muted px-2 py-1 disabled:opacity-40"
              onClick={() => void read(selected, previousOffsets.at(-1)!, previousOffsets.slice(0, -1))}>{t('codexHistoryRecordPrevious')}</button>
            <button type="button" disabled={content.nextOffset === undefined || loading} className="rounded border border-ds-border-muted px-2 py-1 disabled:opacity-40"
              onClick={() => void read(selected, content.nextOffset!, [...previousOffsets, content.offset])}>{t('codexHistoryRecordNext')}</button>
          </div>
        </div>
      </> : null}
    </div> : null}
  </section>
}
