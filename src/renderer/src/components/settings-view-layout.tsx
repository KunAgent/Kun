import { settingsButtonClass } from './settings-button'
import type { ComponentProps, ReactElement } from 'react'
import { Suspense, lazy, useEffect } from 'react'
import { ExtensionDeclarativeSettingsPane } from '../extensions/ExtensionDeclarativeSettingsPane'
import { GeneralSettingsSection } from './settings-section-general'
import {
  SettingsSidebar
} from './SettingsSidebar'
import { settingsSaveIssueMessage } from './settings-save-error'

const IntegrationsSettingsSection = lazy(() =>
  import('./settings-section-integrations').then((module) => ({ default: module.IntegrationsSettingsSection }))
)
const ProvidersSettingsSection = lazy(() =>
  import('./settings-section-providers').then((module) => ({ default: module.ProvidersSettingsSection }))
)
const WriteSettingsSection = lazy(() =>
  import('./settings-section-write').then((module) => ({ default: module.WriteSettingsSection }))
)
const DesignSettingsSection = lazy(() =>
  import('./settings-section-design').then((module) => ({ default: module.DesignSettingsSection }))
)
const MediaGenerationSettingsSection = lazy(() =>
  import('./settings-section-media-generation').then((module) => ({ default: module.MediaGenerationSettingsSection }))
)
const SpeechToTextSettingsSection = lazy(() =>
  import('./settings-section-speech-to-text').then((module) => ({ default: module.SpeechToTextSettingsSection }))
)
const AgentsSettingsSection = lazy(() =>
  import('./settings-section-agents').then((module) => ({ default: module.AgentsSettingsSection }))
)
const LaboratorySettingsSection = lazy(() =>
  import('./settings-section-agents').then((module) => ({ default: module.LaboratorySettingsSection }))
)
const SubagentsSettingsSection = lazy(() =>
  import('./settings-section-subagents').then((module) => ({ default: module.SubagentsSettingsSection }))
)
const ArchivedThreadsSettingsSection = lazy(() =>
  import('./settings-section-archives').then((module) => ({ default: module.ArchivedThreadsSettingsSection }))
)
const WorktreeSettingsSection = lazy(() =>
  import('./settings-section-worktree').then((module) => ({ default: module.WorktreeSettingsSection }))
)
const MemorySettingsSection = lazy(() =>
  import('./settings-section-memory').then((module) => ({ default: module.MemorySettingsSection }))
)
const KeyboardShortcutsSettingsSection = lazy(() =>
  import('./settings-section-shortcuts').then((module) => ({ default: module.KeyboardShortcutsSettingsSection }))
)
const EasterEggSettingsSection = lazy(() =>
  import('./settings-section-easter-egg').then((module) => ({ default: module.EasterEggSettingsSection }))
)
const ClawSettingsSection = lazy(() =>
  import('./settings-section-claw').then((module) => ({ default: module.ClawSettingsSection }))
)
const UpdatesSettingsSection = lazy(() =>
  import('./settings-section-updates').then((module) => ({ default: module.UpdatesSettingsSection }))
)
const TerminalSettingsSection = lazy(() =>
  import('./settings-section-terminal').then((module) => ({ default: module.TerminalSettingsSection }))
)
const LlmDebugSettingsSection = lazy(() =>
  import('./settings-section-llm-debug').then((module) => ({ default: module.LlmDebugSettingsSection }))
)
const DataMigrationSettingsSection = lazy(() =>
  import('./settings-section-data-migration').then((module) => ({ default: module.DataMigrationSettingsSection }))
)
const StorageRelocationSettingsSection = lazy(() =>
  import('./settings-section-storage-relocation').then((module) => ({ default: module.StorageRelocationSettingsSection }))
)
const UninstallSettingsSection = lazy(() =>
  import('./settings-section-uninstall').then((module) => ({ default: module.UninstallSettingsSection }))
)
const WriteDebugLogModal = lazy(() =>
  import('./settings-debug-log').then((module) => ({ default: module.WriteDebugLogModal }))
)

