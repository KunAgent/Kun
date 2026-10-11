import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaperResearchDraft } from '../../../paper/paper-mode-store'
import type { PaperResearchRequest } from '../../../paper/paper-research-actions'
import type { AgentHistorySession } from '../../../paper/paper-research-sessions'
import type { PaperSearchHistoryEntry } from '../../../paper/paper-search-prefs'
import { parseSearchYear, readSearchSources, writeSearchSources } from '../../../paper/paper-search-prefs'
import type { WriteAssistantStageProps } from '../../write/WriteAssistantStageContext'
import { PaperSearchTabs } from '../discover/PaperSearchScope'
import { PaperResearchComposer } from './PaperResearchComposer'
import { PaperResearchRecent } from './PaperResearchRecent'
import { PaperScopePill, type PaperResearchScope } from './PaperResearchScopeChips'

/**
 * "New research" screen: a hero line, the Agent / quick tabs, one search box
 * with a single scope pill, and the recent searches underneath. Sending
 * starts a dedicated research conversation with the box's text.
 */
export function PaperResearchEmpty({
  assistant,
  draft,
  starting,
  onStart,
  onShowDirect,
  sessions,
  quickHistory,
  onOpenSession,
  onRunQuick
}: {
  assistant: WriteAssistantStageProps
  draft: PaperResearchDraft | null
  starting: boolean
  onStart: (request: PaperResearchRequest) => void
  onShowDirect: () => void
  sessions: readonly AgentHistorySession[]
  quickHistory: readonly PaperSearchHistoryEntry[]
  onOpenSession: (session: AgentHistorySession) => void
  onRunQuick: (entry: PaperSearchHistoryEntry) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [text, setText] = useState(draft?.query ?? '')
  const [scope, setScope] = useState<PaperResearchScope>(() => ({
    depth: 'standard',
    sources: draft?.sources.length ? [...draft.sources] : readSearchSources(),
    yearFrom: draft?.yearFrom ? String(draft.yearFrom) : '',
    yearTo: draft?.yearTo ? String(draft.yearTo) : ''
  }))
  const seededDraft = useRef<PaperResearchDraft | null>(draft)

  // A hand-off from quick search pre-fills the box once.
  useEffect(() => {
    if (!draft || seededDraft.current === draft) return
    seededDraft.current = draft
    if (draft.query) setText(draft.query)
  }, [draft])

  const updateScope = (next: PaperResearchScope): void => {
    setScope(next)
    if (next.sources !== scope.sources) writeSearchSources(next.sources)
  }

  const send = (): void => {
    const query = text.trim()
    if (!query || starting) return
    onStart({
      query,
      sources: scope.sources,
      yearFrom: parseSearchYear(scope.yearFrom),
      yearTo: parseSearchYear(scope.yearTo),
      depth: scope.depth
    })
  }

  return (
    <div data-testid="paper-research-empty" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-6 pb-10 pt-[min(15vh,132px)]">
        <h1 className="text-center text-[24px] font-medium leading-tight tracking-[-0.025em] text-ds-ink sm:text-[28px]">
          {t('paperResearchHeroTitle')}
        </h1>
        <p className="mx-auto mt-2.5 max-w-[640px] text-balance text-center text-[13px] leading-6 text-ds-muted">{t('paperResearchEmptySub')}</p>
        <div className="mt-7">
          <PaperSearchTabs tab="agent" onChange={(tab) => tab === 'direct' && onShowDirect()} />
          <div className="mt-1.5">
            <PaperResearchComposer
              value={text}
              onChange={setText}
              onSubmit={send}
              busy={starting}
              placeholder={t('paperResearchQuestionPlaceholder')}
              assistant={assistant}
              scope={<PaperScopePill scope={scope} onChange={updateScope} />}
            />
          </div>
        </div>
        <div className="mt-12">
          <PaperResearchRecent sessions={sessions} quick={quickHistory} onOpenSession={onOpenSession} onRunQuick={onRunQuick} />
        </div>
      </div>
    </div>
  )
}
