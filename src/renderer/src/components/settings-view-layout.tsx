import { settingsButtonClass } from './settings-button'
import type { ComponentProps, ReactElement } from 'react'
import { Suspense, lazy, useEffect } from 'react'
import { CircleAlert, RotateCw } from 'lucide-react'
import { ExtensionDeclarativeSettingsPane } from '../extensions/ExtensionDeclarativeSettingsPane'
import { GeneralSettingsSection } from './settings-section-general'
import {
  SettingsSidebar
} from './SettingsSidebar'
import { settingsSaveIssueMessage } from './settings-save-error'
import { SettingsPageHeader, SettingsSaveStatusPill, settingsSaveStatusTone } from './settings-page-header'
import { lazySection } from './settings-lazy-section'
import type { SettingsCategory } from './settings-navigation'

const ProvidersSettingsSection = lazySection(() =>
  import('./settings-section-providers').then((module) => ({ default: module.ProvidersSettingsSection }))
)
const WriteSettingsSection = lazySection(() =>
  import('./settings-section-write').then((module) => ({ default: module.WriteSettingsSection }))
)
const DesignSettingsSection = lazySection(() =>
  import('./settings-section-design').then((module) => ({ default: module.DesignSettingsSection }))
)
const MediaGenerationSettingsSection = lazySection(() =>
  import('./settings-section-media-generation').then((module) => ({ default: module.MediaGenerationSettingsSection }))
)
const SpeechToTextSettingsSection = lazySection(() =>
  import('./settings-section-speech-to-text').then((module) => ({ default: module.SpeechToTextSettingsSection }))
)
const AgentsSettingsSection = lazySection(() =>
  import('./settings-section-agents').then((module) => ({ default: module.AgentsSettingsSection }))
)
const LaboratorySettingsSection = lazySection(() =>
  import('./settings-section-agents').then((module) => ({ default: module.LaboratorySettingsSection }))
)
const SubagentsSettingsSection = lazySection(() =>
  import('./settings-section-subagents').then((module) => ({ default: module.SubagentsSettingsSection }))
)
const ArchivedThreadsSettingsSection = lazySection(() =>
  import('./settings-section-archives').then((module) => ({ default: module.ArchivedThreadsSettingsSection }))
)
const WorktreeSettingsSection = lazySection(() =>
  import('./settings-section-worktree').then((module) => ({ default: module.WorktreeSettingsSection }))
)
const MemorySettingsSection = lazySection(() =>
  import('./settings-section-memory').then((module) => ({ default: module.MemorySettingsSection }))
)
const KeyboardShortcutsSettingsSection = lazySection(() =>
  import('./settings-section-shortcuts').then((module) => ({ default: module.KeyboardShortcutsSettingsSection }))
)
const EasterEggSettingsSection = lazySection(() =>
  import('./settings-section-easter-egg').then((module) => ({ default: module.EasterEggSettingsSection }))
)
const ClawSettingsSection = lazySection(() =>
  import('./settings-section-claw').then((module) => ({ default: module.ClawSettingsSection }))
)
const UpdatesSettingsSection = lazySection(() =>
  import('./settings-section-updates').then((module) => ({ default: module.UpdatesSettingsSection }))
)
const TerminalSettingsSection = lazySection(() =>
  import('./settings-section-terminal').then((module) => ({ default: module.TerminalSettingsSection }))
)
const LlmDebugSettingsSection = lazySection(() =>
  import('./settings-section-llm-debug').then((module) => ({ default: module.LlmDebugSettingsSection }))
)
const DataMigrationSettingsSection = lazySection(() =>
  import('./settings-section-data-migration').then((module) => ({ default: module.DataMigrationSettingsSection }))
)
const StorageRelocationSettingsSection = lazySection(() =>
  import('./settings-section-storage-relocation').then((module) => ({ default: module.StorageRelocationSettingsSection }))
)
const UninstallSettingsSection = lazySection(() =>
  import('./settings-section-uninstall').then((module) => ({ default: module.UninstallSettingsSection }))
)
const WriteDebugLogModal = lazy(() =>
  import('./settings-debug-log').then((module) => ({ default: module.WriteDebugLogModal }))
)