function LoadedAgentsSettingsSection({
  onReady,
  ...props
}: ComponentProps<typeof AgentsSettingsSection> & { onReady: () => void }): ReactElement {
  useEffect(() => {
    onReady()
  }, [onReady])
  return <AgentsSettingsSection {...props} />
}

function SettingsSectionFallback(): ReactElement {
  return (
    <div aria-busy="true" className="space-y-3" data-testid="settings-section-fallback">
      <div className="h-7 w-48 animate-pulse rounded-lg bg-ds-subtle" />
      <div className="h-32 animate-pulse rounded-2xl bg-ds-subtle" />
    </div>
  )
}

export function SettingsViewLayout({ view }: { view: Record<string, any> }): ReactElement {
  const { t, workspaceRoot, extensionWorkspaceRoot, category, setCategory, activeAgentsPanel, saveStatus, saveError, saveIssue, writeDebugModalOpen, setWriteDebugModalOpen, writeCompletionDebugEntries, writeCompletionDebugSelectedId, setWriteCompletionDebugSelectedId, writeDebugLoading, writeDebugError, extensionSettingsService, extensionSettingsContributions, extensionSettingsAvailable, settingsScrollerRef, markAgentsSectionReady, categoryTitle, categoryDescription, loadWriteDebugEntries, portError, flushPendingSave, goBack, clearWriteDebugEntries, settingsSectionContext } = view
  const explicitSavePanel = category === 'agents' &&
    (activeAgentsPanel === 'collaboration' || activeAgentsPanel === 'project')
  const saveIssueSummary = saveIssue?.kind === 'provider-model-limit'
    ? settingsSaveIssueMessage(saveIssue, t)
    : saveError
  const viewProblemModel = (): void => {
    setCategory('providers')
  }
  return (
    <div className="ds-settings-surface ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main">
      <SettingsSidebar
        category={category}
        setCategory={setCategory}
        goBack={goBack}
        extensionSettingsAvailable={extensionSettingsAvailable}
        platform={window.kunGui.platform}
        t={t}
      />

      <div className="ds-settings-stage relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          ref={settingsScrollerRef}
          className={`ds-settings-scroller ds-no-drag h-full min-h-0 overflow-y-auto ${
            category === 'providers' ? 'ds-settings-scroller--providers' : ''
          }`}
        >
          <div className={`ds-settings-content mx-auto ${
            category === 'providers' ? 'ds-settings-content--providers' : ''
          }`}>
          {category !== 'providers' ? <div className="ds-settings-page-header flex items-start justify-between gap-5">
            <div className="min-w-0">
              <h1 className="text-[24px] font-medium leading-tight tracking-[-0.02em] text-ds-ink">
                {categoryTitle}
              </h1>
              <p className="mt-1.5 max-w-2xl text-[12px] leading-[1.4] text-ds-muted">
                {categoryDescription}
              </p>
            </div>
            {category !== 'integrations' && category !== 'extensions' && category !== 'dataMigration' && category !== 'storage' && category !== 'uninstall' ? <span
              role="status"
              aria-live="polite"
              title={saveStatus === 'error' && saveIssueSummary ? saveIssueSummary : undefined}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ${
                explicitSavePanel
                  ? 'bg-ds-subtle text-ds-muted'
                  : portError
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                  : saveStatus === 'saved'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                    : saveStatus === 'error'
                      ? 'bg-red-500/15 text-red-700 dark:text-red-200'
                      : 'bg-ds-subtle text-ds-muted'
              }`}
            >
              {explicitSavePanel
                ? t('adeSettings.manualSaveHint')
                : portError
                ? t('autoApplyBlocked')
                : saveStatus === 'saving'
                  ? t('applying')
                  : saveStatus === 'saved'
                    ? t('applied')
                    : saveStatus === 'error'
                      ? t('applyFailed')
                      : t('autoApplyHint')}
            </span> : null}
          </div> : null}

          {category !== 'integrations' && category !== 'extensions' && category !== 'dataMigration' && category !== 'storage' && category !== 'uninstall' && saveStatus === 'error' && saveError ? (
            <div
              role="alert"
              className="mb-5 rounded-[var(--ds-radius-card)] border border-red-200 bg-red-50 px-4 py-3 text-[13px] leading-5 text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
            >
              <div>{saveIssueSummary}</div>
              {saveIssue?.kind === 'provider-model-limit' ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button type="button" className={settingsButtonClass({ variant: 'link' })} onClick={viewProblemModel}>
                    {t('providerModelSaveViewProblem')}
                  </button>
                  <details className="text-[11px] opacity-80">
                    <summary className="cursor-pointer">{t('providerModelSaveTechnicalDetails')}</summary>
                    <div className="mt-1 break-all font-mono">{saveError}</div>
                  </details>
                </div>
              ) : null}
            </div>
          ) : null}

          <div
            className={`ds-settings-page ds-settings-page--${category}`}
            data-settings-category-view={category}
            key={category}
          >
            {category === 'general' ? <GeneralSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'extensions' && extensionSettingsService ? (
              <ExtensionDeclarativeSettingsPane
                contributions={extensionSettingsContributions}
                workspaceRoot={extensionWorkspaceRoot}
                service={extensionSettingsService}
              />
            ) : null}
            <Suspense fallback={<SettingsSectionFallback />}>
              {category === 'integrations' ? <IntegrationsSettingsSection /> : null}
              {category === 'providers' ? <ProvidersSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'write' ? <WriteSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'design' ? <DesignSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'mediaGeneration' ? <MediaGenerationSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'speechToText' ? <SpeechToTextSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'agents' ? (
                <LoadedAgentsSettingsSection ctx={settingsSectionContext} onReady={markAgentsSectionReady} />
              ) : null}
              {category === 'laboratory' ? <LaboratorySettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'subagents' ? <SubagentsSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'archives' ? <ArchivedThreadsSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'worktree' ? <WorktreeSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'memory' ? <MemorySettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'shortcuts' ? <KeyboardShortcutsSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'easterEgg' ? <EasterEggSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'claw' ? <ClawSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'updates' ? <UpdatesSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'terminal' ? <TerminalSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'debug' ? <LlmDebugSettingsSection ctx={settingsSectionContext} /> : null}
              {category === 'dataMigration' ? <DataMigrationSettingsSection /> : null}
              {category === 'storage' ? <StorageRelocationSettingsSection /> : null}
              {category === 'uninstall' ? <UninstallSettingsSection /> : null}
            </Suspense>
          </div>
          </div>
        </div>
      </div>
      {category !== 'integrations' && category !== 'extensions' && category !== 'dataMigration' && category !== 'storage' && category !== 'uninstall' && saveStatus === 'error' && saveError ? (
        <div
          role="alert"
          className="ds-no-drag fixed bottom-6 right-8 z-30 flex max-w-[min(560px,calc(100vw-3rem))] items-center gap-3 rounded-2xl border border-red-300/70 bg-red-50/95 px-4 py-3 text-red-900 shadow-2xl shadow-red-950/10 backdrop-blur dark:border-red-500/30 dark:bg-red-950/90 dark:text-red-100"
        >
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{t('applyFailed')}</div>
            <div className="mt-0.5 truncate text-[12px] text-red-800/85 dark:text-red-100/80">
              {saveIssueSummary}
            </div>
          </div>
          <button
            type="button"
             className={settingsButtonClass({ variant: 'primary', className: 'shrink-0' })}
            disabled={saveIssue?.kind === 'provider-model-limit' ? false : Boolean(portError)}
            onClick={saveIssue?.kind === 'provider-model-limit'
              ? viewProblemModel
              : () => void flushPendingSave()}
          >
            {saveIssue?.kind === 'provider-model-limit'
              ? t('providerModelSaveViewProblem')
              : t('retrySave')}
          </button>
        </div>
      ) : null}
      {writeDebugModalOpen ? (
        <Suspense fallback={null}>
          <WriteDebugLogModal
            completionEntries={writeCompletionDebugEntries}
            completionSelectedId={writeCompletionDebugSelectedId}
            loading={writeDebugLoading}
            error={writeDebugError}
            onSelectCompletion={setWriteCompletionDebugSelectedId}
            onRefresh={() => void loadWriteDebugEntries()}
            onClear={() => void clearWriteDebugEntries()}
            onClose={() => setWriteDebugModalOpen(false)}
            t={t}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
