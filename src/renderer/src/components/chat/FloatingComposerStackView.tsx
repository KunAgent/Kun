import type { ReactElement } from 'react'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'

export function FloatingComposerStackView({
  context
}: {
  context: FloatingComposerRenderContext
}): ReactElement {
  const {
    BackgroundShellOverlay, FloatingComposerAboveInputStack, FloatingComposerActionMenu,
    FloatingComposerFileMentionMenu, FloatingComposerGraphProgress, FloatingComposerQueuedMessages,
    FloatingComposerSlashCommandMenu, FloatingComposerTodoProgress, FloatingComposerUserInputPanel,
    PauseCircle, Pencil, PlayCircle, Target, Trash2, X, activeThreadGoal, activeThreadId, activeThreadTodos, applySlashCommand,
    busy, canOpenGoalPanel, canSetGoalPanelDraft, clearActiveThreadGoal, compact, composerMenuOpen,
    currentTurnOrchestration, draft, fileMentions, filteredSlashCommands, goalBannerLabel,
    goalElapsedLabel, goalPanelOpen, goalPanelRef, graphEnabled, highlightedSlashCommand,
    onGuideQueuedMessage, onOpenGraph, onOpenGraphChild, onRemoveQueuedMessage, pendingUserInputBlock,
    queuedMessages, reorderQueuedMessage, returnQueuedMessageToComposer, runtimeReady,
    setActiveThreadGoalStatus, setGoalFromComposerInput, setGoalPanelOpen, setInput,
    showGoalFloater, showGoalMenuOption, showGraphProgress, showTodoProgress, slashCommandMenu,
    slashQuery, t, userInput
  } = context
  return (
    <>
      <FloatingComposerAboveInputStack
        floatingStatuses={(
          <>
            {showTodoProgress && activeThreadTodos ? (
              <FloatingComposerTodoProgress todos={activeThreadTodos} enabled={showGraphProgress} />
            ) : null}
            <FloatingComposerGraphProgress
              threadId={activeThreadId}
              enabled={showGraphProgress}
              onOpenGraph={onOpenGraph}
              onOpenChild={onOpenGraphChild}
            />
            {showGoalFloater && activeThreadGoal && !pendingUserInputBlock ? (
              <div
                data-composer-stack-item="goal"
                className="ds-composer-status-glass pointer-events-auto flex min-h-11 w-full max-w-[46rem] items-center gap-2 rounded-full border px-3 py-1.5 text-ds-muted"
              >
                <Target className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
                <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] leading-5">
                  <span className="shrink-0 font-semibold text-ds-ink">
                    {goalBannerLabel}
                  </span>
                  <span className="min-w-0 truncate text-ds-muted">
                    {activeThreadGoal.objective}
                  </span>
                  <span className="shrink-0 text-ds-faint">
                    · {goalElapsedLabel}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setGoalPanelOpen(true)
                      draft.focusComposer()
                    }}
                    className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                    aria-label={t('goalActionEdit')}
                    title={t('goalActionEdit')}
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void setActiveThreadGoalStatus(activeThreadGoal.status === 'active' ? 'paused' : 'active')
                    }}
                    className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                    aria-label={activeThreadGoal.status === 'active' ? t('goalActionPause') : t('goalActionResume')}
                    title={activeThreadGoal.status === 'active' ? t('goalActionPause') : t('goalActionResume')}
                  >
                    {activeThreadGoal.status === 'active' ? (
                      <PauseCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
                    ) : (
                      <PlayCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void clearActiveThreadGoal()
                    }}
                    className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                    aria-label={t('goalActionClear')}
                    title={t('goalActionClear')}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
        flowPanels={(
          <>
            {runtimeReady ? <BackgroundShellOverlay threadId={activeThreadId} /> : null}
            <FloatingComposerQueuedMessages
              messages={queuedMessages}
              guidanceTarget={currentTurnOrchestration === 'graph' ? 'graph' : 'turn'}
              onRemove={onRemoveQueuedMessage}
              onGuide={onGuideQueuedMessage}
              onReorder={reorderQueuedMessage}
              onEdit={(message: QueuedComposerMessage) => {
                returnQueuedMessageToComposer(message, onRemoveQueuedMessage, setInput)
                draft.focusComposer()
              }}
            />
            {userInput.active ? (
              <FloatingComposerUserInputPanel
                controller={userInput}
                t={t}
                variant={compact ? 'compact' : 'main'}
              />
            ) : null}
          </>
        )}
      />

        {composerMenuOpen && slashQuery == null ? (
          <FloatingComposerActionMenu context={context} />
        ) : null}

        {slashQuery != null ? (
          <FloatingComposerSlashCommandMenu
            commands={filteredSlashCommands}
            highlighted={highlightedSlashCommand}
            selectedIndex={slashCommandMenu.selectedIndex}
            onSelect={applySlashCommand}
          />
        ) : null}

        {fileMentions.showMenu ? (
          <FloatingComposerFileMentionMenu
            suggestions={fileMentions.suggestions}
            loading={fileMentions.loading}
            selectedIndex={fileMentions.selectedIndex}
            highlighted={fileMentions.highlighted}
            hasMountedKnowledgeBases={fileMentions.hasMountedKnowledgeBases}
            onSelect={fileMentions.applySuggestion}
          />
        ) : null}

        {showGoalMenuOption && goalPanelOpen && slashQuery == null && !pendingUserInputBlock ? (
          <div
            ref={goalPanelRef}
            className="absolute inset-x-2 bottom-full z-30 mb-3 overflow-hidden rounded-[26px] border border-ds-border bg-white p-3 shadow-[0_18px_52px_rgba(20,47,95,0.14)] backdrop-blur-xl dark:bg-ds-card"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ds-border-muted text-ds-muted">
                <Target className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-[14px] font-semibold text-ds-ink">
                    {activeThreadGoal ? activeThreadGoal.objective : t('goalNoActiveTitle')}
                  </div>
                  {activeThreadGoal ? (
                    <span className="shrink-0 rounded-lg border border-ds-border-muted bg-ds-card px-2 py-0.5 text-[11px] font-semibold text-ds-muted">
                      {t(`goalStatusShort.${activeThreadGoal.status}`)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canSetGoalPanelDraft ? (
                    <button
                      type="button"
                      onClick={setGoalFromComposerInput}
                      className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                    >
                      {t('goalSetCurrentInput')}
                    </button>
                  ) : null}
                  {activeThreadGoal?.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void setActiveThreadGoalStatus('paused')
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionPause')}
                      title={t('goalActionPause')}
                    >
                      <PauseCircle className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : activeThreadGoal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void setActiveThreadGoalStatus('active')
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionResume')}
                      title={t('goalActionResume')}
                    >
                      <PlayCircle className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : null}
                  {activeThreadGoal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void clearActiveThreadGoal()
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionClear')}
                      title={t('goalActionClear')}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGoalPanelOpen(false)}
                className="rounded-lg p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('close')}
                title={t('close')}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        ) : null}

    </>
  )
}