const SECTION_PRELOADERS: Partial<Record<SettingsCategory, () => void>> = {
  providers: ProvidersSettingsSection.preload,
  write: WriteSettingsSection.preload,
  design: DesignSettingsSection.preload,
  mediaGeneration: MediaGenerationSettingsSection.preload,
  speechToText: SpeechToTextSettingsSection.preload,
  agents: AgentsSettingsSection.preload,
  laboratory: LaboratorySettingsSection.preload,
  subagents: SubagentsSettingsSection.preload,
  archives: ArchivedThreadsSettingsSection.preload,
  worktree: WorktreeSettingsSection.preload,
  memory: MemorySettingsSection.preload,
  shortcuts: KeyboardShortcutsSettingsSection.preload,
  easterEgg: EasterEggSettingsSection.preload,
  claw: ClawSettingsSection.preload,
  updates: UpdatesSettingsSection.preload,
  terminal: TerminalSettingsSection.preload,
  debug: LlmDebugSettingsSection.preload,
  dataMigration: DataMigrationSettingsSection.preload,
  storage: StorageRelocationSettingsSection.preload,
  uninstall: UninstallSettingsSection.preload
}

function preloadSettingsCategory(category: SettingsCategory): void {
  SECTION_PRELOADERS[category]?.()
}

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
    <div aria-busy="true" className="ds-settings-skeleton" data-testid="settings-section-fallback">
      <div className="ds-settings-skeleton-bar h-10 w-full max-w-[420px] rounded-full" />
      <div className="ds-settings-skeleton-card">
        <div className="ds-settings-skeleton-bar h-4 w-40 rounded-md" />
        <div className="ds-settings-skeleton-bar mt-2 h-3 w-64 max-w-full rounded-md" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="ds-settings-skeleton-row">
            <div className="min-w-0 flex-1">
              <div className="ds-settings-skeleton-bar h-3.5 w-36 rounded-md" />
              <div className="ds-settings-skeleton-bar mt-2 h-3 w-56 max-w-full rounded-md" />
            </div>
            <div className="ds-settings-skeleton-bar h-8 w-28 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsViewLayout({ view }: { view: Record<string, any> }): ReactElement {
  const { t, workspaceRoot, extensionWorkspaceRoot, category, setCategory, activeAgentsPanel, saveStatus, saveError, saveIssue, writeDebugModalOpen, setWriteDebugModalOpen, writeCompletionDebugEntries, writeCompletionDebugSelectedId, setWriteCompletionDebugSelectedId, writeDebugLoading, writeDebugError, extensionSettingsService, extensionSettingsContributions, extensionSettingsAvailable, settingsScrollerRef, markAgentsSectionReady, categoryTitle, categoryDescription, loadWriteDebugEntries, portError, flushPendingSave, goBack, clearWriteDebugEntries, settingsSectionContext } = view
  const autoApplyCategory = category !== 'extensions' &&
    category !== 'dataMigration' && category !== 'storage' && category !== 'uninstall'
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
        onPreloadCategory={preloadSettingsCategory}
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
          {category !== 'providers' ? (
            <SettingsPageHeader
              key={`header-${category}`}
              category={category}
              title={categoryTitle}
              description={categoryDescription}
              status={autoApplyCategory ? (
                <SettingsSaveStatusPill
                  t={t}
                  tone={settingsSaveStatusTone({ explicitSavePanel, portError, saveStatus })}
                  title={saveStatus === 'error' && saveIssueSummary ? saveIssueSummary : undefined}
                />
              ) : null}
            />
          ) : null}

          {autoApplyCategory && saveStatus === 'error' && saveError ? (
            <div role="alert" className="ds-settings-alert mb-5">
              <CircleAlert aria-hidden="true" className="ds-settings-alert-icon" strokeWidth={2} />
              <div className="min-w-0 flex-1">
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
      {autoApplyCategory && saveStatus === 'error' && saveError ? (
        <div role="alert" className="ds-settings-toast ds-no-drag">
          <span className="ds-settings-toast-icon" aria-hidden="true">
            <CircleAlert className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ds-ink">{t('applyFailed')}</div>
            <div className="mt-0.5 truncate text-[12px] text-ds-muted">
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
            {saveIssue?.kind === 'provider-model-limit' ? null : (
              <RotateCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
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
