import type { ReactElement } from 'react'
import type { ComposerFileReference } from '../../lib/composer-file-references'
import { ComposerInlineError } from './ComposerInlineError'
import { FloatingComposerFooterView } from './FloatingComposerFooterView'
import { FloatingComposerContextChips } from './FloatingComposerContextChips'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'
import { KnowledgeBasePicker } from './KnowledgeBasePicker'
import { composerAgentPickerSurface } from '../../lib/subagent-profile-surface'

export function FloatingComposerSurfaceView({
  context
}: {
  context: FloatingComposerRenderContext
}): ReactElement {
  const {
    FileText, FloatingComposerAgentPicker, FloatingComposerAttachments,
    FloatingComposerContextCapacity, FloatingComposerExecutionPicker, FloatingComposerModelPicker,
    FloatingComposerTaskProfile, FloatingComposerTaskSurfacePicker,
    Bot, Folder, GitBranchPicker, ListTodo, Loader2, Mic, Plus, Send, Share2, Sparkles,
    Square, Target, VoiceRecordingStrip, WorkspaceProjectPicker, X, activeThreadGoal,
    activeThreadId, attachmentUploadEnabled, attachmentUploadError, attachments, busy,
    canChangeModel, canCompose, canEditComposer, canOpenComposerMenu, canOptimizePrompt,
    canToggleWorktreeMode, compact, composerFastMode, composerMenuButtonRef, composerMenuOpen, composerShellRef,
    composerModel, composerModelGroups, composerPickList, composerProviderId,
    composerReasoningEffort, contextChips, designTaskProfile, designProfileLocked, dictation, draft, effectiveWorkspaceRoot,
    executionSettings, executionSettingsApplying, fileInputRef, fileMentions, fileReferences,
    goalInputMode, graphEnabled, graphPlanningNeedsCorrection, handleAttachmentInput,
    handleComposerDragOver, handleComposerDrop, handleComposerKeyDown, handleComposerMenuButtonClick,
    handleComposerPaste, handleComposerShellMouseDown, handleAutoPlanBuildToolbarClick, handlePlanToolbarClick, handlePrimaryAction,
    handlePromptOptimizationClick, hideModelPicker, input, isComposerDirectoryReference, mode,
    imageGenerationEnabled, imageGenerationAvailable, imageGenerationReason, modelControlVariant, modelPickerMode, onComposerFastModeChange, onComposerModelChange,
    onComposerReasoningEffortChange, onConfigureImageGeneration, onConfigureProviders, onDesignTaskProfileChange, onExecutionSettingsChange, onInterrupt,
    onRemoveAttachment, onRemoveContextChip, onRemoveFileReference, onDismissPromptOptimizationError, onToggleWorktreeMode,
    onWorktreeBranchChange, openSettings, orchestration, placeholder, primaryActionDisabled,
    primaryActionKind, primaryActionLabel, primaryActionLoading, promptOptimizationBusy, promptOptimizationError,
    promptOptimizationSettings, route, runningGraphTurn, runtimeReady, setGoalInputMode, showComposerMenuButton,
    showCodeExecutionControls, showExecutionSettingsPicker, showProviderInModelLabel, showToolbarStartControls,
    showVoiceDictation, showWorkspaceControls, side, stretchModelPicker, t, useWorktreePool,
    taskSurface, taskSurfaceLocked, emptyTaskLayout, onTaskSurfaceChange, onNewRequirement,
    worktreeBranch
  } = context
  const documentQuoteAttached = contextChips.some((chip: { kind: string }) => chip.kind === 'document-quote')
  return (
    <>
        {!compact && !emptyTaskLayout && taskSurface === 'design' && designTaskProfile ? (
          <div className="ds-composer-task-controls ds-no-drag flex min-h-9 min-w-0 flex-wrap items-center gap-2 px-3 pb-1">
            <FloatingComposerTaskProfile
              surface="design"
              locked={taskSurfaceLocked === true}
              profileLocked={designProfileLocked === true}
              disabled={!canCompose || busy}
              profile={designTaskProfile}
              imageGenerationEnabled={imageGenerationEnabled}
              imageGenerationAvailable={imageGenerationAvailable === true}
              imageGenerationReason={imageGenerationReason}
              onProfileChange={onDesignTaskProfileChange}
              onConfigureImageGeneration={onConfigureImageGeneration}
            />
          </div>
        ) : null}
        {showWorkspaceControls ? (
          <div
            className="ds-composer-workspace-controls ds-no-drag flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-2 px-3 pb-1"
            data-composer-workspace-controls
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <WorkspaceProjectPicker currentWorkspaceRoot={effectiveWorkspaceRoot} />
              <KnowledgeBasePicker />
              <GitBranchPicker
                workspaceRoot={effectiveWorkspaceRoot}
                useWorktreePool={useWorktreePool}
                worktreeBranch={worktreeBranch}
                onWorktreeBranchChange={onWorktreeBranchChange}
                onToggleWorktreeMode={canToggleWorktreeMode ? onToggleWorktreeMode : undefined}
              />
              {!compact && emptyTaskLayout && taskSurface === 'code' && onNewRequirement ? (
                <button
                  type="button"
                  data-composer-new-requirement
                  disabled={!runtimeReady || busy}
                  onClick={onNewRequirement}
                  className="ds-composer-new-requirement ds-no-drag inline-flex h-8 shrink-0 items-center rounded-lg px-2 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {t('sddNewRequirement')}
                </button>
              ) : null}
            </div>
            {!compact && emptyTaskLayout && taskSurface === 'design' && designTaskProfile ? (
              <FloatingComposerTaskProfile
                surface="design"
                locked={taskSurfaceLocked === true}
                profileLocked={designProfileLocked === true}
                disabled={!canCompose || busy}
                profile={designTaskProfile}
                imageGenerationEnabled={imageGenerationEnabled}
                imageGenerationAvailable={imageGenerationAvailable === true}
                imageGenerationReason={imageGenerationReason}
                onProfileChange={onDesignTaskProfileChange}
                onConfigureImageGeneration={onConfigureImageGeneration}
              />
            ) : null}
          </div>
        ) : null}

        <div
          ref={composerShellRef}
          className={`ds-composer-shell ds-chat-composer ds-frosted ds-no-drag flex flex-col gap-1 transition ${
            draft.focused ? 'ds-chat-composer-focus' : ''
          } ${compact
            ? 'rounded-[var(--ds-radius-card)] px-3 py-2 shadow-none'
            : emptyTaskLayout
              ? 'rounded-[18px] px-4 pb-2.5 pt-2.5 shadow-[0_10px_28px_rgba(20,47,95,0.07)]'
              : 'px-3 pb-2 pt-2'}`}
          onMouseDown={handleComposerShellMouseDown}
          onPaste={handleComposerPaste}
          onDragOver={handleComposerDragOver}
          onDrop={handleComposerDrop}
        >
          {contextChips.length > 0 ? (
            <FloatingComposerContextChips chips={contextChips} onRemove={onRemoveContextChip} t={t} />
          ) : null}
          <textarea
            ref={draft.textareaRef}
            rows={1}
            className={`ds-composer-textarea ds-no-drag block w-full min-w-0 resize-none break-words bg-transparent px-1 py-2.5 text-[15px] leading-[1.45] text-ds-ink placeholder:text-ds-faint focus:outline-none [overflow-wrap:anywhere] ${
              canEditComposer ? '' : 'opacity-80'
            } ${compact ? 'text-[14px] py-2' : emptyTaskLayout ? 'min-h-[64px]' : 'min-h-[40px]'}`}
            placeholder={documentQuoteAttached ? t('composerDocumentQuotePlaceholder') : placeholder}
            value={input}
            disabled={!canEditComposer}
            onChange={(e) => {
              fileMentions.updateInput(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length
              )
            }}
            onSelect={(e) => fileMentions.syncCursor(e.currentTarget)}
            onFocus={draft.onFocus}
            onBlur={draft.onBlur}
            onCompositionStart={draft.onCompositionStart}
            onCompositionEnd={draft.onCompositionEnd}
            onKeyDown={handleComposerKeyDown}
          />
          {fileReferences.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-1">
            {fileReferences.map((reference: ComposerFileReference) => {
                const isDirectory = isComposerDirectoryReference(reference)
                const displayPath = isDirectory ? `${reference.relativePath}/` : reference.relativePath
                return (
                  <span
                    key={`${reference.type ?? 'file'}:${reference.relativePath}`}
                    className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card px-2 text-[12px] font-medium text-ds-muted"
                    title={displayPath}
                  >
                    {isDirectory ? (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                    )}
                    <span className="max-w-52 truncate">{displayPath}</span>
                    {onRemoveFileReference ? (
                      <button
                        type="button"
                        onClick={() => fileMentions.removeReference(reference)}
                        className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                        aria-label={t('composerRemoveFileReference')}
                        title={t('composerRemoveFileReference')}
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    ) : null}
                  </span>
                )
              })}
            </div>
          ) : null}
          <FloatingComposerAttachments
            attachments={attachments}
            attachmentUploadError={attachmentUploadError}
            onRemoveAttachment={onRemoveAttachment}
          />
          {attachmentUploadEnabled ? (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.docx,.xlsx,.pptx"
              multiple
              className="hidden"
              onChange={handleAttachmentInput}
            />
          ) : null}
          {dictation.error ? (
            <ComposerInlineError
              message={dictation.error}
              onDismiss={dictation.clearError}
              dismissLabel={t('composerDismissError')}
            />
          ) : null}
          {promptOptimizationError && onDismissPromptOptimizationError ? (
            <ComposerInlineError
              message={promptOptimizationError}
              onDismiss={onDismissPromptOptimizationError}
              dismissLabel={t('composerDismissError')}
            />
          ) : null}
          <div
            className={`ds-composer-toolbar flex min-h-9 min-w-0 items-center gap-2 ${
              showToolbarStartControls ? 'justify-between' : 'justify-end'
            }`}
          >
            {showToolbarStartControls ? (
              <div className="ds-composer-toolbar-start flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden">
                {showComposerMenuButton ? (
                  <>
                    <button
                      ref={composerMenuButtonRef}
                      type="button"
                      disabled={!canOpenComposerMenu}
                      onClick={handleComposerMenuButtonClick}
                      className={`ds-composer-menu-button ds-no-drag flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 ${
                        composerMenuOpen ? 'bg-ds-hover text-ds-ink' : ''
                      }`}
                      aria-expanded={composerMenuOpen}
                      aria-haspopup="menu"
                      aria-controls="floating-composer-action-menu"
                      aria-label={t('composerMenuTitle')}
                      title={t('composerMenuTitle')}
                    >
                      <Plus className="h-5 w-5" strokeWidth={1.8} />
                    </button>
                    {taskSurface && onTaskSurfaceChange && !taskSurfaceLocked ? (
                      <FloatingComposerTaskSurfacePicker
                        surface={taskSurface}
                        disabled={!canCompose || busy}
                        onSurfaceChange={onTaskSurfaceChange}
                      />
                    ) : null}
                    {showCodeExecutionControls && mode === 'plan' ? (
                      <button
                        type="button"
                        data-composer-plan-mode-badge
                        onClick={handlePlanToolbarClick}
                        className="ds-composer-mode-badge ds-no-drag inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-ds-hover px-2.5 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
                        title={`${t('cancel')} ${t('slashCommandPlanTitle')}`}
                        aria-label={`${t('cancel')} ${t('slashCommandPlanTitle')}`}
                      >
                        <ListTodo className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span className="ds-composer-mode-label">{t('slashCommandPlanTitle')}</span>
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    ) : showCodeExecutionControls && mode === 'auto' ? (
                      <button
                        type="button"
                        data-composer-auto-plan-build-mode-badge
                        onClick={handleAutoPlanBuildToolbarClick}
                        className="ds-composer-mode-badge ds-no-drag inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-[13px] font-medium text-accent transition hover:brightness-95"
                        title={`${t('cancel')} ${t('composerMenuAutoPlanBuild')}`}
                        aria-label={`${t('cancel')} ${t('composerMenuAutoPlanBuild')}`}
                      >
                        <Bot className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span className="ds-composer-mode-label">{t('composerMenuAutoPlanBuild')}</span>
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    ) : null}
                    {showCodeExecutionControls && graphPlanningNeedsCorrection ? (
                      <span
                        data-composer-graph-needs-correction
                        className="ds-composer-mode-badge inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 text-[13px] font-medium text-amber-700 dark:text-amber-200"
                        title={t('graphPlanningStatus_needs_correction')}
                        aria-label={t('graphPlanningStatus_needs_correction')}
                      >
                        <Share2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span className="ds-composer-mode-label">
                          {t('graphPlanningStatus_needs_correction')}
                        </span>
                      </span>
                    ) : runningGraphTurn ? (
                      <span
                        data-composer-graph-running
                        className="ds-composer-mode-badge inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-indigo-500/10 px-2.5 text-[13px] font-medium text-indigo-700 dark:text-indigo-200"
                        title={t('graphModeRunning', { defaultValue: 'Running: Graph' })}
                        aria-label={t('graphModeRunning', { defaultValue: 'Running: Graph' })}
                      >
                        <Share2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span className="ds-composer-mode-label">
                          {t('graphModeRunning', { defaultValue: 'Running: Graph' })}
                        </span>
                      </span>
                    ) : showCodeExecutionControls && graphEnabled && !busy && mode === 'agent' && orchestration === 'graph' ? (
                      <span
                        data-composer-graph-active
                        className="ds-composer-mode-badge inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-indigo-500/10 px-2.5 text-[13px] font-medium text-indigo-700 dark:text-indigo-200"
                        title={t('graphModeGraphHint', {
                          defaultValue: 'Graph: plan, delegate, supervise, review, and synthesize'
                        })}
                        aria-label={t('graphModeGraph', { defaultValue: 'Graph' })}
                      >
                        <Share2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span className="ds-composer-mode-label">
                          {t('graphModeGraph', { defaultValue: 'Graph' })}
                        </span>
                      </span>
                    ) : null}
                    {showCodeExecutionControls && goalInputMode ? (
                      <button
                        type="button"
                        data-composer-goal-mode-badge
                        onClick={() => {
                          setGoalInputMode(false)
                          draft.focusComposer()
                        }}
                        className="ds-composer-mode-badge ds-no-drag inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-ds-hover px-2.5 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
                        title={`${t('cancel')} ${t('slashCommandGoalTitle')}`}
                        aria-label={`${t('cancel')} ${t('slashCommandGoalTitle')}`}
                      >
                        <Target className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span className="ds-composer-mode-label">{t('slashCommandGoalTitle')}</span>
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    ) : showCodeExecutionControls && activeThreadGoal?.status === 'active' ? (
                      <span
                        className="ds-composer-mode-badge inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-ds-hover px-2.5 text-[13px] font-medium text-ds-muted"
                        title={t('slashCommandGoalTitle')}
                        aria-label={t('slashCommandGoalTitle')}
                      >
                        <Target className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span className="ds-composer-mode-label">{t('slashCommandGoalTitle')}</span>
                      </span>
                    ) : null}
                  </>
                ) : null}
                {showExecutionSettingsPicker && executionSettings && onExecutionSettingsChange ? (
                  <FloatingComposerExecutionPicker
                    value={executionSettings}
                    applying={executionSettingsApplying}
                    disabled={!canCompose || busy}
                    onChange={onExecutionSettingsChange}
                    onOpenPermissionSettings={() => openSettings('agents')}
                  />
                ) : null}
              </div>
            ) : null}
            <div
              className={`ds-composer-toolbar-actions flex min-w-0 items-center justify-end gap-1.5 ${
                showToolbarStartControls || stretchModelPicker || dictation.status === 'recording' || side
                  ? 'flex-1'
                  : 'shrink-0'
              }`}
            >
              {dictation.status === 'recording' ? (
                <>
                  <VoiceRecordingStrip
                    getLevel={dictation.getLevel}
                    startedAtMs={dictation.startedAtMs}
                  />
                  <button
                    type="button"
                    onClick={() => dictation.stop('insert')}
                    className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    aria-label={t('composerVoiceStop')}
                    title={t('composerVoiceStop')}
                  >
                    <Square className="h-3 w-3 fill-current" strokeWidth={2.4} />
                  </button>
                  <button
                    type="button"
                    onClick={() => dictation.stop('send')}
                    className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-control text-control-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    aria-label={t('composerVoiceSend')}
                    title={t('composerVoiceSend')}
                  >
                    <Send className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </>
              ) : (
                <>
                  {side ? null : (
                    <FloatingComposerContextCapacity
                      compact={compact}
                      route={route}
                      activeThreadId={activeThreadId}
                      selectedModel={composerModel}
                      selectedProviderId={composerProviderId}
                    />
                  )}
                  {hideModelPicker ? null : (
                    <FloatingComposerModelPicker
                      compact={compact}
                      mode={modelPickerMode}
                      composerModel={composerModel}
                      composerProviderId={composerProviderId}
                      composerPickList={composerPickList}
                      composerModelGroups={composerModelGroups}
                      composerReasoningEffort={composerReasoningEffort}
                      composerFastMode={composerFastMode}
                      showProviderInModelLabel={showProviderInModelLabel}
                      canChangeModel={canChangeModel}
                      controlVariant={modelControlVariant}
                      stretch={stretchModelPicker || showToolbarStartControls}
                      onComposerModelChange={onComposerModelChange}
                      onComposerReasoningEffortChange={onComposerReasoningEffortChange}
                      onComposerFastModeChange={onComposerFastModeChange}
                      onConfigureProviders={onConfigureProviders}
                    />
                  )}
                  {hideModelPicker || side ? null : (
                    <FloatingComposerAgentPicker
                      compact={compact}
                      disabled={!canCompose || busy}
                      surface={composerAgentPickerSurface(route, taskSurface)}
                    />
                  )}
                  {!side && showVoiceDictation ? (
                    <button
                      type="button"
                      disabled={dictation.status === 'transcribing' || !canEditComposer}
                      onClick={dictation.toggle}
                      className="ds-composer-optional-action ds-composer-voice-action ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={
                        dictation.status === 'transcribing'
                          ? t('composerVoiceTranscribing')
                          : t('composerVoiceStart')
                      }
                      title={
                        dictation.status === 'transcribing'
                          ? t('composerVoiceTranscribing')
                          : t('composerVoiceStart')
                      }
                    >
                      {dictation.status === 'transcribing' ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                      ) : (
                        <Mic className="h-4 w-4" strokeWidth={2} />
                      )}
                    </button>
                  ) : null}
                  {!side && promptOptimizationSettings?.enabled === true ? (
                    <button
                      type="button"
                      disabled={!canOptimizePrompt}
                      onClick={handlePromptOptimizationClick}
                      className="ds-composer-optional-action ds-composer-prompt-optimize-action ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={promptOptimizationBusy ? t('composerPromptOptimizing') : t('composerPromptOptimize')}
                      title={promptOptimizationBusy ? t('composerPromptOptimizing') : t('composerPromptOptimize')}
                    >
                      {promptOptimizationBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                      ) : (
                        <Sparkles className="h-4 w-4" strokeWidth={2} />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={primaryActionKind === 'submit' && primaryActionDisabled}
                    onClick={primaryActionKind === 'interrupt'
                      ? () => onInterrupt()
                      : handlePrimaryAction}
                    className="ds-composer-primary-action ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-control text-control-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:bg-ds-card disabled:text-ds-faint"
                    aria-label={primaryActionKind === 'interrupt' ? t('interrupt') : primaryActionLabel}
                    title={primaryActionKind === 'interrupt' ? t('interrupt') : primaryActionLabel}
                  >
                    {primaryActionKind === 'interrupt' ? (
                      <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2.4} />
                    ) : primaryActionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                    ) : (
                      <Send className="h-4 w-4" strokeWidth={2.2} />
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <FloatingComposerFooterView context={context} />
    </>
  )
}
