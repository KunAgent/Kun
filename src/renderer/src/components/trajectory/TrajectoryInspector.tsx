import { X } from 'lucide-react'
import { diffLines } from 'diff'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { kunAttachmentContentPath } from '@shared/kun-endpoints'
import { fetchTrajectoryDetail, type TrajectoryDetail, type TrajectoryDetailSection } from '../../agent/trajectory'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { StreamdownAssistant } from '../chat/StreamdownAssistant'
import type { HarnessCell, HarnessRequestBoundary } from './trajectory-harness-model'
import { TrajectoryJsonTree } from './TrajectoryJsonTree'
import { TrajectoryMessageSource } from './TrajectoryMessageSource'
import { TrajectoryRawBlocks } from './TrajectoryRawBlocks'
import { TrajectoryInspectorSummary } from './TrajectoryInspectorSummary'
import styles from './TrajectoryInspector.module.css'

type Tab = { id: TrajectoryDetailSection; label: string }

export function TrajectoryInspector({
  threadId,
  cell,
  request,
  parentRequest,
  width,
  onWidthChange,
  onClose,
  onSelectParentRequest,
  onSelectToolCall,
  loadDetail = fetchTrajectoryDetail
}: {
  threadId: string
  cell: HarnessCell | null
  request: HarnessRequestBoundary | null
  parentRequest: HarnessRequestBoundary | null
  width: number | null
  onWidthChange: (width: number | null) => void
  onClose: () => void
  onSelectParentRequest: (requestId: string) => void
  onSelectToolCall?: (callId: string) => void
  loadDetail?: typeof fetchTrajectoryDetail
}): ReactElement | null {
  const { t } = useTranslation('common')
  const targetId = request ? `request:${request.request.requestId}` : cell?.record.id
  const tabs = tabsFor(cell, request, t)
  const tabSignature = tabs.map((tab) => tab.id).join('|')
  const fallbackTab = tabs[0]?.id ?? 'overview'
  const [active, setActive] = useState<TrajectoryDetailSection>('overview')
  const [cache, setCache] = useState<Map<string, TrajectoryDetail>>(new Map())
  const [liveDetail, setLiveDetail] = useState<{ key: string; value: TrajectoryDetail } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const resize = useRef<{ pointerId: number; startX: number; startWidth: number; splitWidth: number } | null>(null)
  useEffect(() => {
    const available = new Set(tabSignature.split('|'))
    setActive((current) => available.has(current)
      ? current
      : fallbackTab)
  }, [fallbackTab, tabSignature, targetId])
  useEffect(() => {
    if (!targetId) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, targetId])
  const detailRevision = request
    ? `${request.request.status}:${request.request.completedAt ?? ''}`
    : cell ? `${cell.status}:${'itemIds' in cell.record ? cell.record.itemIds.join(',') : ''}:${cell.record.completedAt ?? ''}${cell.status === 'running' ? `:${cell.record.sourceSeq ?? ''}:${cell.text}:${cell.thinking}:${cell.result}` : ''}` : ''
  const key = targetId ? `${threadId}:${targetId}:${detailRevision}:${active}` : ''
  const running = request?.request.status === 'running' || cell?.status === 'running'
  const runningRecord = running ? request?.request ?? cell?.record : null
  const cached = cache.has(key)
  const detail = running
    ? liveDetail?.key === key ? liveDetail.value : undefined
    : cache.get(key)
  useEffect(() => {
    setCache(new Map())
    setLiveDetail(null)
    setLoadError(null)
  }, [threadId])
  useEffect(() => {
    if (!targetId || active === 'overview' || (!running && cached)) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void loadDetail(threadId, targetId, active)
      .then((value) => {
        if (cancelled) return
        if (running) setLiveDetail({ key, value })
        else setCache((current) => cacheDetail(current, key, value))
      })
      .catch((error: unknown) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [active, cached, key, loadDetail, retryNonce, running, runningRecord, targetId, threadId])
  if (!targetId) return null

  const title = request
    ? `Request #${request.number}`
    : cell?.kind.toUpperCase() ?? 'Event'
  const location = request
    ? `Turn ${request.request.turnId} · Step ${request.request.step}`
    : cell ? `Turn ${cell.turn} · Step ${cell.step}` : ''

  return (
    <aside className={styles.details} style={width === null ? undefined : { width }} aria-label={t('trajectoryDetails')}>
      <div
        className={styles.resizeHandle}
        role="separator"
        tabIndex={0}
        aria-label={t('trajectoryResizeDetails')}
        onDoubleClick={() => onWidthChange(null)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const split = event.currentTarget.parentElement?.parentElement
          if (!split) return
          resize.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: event.currentTarget.parentElement!.getBoundingClientRect().width, splitWidth: split.getBoundingClientRect().width }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const drag = resize.current
          if (!drag || drag.pointerId !== event.pointerId) return
          onWidthChange(clampWidth(drag.startWidth + drag.startX - event.clientX, drag.splitWidth))
        }}
        onPointerUp={(event) => { if (resize.current?.pointerId === event.pointerId) { resize.current = null; event.currentTarget.releasePointerCapture(event.pointerId) } }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          const splitWidth = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect().width ?? 720
          const current = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 380
          onWidthChange(clampWidth(current + (event.key === 'ArrowLeft' ? 16 : -16), splitWidth))
          event.preventDefault()
        }}
      />
      <div className={styles.header}><div className={styles.title}><span className={styles.dot} /><strong className={styles.kindTitle} data-kind={cell?.kind}>{title}</strong><span className={styles.location}>{location}</span></div><button type="button" className={styles.close} onClick={onClose} aria-label={t('trajectoryBack')}><X /></button></div>
      <div className={styles.tabs} role="tablist">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={active === tab.id ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setActive(tab.id)}>{tab.label}</button>)}</div>
      <div className={styles.body} role="tabpanel">
        {active === 'overview' ? (
          <TrajectoryInspectorSummary
            cell={cell}
            request={request}
            parentRequest={parentRequest}
            onSelectParentRequest={onSelectParentRequest}
            onSelectSection={setActive}
          />
        ) : loading && !detail ? <div className={styles.empty}>{t('trajectoryLoading')}</div>
          : loadError && !detail ? <div className={styles.detailError}><span>{t('trajectoryDetailLoadFailed')}</span><button type="button" onClick={() => setRetryNonce((value) => value + 1)}>{t('trajectoryRetry')}</button></div>
            : detail ? <DetailContent detail={detail} threadId={threadId} attachmentIds={cell?.attachmentIds ?? []} onSelectToolCall={onSelectToolCall} /> : null}
      </div>
    </aside>
  )
}

