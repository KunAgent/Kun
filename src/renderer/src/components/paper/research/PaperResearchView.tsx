import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Archive, Layers, Loader2, Plus, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock } from '../../../agent/types'
import { useChatStore } from '../../../store/chat-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperStore } from '../../../write/paper/paper-store'
import { buildResearchPool } from '../../../paper/paper-research-pool'
import {
  listResearchSessions,
  listResearchSessionsAcrossLibraries,
  researchResourcePath,
  type AgentHistorySession
} from '../../../paper/paper-research-sessions'
import {
  openPaperResearchSession,
  selectPaperResearchSession,
  startPaperResearch,
  type PaperResearchRequest
} from '../../../paper/paper-research-actions'
import { readSearchHistory, readSearchSources, type PaperSearchHistoryEntry } from '../../../paper/paper-search-prefs'
import { paperResearchStageActive } from '../../../paper/paper-view'
import { useWriteAssistantStage } from '../../write/WriteAssistantStageContext'
import { usePaperSearchRail } from '../discover/use-paper-search-rail'
import layout from '../discover/PaperSearchLayout.module.css'
import { PaperResearchEmpty } from './PaperResearchEmpty'
import { PaperResearchPool } from './PaperResearchPool'
import { PaperResearchStage } from './PaperResearchStage'

const NO_BLOCKS: ChatBlock[] = []

