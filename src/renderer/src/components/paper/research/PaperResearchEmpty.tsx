import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaperResearchDraft } from '../../../paper/paper-mode-store'
import type { PaperResearchRequest } from '../../../paper/paper-research-actions'
import { parseSearchYear, readSearchSources, writeSearchSources } from '../../../paper/paper-search-prefs'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { FloatingComposer } from '../../chat/FloatingComposer'
import type { WriteAssistantStageProps } from '../../write/WriteAssistantStageContext'
import { PaperResearchScopeChips, type PaperResearchScope } from './PaperResearchScopeChips'

const EXAMPLE_KEYS = ['paperResearchExample1', 'paperResearchExample2', 'paperResearchExample3']

/**
 * "New research" screen, laid out like the Code home: a hero line, the
 * scope chips (depth, sources, years) and the real Work composer. Sending
 * starts a dedicated research conversation with the composer text.
 */
export function PaperResearchEmpty({
  assistant,
  draft,
  starting,
  onStart
}: {
  assistant: WriteAssistantStageProps
  draft: PaperResearchDraft | null
  starting: boolean
  onStart: (request: PaperResearchRequest) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const [scope, setScope] = useState<PaperResearchScope>(() => ({
    depth: 'standard',
    sources: draft?.sources.length ? [...draft.sources] : readSearchSources(),
    yearFrom: draft?.yearFrom ? String(draft.yearFrom) : '',
    yearTo: draft?.yearTo ? String(draft.yearTo) : ''
  }))
  const seededDraft = useRef<PaperResearchDraft | null>(null)

  // A hand-off from direct search pre-fills the composer once.
  useEffect(() => {
    if (!draft || seededDraft.current === draft) return
    seededDraft.current = draft
    if (draft.query) assistant.setInput(draft.query)
  }, [draft, assistant])

  const updateScope = (next: PaperResearchScope): void => {
    setScope(next)
    if (next.sources !== scope.sources) writeSearchSources(next.sources)
  }

  const send = (): void => {
    const query = assistant.input.trim()
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
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center px-6 pb-[8vh] pt-10">
        <div className="text-center">
          <h1 className="text-[24px] font-medium leading-tight tracking-[-0.025em] text-ds-ink sm:text-[28px]">
            {t('paperResearchHeroTitle')}
          </h1>
          <p className="mx-auto mt-3 max-w-[600px] text-[13px] leading-6 text-ds-muted">{t('paperResearchEmptySub')}</p>
        </div>
        <div className="mt-7">
          <div className="mb-1.5 px-1">
            <PaperResearchScopeChips scope={scope} onChange={updateScope} />
          </div>
          <FloatingComposer
            emptyTaskLayout
            placeholderOverride={t('paperResearchQuestionPlaceholder')}
            workspaceRootOverride={workspaceRoot}
            input={assistant.input}
            setInput={assistant.setInput}
            mode={assistant.mode}
            setMode={assistant.setMode}
            busy={starting}
            runtimeReady={assistant.runtimeConnection === 'ready'}
            hasActiveThread={false}
            composerModel={assistant.composerModel}
            composerProviderId={assistant.composerProviderId}
            composerPickList={assistant.composerPickList}
            composerModelGroups={assistant.composerModelGroups}
            skillCommands={assistant.skillCommands}
            disabledSkillIds={assistant.disabledSkillIds}
            composerReasoningEffort={assistant.composerReasoningEffort}
            composerFastMode={assistant.composerFastMode}
            onComposerModelChange={assistant.setComposerModel}
            onComposerReasoningEffortChange={assistant.setComposerReasoningEffort}
            onComposerFastModeChange={assistant.setComposerFastMode}
            modelPickerMode="combobox"
            modelControlVariant="split"
            showProviderInModelLabel
            queuedMessages={[]}
            onRemoveQueuedMessage={() => undefined}
            onGuideQueuedMessage={() => undefined}
            onSend={send}
            onInterrupt={() => undefined}
            onConfigureProviders={assistant.onConfigureProviders}
          />
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-1.5">
          {EXAMPLE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              data-paper-research-example
              disabled={starting}
              onClick={() => assistant.setInput(t(key))}
              className="rounded-full border border-ds-border-muted px-3 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