function DetailContent({
  detail,
  threadId,
  attachmentIds,
  onSelectToolCall
}: {
  detail: TrajectoryDetail
  threadId: string
  attachmentIds: readonly string[]
  onSelectToolCall?: (callId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  if (detail.state === 'not_captured') return <div className={styles.empty}>{t('trajectoryDetailNotCaptured')}</div>
  if (detail.state === 'evicted') return <div className={styles.empty}>{t('trajectoryDetailEvicted')}</div>
  if (detail.section === 'diff' && isRecord(detail.content)) return <PromptDiff content={detail.content} />
  const warning = detail.truncated || detail.warning
    ? <div className={styles.warning}>{detail.warning || t('trajectoryDetailTruncated')}</div>
    : null
  if (detail.section === 'raw') {
    return <div className={styles.sectionPayload}>{warning}<TrajectoryRawBlocks content={detail.content} threadId={threadId} onSelectToolCall={onSelectToolCall} />{attachmentIds.length ? <div className={styles.rawImages}><TrajectoryImages threadId={threadId} ids={attachmentIds} /></div> : null}</div>
  }
  if (detail.section === 'source') {
    return <div className={styles.sectionPayload}>{warning}<TrajectoryMessageSource content={detail.content} /></div>
  }
  const markdown = markdownText(detail.content)
  return (
    <div className={styles.payload}>
      {warning}
      {detail.section === 'rendered' && markdown !== null
        ? <StreamdownAssistant text={markdown} streaming={false} className={styles.markdown} />
        : <TrajectoryJsonTree value={detail.content} />}
      {attachmentIds.length ? <TrajectoryImages threadId={threadId} ids={attachmentIds} /> : null}
    </div>
  )
}

function PromptDiff({ content }: { content: Record<string, unknown> }): ReactElement {
  const previous = JSON.stringify(content.previous ?? [], null, 2)
  const current = JSON.stringify(content.current ?? [], null, 2)
  return <pre className={styles.diff}>{diffLines(previous, current).map((part, index) => <span key={index} data-change={part.added ? 'added' : part.removed ? 'removed' : 'context'}>{part.value}</span>)}</pre>
}

function TrajectoryImages({ threadId, ids }: { threadId: string; ids: readonly string[] }): ReactElement {
  const [images, setImages] = useState<Array<{ id: string; url: string; name: string }>>([])
  useEffect(() => {
    let cancelled = false
    void Promise.all(ids.map(async (id) => {
      const response = await rendererRuntimeClient.runtimeRequest(`${kunAttachmentContentPath(id)}?thread_id=${encodeURIComponent(threadId)}`, 'GET')
      if (!response.ok) return null
      const body = JSON.parse(response.body) as { dataBase64?: string; attachment?: { mimeType?: string; name?: string } }
      return body.dataBase64 ? { id, url: `data:${body.attachment?.mimeType ?? 'application/octet-stream'};base64,${body.dataBase64}`, name: body.attachment?.name ?? id } : null
    })).then((values) => { if (!cancelled) setImages(values.filter((value): value is NonNullable<typeof value> => value !== null)) })
    return () => { cancelled = true }
  }, [ids, threadId])
  return <div className={styles.images}>{images.map((image) => <img key={image.id} src={image.url} alt={image.name} />)}</div>
}

function tabsFor(cell: HarnessCell | null, request: HarnessRequestBoundary | null, t: (key: string) => string): Tab[] {
  if (request) return [{ id: 'overview', label: t('trajectoryTabSummary') }, ...(request.request.optionsAvailable ? [{ id: 'options' as const, label: t('trajectoryTabOptions') }] : []), { id: 'usage', label: t('trajectorySection_usage') }, { id: 'timing', label: t('trajectorySection_timing') }]
  if (!cell) return []
  if (cell.kind === 'system') return [...(cell.record.kind === 'system' && cell.record.previousPromptFingerprint ? [{ id: 'diff' as const, label: t('trajectoryTabDiff') }] : []), { id: 'system-prompt', label: t('trajectoryTabSystemPrompt') }, { id: 'tools', label: t('trajectoryTabTools') }]
  if (cell.kind === 'tool' || cell.kind === 'subtool') return [{ id: 'overview', label: t('trajectoryTabSummary') }, { id: 'arguments', label: t('trajectoryTabPayload') }, { id: 'result', label: t('trajectorySection_result') }, { id: 'schema', label: t('trajectoryTabSchema') }, { id: 'timing', label: t('trajectorySection_timing') }]
  if (cell.kind === 'compacted') return [{ id: 'overview', label: t('trajectoryTabSummary') }, { id: 'raw', label: t('trajectoryTabRawOutput') }]
  const markdown = [{ id: 'overview' as const, label: t('trajectoryTabSummary') }, { id: 'rendered' as const, label: t('trajectoryTabPreview') }, { id: 'raw' as const, label: t('trajectorySection_raw') }]
  const sourceAvailable = cell.kind === 'user' || cell.kind === 'context'
    ? ('sourceAvailable' in cell.record ? cell.record.sourceAvailable ?? true : true)
    : false
  return sourceAvailable ? [...markdown, { id: 'source', label: t('trajectoryTabSource') }] : markdown
}

function markdownText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((entry) => isRecord(entry) && typeof entry.text === 'string' ? entry.text : '').filter(Boolean).join('\n') || null
  return null
}
function cacheDetail(current: Map<string, TrajectoryDetail>, key: string, value: TrajectoryDetail): Map<string, TrajectoryDetail> {
  const next = new Map(current)
  next.delete(key)
  next.set(key, value)
  while (next.size > 64) {
    const oldest = next.keys().next().value as string | undefined
    if (!oldest) break
    next.delete(oldest)
  }
  return next
}
function clampWidth(width: number, splitWidth: number): number { return Math.round(Math.min(720, Math.max(320, Math.min(width, splitWidth - 280)))) }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
