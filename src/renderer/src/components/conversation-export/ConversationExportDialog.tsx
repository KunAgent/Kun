import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getProvider } from '../../agent/registry'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import type { ConversationExportInclude } from '../../lib/conversation-export'
import { ConversationExportList } from './ConversationExportList'
import { ConversationExportOptions } from './ConversationExportOptions'
import { ConversationExportStatus } from './ConversationExportStatus'
import {
  filterExportThreads,
  isExportableThread,
  loadExportPrefs,
  localDateToken,
  saveExportPrefs,
  type ExportPrefs,
  type ExportScope
} from './conversation-export-model'
import {
  runConversationExport,
  type ExportOutcome,
  type ExportProgress
} from './conversation-export-run'
import { useConversationExportLabels } from './use-conversation-export-labels'

type Phase = 'configure' | 'running' | 'result'

export function ConversationExportDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const labels = useConversationExportLabels()
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const threads = useChatStore((state) => state.threads)
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const activeWorkspace = useChatStore((state) => state.workspaceRoot)
  const blocks = useChatStore((state) => state.blocks)
  const busy = useChatStore((state) => state.busy)
  const currentTurnId = useChatStore((state) => state.currentTurnId)
  const currentTurnUserId = useChatStore((state) => state.currentTurnUserId)

  const [prefs, setPrefs] = useState<ExportPrefs>(loadExportPrefs)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ExportScope>('all')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [archived, setArchived] = useState<NormalizedThread[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(activeThreadId ? [activeThreadId] : [])
  )
  const [phase, setPhase] = useState<Phase>('configure')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    const dialog = dialogRef.current
    const focused = document.activeElement as HTMLElement | null
    dialog?.showModal()
    return () => {
      abortRef.current?.abort()
      dialog?.close()
      if (focused?.isConnected) focused.focus()
    }
  }, [])

  useEffect(() => {
    if (!includeArchived || archived.length > 0) return
    let canceled = false
    void getProvider().listThreads({ includeArchived: true, archivedOnly: true })
      .then((list) => { if (!canceled) setArchived(list) })
      .catch(() => undefined)
    return () => { canceled = true }
  }, [archived.length, includeArchived])

  const inventory = useMemo(() => {
    const byId = new Map<string, NormalizedThread>()
    for (const thread of [...threads, ...archived]) byId.set(thread.id, thread)
    return [...byId.values()].filter(isExportableThread)
  }, [archived, threads])
  const visible = useMemo(() => filterExportThreads({
    threads: inventory, query, scope, activeWorkspace, includeArchived, now
  }), [activeWorkspace, includeArchived, inventory, now, query, scope])
  // Selection survives filtering; only still-known conversations are exported.
  const chosen = useMemo(
    () => inventory.filter((thread) => selected.has(thread.id)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [inventory, selected]
  )
  const hasRunning = chosen.some((thread) => thread.status === 'running' || thread.latestTurnStatus === 'running')
  const running = phase === 'running'

  const updatePrefs = (patch: Partial<ExportPrefs>): void => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    saveExportPrefs(next)
  }
  const toggle = (id: string): void => setSelected((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const toggleAll = (checked: boolean): void => setSelected((current) => {
    const next = new Set(current)
    for (const thread of visible) {
      if (checked) next.add(thread.id)
      else next.delete(thread.id)
    }
    return next
  })

  const today = localDateToken(new Date())
  const folderName = t('exportDialogFolderName', { date: today })
  const mergedName = t('exportDialogMergedName', { date: today })

  const start = async (): Promise<void> => {
    if (chosen.length === 0 || running) return
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('running')
    setProgress({ index: 0, total: chosen.length, doneIds: [], failedIds: [], currentId: chosen[0]?.id ?? null })
    const result = await runConversationExport({
      threads: chosen,
      active: { threadId: activeThreadId, blocks, busy, currentTurnId, currentTurnUserId },
      format: prefs.format,
      layout: prefs.layout,
      include: prefs.include,
      labels,
      locale: i18n.language,
      mergedTitle: mergedName,
      folderName,
      contentsLabel: t('exportDialogContents'),
      signal: controller.signal,
      onProgress: setProgress
    })
    abortRef.current = null
    if (result.kind === 'canceled') {
      setPhase('configure')
      return
    }
    setOutcome(result)
    setPhase('result')
  }

  const stop = (): void => abortRef.current?.abort()
  const summary = chosen.length === 0
    ? t('exportDialogSummaryEmpty')
    : t('exportDialogSummary', { count: chosen.length })
  const ctaLabel = chosen.length === 0
    ? t('exportDialogExport')
    : t('exportDialogExportCount', { count: chosen.length })

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="conversation-export-title"
      onCancel={(event) => {
        event.preventDefault()
        if (running) stop()
        else closeRef.current()
      }}
      className="m-auto h-[min(660px,calc(100vh-48px))] w-[min(920px,calc(100vw-48px))] overflow-hidden rounded-[18px] border border-ds-border bg-ds-card p-0 text-ds-ink shadow-[0_24px_64px_rgba(20,47,95,0.18)] backdrop:bg-black/30 dark:shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-ds-border py-[18px] pl-6 pr-5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="conversation-export-title" className="m-0 text-base font-semibold">{t('exportDialogTitle')}</h2>
            <span className="text-[12.5px] text-ds-muted" aria-live="polite">{summary}</span>
          </div>
          <button
            type="button"
            aria-label={t('exportDialogClose')}
            onClick={() => (running ? stop() : onClose())}
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        {phase === 'result' && outcome ? (
          <ConversationExportStatus
            outcome={outcome}
            onRetry={() => { setOutcome(null); setPhase('configure') }}
            onDone={onClose}
          />
        ) : (
          <>
            <div className="flex min-h-0 flex-1">
              <ConversationExportList
                threads={visible}
                selected={selected}
                activeThreadId={activeThreadId}
                query={query}
                scope={scope}
                includeArchived={includeArchived}
                disabled={running}
                now={now}
                onQuery={setQuery}
                onScope={setScope}
                onIncludeArchived={setIncludeArchived}
                onToggle={toggle}
                onToggleAll={toggleAll}
                onClear={() => setSelected(new Set())}
              />
              {running && progress ? (
                <ConversationExportStatus progress={progress} chosen={chosen} onStop={stop} />
              ) : (
                <ConversationExportOptions
                  format={prefs.format}
                  layout={prefs.layout}
                  include={prefs.include}
                  selectedTitles={chosen.map((thread) => thread.title)}
                  disabled={running}
                  folderName={folderName}
                  mergedName={mergedName}
                  onFormat={(format) => updatePrefs({ format })}
                  onLayout={(layout) => updatePrefs({ layout })}
                  onInclude={(key: keyof ConversationExportInclude, value) =>
                    updatePrefs({ include: { ...prefs.include, [key]: value } })}
                />
              )}
            </div>
            <footer className="flex shrink-0 items-center gap-3 border-t border-ds-border py-3 pl-6 pr-5">
              <span className={`min-w-0 truncate text-xs ${hasRunning ? 'text-ds-status-warning' : 'text-ds-muted'}`}>
                {hasRunning ? t('exportDialogRunningNote') : t('exportDialogSaveNote')}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => (running ? stop() : onClose())}
                className="h-[34px] rounded-[9px] border border-ds-border bg-ds-card px-3.5 text-[13px] text-ds-ink transition hover:bg-ds-hover"
              >
                {running ? t('exportDialogStop') : t('exportDialogCancel')}
              </button>
              <button
                type="button"
                disabled={chosen.length === 0 || running}
                onClick={() => void start()}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] bg-ds-ink px-4 text-[13px] font-semibold text-ds-card transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-ds-subtle disabled:text-ds-faint"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                {ctaLabel}
              </button>
            </footer>
          </>
        )}
      </div>
    </dialog>,
    document.body
  )
}