function useElapsed(since: string | undefined, running: boolean): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const start = since ? Date.parse(since) : NaN
  if (!running || Number.isNaN(start)) return ''
  const seconds = Math.max(0, Math.floor((now - start) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Agent research page. With no session open it is the home screen (search
 * box + recent searches); with a session it is the conversation in the
 * center and the paper pool on the right. There is no separate history
 * column: sessions are conversations in the sidebar, and the home screen
 * lists the recent ones.
 */
export function PaperResearchView({ onShowDirect }: { onShowDirect: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const assistant = useWriteAssistantStage()
  const libraryRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const libraries = useWriteWorkspaceStore((s) => s.paperMode.libraries)
  const sessionId = useWriteWorkspaceStore((s) => s.paperResearch.sessionId)
  const threads = useChatStore((s) => s.threads)
  const draft = usePaperModeStore((s) => s.discover.researchDraft)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { railOpen, narrow, railRef, toggleRail, closeRail } = usePaperSearchRail(rootRef)
  const [starting, setStarting] = useState(false)
  const [quickHistory] = useState<PaperSearchHistoryEntry[]>(readSearchHistory)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const sessions = useMemo(() => listResearchSessions(libraryRoot, threads), [libraryRoot, threads])
  const history = useMemo(
    () => listResearchSessionsAcrossLibraries([...libraries, libraryRoot], threads),
    [libraries, libraryRoot, threads]
  )
  const activeSession = sessions.find((session) => session.sessionId === sessionId) ?? null
  const bound = Boolean(activeSession && assistant && assistant.activeThreadId === activeSession.threadId)
  const blocks = bound && assistant ? assistant.blocks : NO_BLOCKS
  const pool = useMemo(() => buildResearchPool(blocks), [blocks])
  const running = bound && Boolean(assistant?.busy)
  const lastUserAt = [...blocks].reverse().find((block) => block.kind === 'user')?.createdAt
  const elapsed = useElapsed(lastUserAt, running)

  // A research run is a session: the Work runtime makes the selected run the
  // current session within a tick; if selection lags, select it directly.
  // Opening the page never picks a run by itself — the user does.
  useEffect(() => {
    if (!activeSession || bound) return
    const timer = setTimeout(() => {
      if (!paperResearchStageActive(useWriteWorkspaceStore.getState())) return
      void useChatStore.getState().selectWriteThread(
        activeSession.threadId,
        libraryRoot,
        researchResourcePath(libraryRoot, activeSession.sessionId)
      )
    }, 1500)
    return () => clearTimeout(timer)
  }, [activeSession, bound, libraryRoot])

  const start = (request: PaperResearchRequest): void => {
    setStarting(true)
    void startPaperResearch(request).then((result) => {
      setStarting(false)
      if (result.ok) {
        usePaperModeStore.getState().patchDiscover({ researchDraft: null })
        return
      }
      if (result.reason !== 'empty') {
        usePaperStore.getState().setNotice({ tone: 'error', message: t(`paperResearchStartFailed_${result.reason}`) })
      }
    })
  }

  const archiveSession = (): void => {
    if (!activeSession) return
    void useChatStore.getState().archiveThread(activeSession.threadId, true)
      .then(() => selectPaperResearchSession(null))
      .catch(() => undefined)
  }

  const focusBlock = (blockId: string): void => {
    const target = stageRef.current?.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const openSession = (session: AgentHistorySession): void => {
    void openPaperResearchSession({ libraryRoot: session.libraryRoot, sessionId: session.sessionId }, t)
  }

  const runQuick = (entry: PaperSearchHistoryEntry): void => {
    usePaperModeStore.getState().patchDiscover({
      quickRun: {
        query: entry.query,
        sources: entry.sources?.length ? entry.sources : readSearchSources(),
        yearFrom: entry.yearFrom,
        yearTo: entry.yearTo
      }
    })
    onShowDirect()
  }

  const showPool = Boolean(activeSession) && railOpen
  const headerButton = 'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink'

  return (
    <div ref={rootRef} data-paper-search="agent" className={layout.surface}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-ds-border-muted px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-[12.5px] text-ds-faint">{t('workSidebarDiscover')}</span>
          {activeSession ? (
            <>
              <span aria-hidden="true" className="text-ds-faint">›</span>
              <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink" title={activeSession.title}>
                {activeSession.title}
              </span>
              {running ? (
                <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--ds-accent-soft)] px-2 text-[11.5px] text-[var(--ds-accent)]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('paperResearchStatusRunning')}
                  {elapsed ? <span className="tabular-nums opacity-70">{elapsed}</span> : null}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        {running ? (
          <button type="button" onClick={() => assistant?.onInterrupt()} className={`${headerButton} px-2`}>
            <Square className="h-3 w-3" strokeWidth={2.2} />
            {t('paperResearchStop')}
          </button>
        ) : null}
        {activeSession ? (
          <>
            <button
              type="button"
              onClick={() => selectPaperResearchSession(null)}
              aria-label={t('paperResearchNew')}
              title={t('paperResearchNew')}
              className={`${headerButton} w-7`}
            >
              <Plus className="h-4 w-4" strokeWidth={1.8} />
            </button>
            {!running ? (
              <button
                type="button"
                onClick={archiveSession}
                aria-label={t('paperResearchArchive')}
                title={t('paperResearchArchive')}
                className={`${headerButton} w-7`}
              >
                <Archive className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={toggleRail}
              aria-pressed={railOpen}
              aria-label={t('paperResearchPoolTitle')}
              title={t('paperResearchPoolTitle')}
              className={`${headerButton} px-1.5 ${railOpen ? 'bg-accent-tint/15 text-accent' : ''}`}
            >
              <Layers className="h-4 w-4" strokeWidth={1.8} />
              {pool.entries.length ? <span className="text-[11px] tabular-nums">{pool.entries.length}</span> : null}
            </button>
          </>
        ) : null}
      </header>

      <div className={layout.body} data-rail={showPool ? 'open' : 'closed'}>
        <div ref={stageRef} className={`${layout.stage} flex flex-col`}>
          {!assistant ? (
            <div className="m-auto flex items-center gap-2 text-[12.5px] text-ds-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('paperResearchLoading')}
            </div>
          ) : !activeSession ? (
            <PaperResearchEmpty
              assistant={assistant}
              draft={draft}
              starting={starting}
              onStart={start}
              onShowDirect={onShowDirect}
              sessions={history}
              quickHistory={quickHistory}
              onOpenSession={openSession}
              onRunQuick={runQuick}
            />
          ) : !bound ? (
            <div className="m-auto flex items-center gap-2 text-[12.5px] text-ds-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('paperResearchLoading')}
            </div>
          ) : (
            <PaperResearchStage assistant={assistant} newCountByBlock={pool.newCountByBlock} />
          )}
        </div>
        {showPool && activeSession ? (
          <aside ref={railRef} className={layout.rail} data-overlay={narrow ? 'true' : 'false'}>
            <PaperResearchPool
              pool={pool}
              scope={activeSession.threadId}
              topic={activeSession.title}
              running={running}
              onFocusBlock={focusBlock}
              onClose={closeRail}
            />
          </aside>
        ) : null}
      </div>
    </div>
  )
}
