import { settingsButtonClass } from './settings-button'
import type { ComponentProps, ReactElement } from 'react'
import { Suspense, lazy, useRef } from 'react'
import { CircleAlert, RotateCw } from 'lucide-react'
import { ExtensionDeclarativeSettingsPane } from '../extensions/ExtensionDeclarativeSettingsPane'
import { GeneralSettingsSection } from './settings-section-general'
import {
  SettingsSidebar
} from './SettingsSidebar'
import { settingsSaveIssueMessage } from './settings-save-error'
import { SettingsPageHeader, SettingsSaveStatusPill, settingsSaveStatusTone } from './settings-page-header'
import { lazySection } from './settings-lazy-section'
import { AGENT_SETTINGS_PANELS, isAgentSettingsCategory, type SettingsCategory } from './settings-navigation'
import { useSettingsArrivalFlash } from './use-settings-arrival-flash'

const ProvidersSettingsSection = lazySection(() =>
  import('./settings-section-providers').then((module) => ({ default: module.ProvidersSettingsSection }))
)
const GatewaySettingsSection = lazySection(() =>
  import('./settings-section-gateway').then((module) => ({ default: module.GatewaySettingsSection }))
)
const AppearanceSettingsSection = lazySection(() =>
  import('./settings-section-appearance').then((module) => ({ default: module.AppearanceSettingsSection }))
)
const NotificationsSettingsSection = lazySection(() =>
  import('./settings-section-notifications').then((module) => ({ default: module.NotificationsSettingsSection }))
)
const CodeSettingsSection = lazySection(() =>
  import('./settings-section-code').then((module) => ({ default: module.CodeSettingsSection }))
)
const PaperSettingsSection = lazySection(() =>
  import('./settings-section-paper').then((module) => ({ default: module.PaperSettingsSection }))
)
const LegacySessionImportCard = lazySection(() =>
  import('./settings-section-general-legacy-import').then((module) => ({ default: module.LegacySessionImportCard }))
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
const ConnectionsSettingsSection = lazySection(() =>
  import('./settings-section-connections').then((module) => ({ default: module.ConnectionsSettingsSection }))
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
const StorageCleanupSettingsSection = lazySection(() =>
  import('./settings-section-storage-cleanup').then((module) => ({ default: module.StorageCleanupSettingsSection }))
)
const UninstallSettingsSection = lazySection(() =>
  import('./settings-section-uninstall').then((module) => ({ default: module.UninstallSettingsSection }))
)
const WriteDebugLogModal = lazy(() =>
  import('./settings-debug-log').then((module) => ({ default: module.WriteDebugLogModal }))
)

const SECTION_PRELOADERS: Partial<Record<SettingsCategory, () => void>> = {
  appearance: AppearanceSettingsSection.preload,
  notifications: NotificationsSettingsSection.preload,
  providers: ProvidersSettingsSection.preload,
  gateway: GatewaySettingsSection.preload,
  write: WriteSettingsSection.preload,
  paper: PaperSettingsSection.preload,
  design: DesignSettingsSection.preload,
  mediaGeneration: MediaGenerationSettingsSection.preload,
  speechToText: SpeechToTextSettingsSection.preload,
  laboratory: LaboratorySettingsSection.preload,
  subagents: SubagentsSettingsSection.preload,
  archives: ArchivedThreadsSettingsSection.preload,
  code: CodeSettingsSection.preload,
  memory: MemorySettingsSection.preload,
  shortcuts: KeyboardShortcutsSettingsSection.preload,
  easterEgg: EasterEggSettingsSection.preload,
  claw: ClawSettingsSection.preload,
  connections: ConnectionsSettingsSection.preload,
  updates: UpdatesSettingsSection.preload,
  terminal: TerminalSettingsSection.preload,
  debug: LlmDebugSettingsSection.preload,
  dataMigration: DataMigrationSettingsSection.preload,
  storage: StorageRelocationSettingsSection.preload,
  storageCleanup: StorageCleanupSettingsSection.preload,
  uninstall: UninstallSettingsSection.preload
}

function preloadSettingsCategory(category: SettingsCategory): void {
  if (isAgentSettingsCategory(category)) AgentsSettingsSection.preload()
  else SECTION_PRELOADERS[category]?.()
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
  const { t, workspaceRoot, extensionWorkspaceRoot, category, setCategory, arrival, saveStatus, saveError, saveIssue, writeDebugModalOpen, setWriteDebugModalOpen, writeCompletionDebugEntries, writeCompletionDebugSelectedId, setWriteCompletionDebugSelectedId, writeDebugLoading, writeDebugError, extensionSettingsService, extensionSettingsContributions, extensionSettingsAvailable, settingsScrollerRef, categoryTitle, categoryDescription, loadWriteDebugEntries, portError, flushPendingSave, goBack, clearWriteDebugEntries, settingsSectionContext } = view
  const pageRef = useRef<HTMLDivElement | null>(null)
  useSettingsArrivalFlash(pageRef, arrival)
  const autoApplyCategory = category !== 'extensions' &&
    category !== 'dataMigration' && category !== 'storage' && category !== 'storageCleanup' &&
    category !== 'uninstall'
  // These two pages edit a draft and save it with their own button.
  const explicitSavePanel = category === 'collaboration' || category === 'projects'
  // Workspaces carry their own header and use the full content width.
  const workspacePage = category === 'providers' || category === 'harnesses'
  const sectionContext = { ...settingsSectionContext, openSettingsCategory: setCategory }
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
            workspacePage ? 'ds-settings-scroller--providers' : ''
          }`}
        >
          <div className={`ds-settings-content mx-auto ${
            workspacePage ? 'ds-settings-content--providers' : ''
          }`}>
          {!workspacePage ? (
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
            ref={pageRef}
            className={`ds-settings-page ds-settings-page--${category}`}
            data-settings-category-view={category}
            key={category}
          >
            {category === 'general' ? <GeneralSettingsSection ctx={sectionContext} /> : null}
            {category === 'extensions' && extensionSettingsService ? (
              <ExtensionDeclarativeSettingsPane
                contributions={extensionSettingsContributions}
                workspaceRoot={extensionWorkspaceRoot}
                service={extensionSettingsService}
              />
            ) : null}
            <Suspense fallback={<SettingsSectionFallback />}>
              {category === 'appearance' ? <AppearanceSettingsSection ctx={sectionContext} /> : null}
              {category === 'notifications' ? <NotificationsSettingsSection ctx={sectionContext} /> : null}
              {category === 'providers' ? <ProvidersSettingsSection ctx={sectionContext} /> : null}
              {category === 'gateway' ? <GatewaySettingsSection ctx={sectionContext} /> : null}
              {category === 'write' ? <WriteSettingsSection ctx={sectionContext} /> : null}
              {category === 'paper' ? <PaperSettingsSection ctx={sectionContext} /> : null}
              {category === 'design' ? <DesignSettingsSection ctx={sectionContext} /> : null}
              {category === 'mediaGeneration' ? <MediaGenerationSettingsSection ctx={sectionContext} /> : null}
              {category === 'speechToText' ? <SpeechToTextSettingsSection ctx={sectionContext} /> : null}
              {isAgentSettingsCategory(category) ? (
                <AgentsSettingsSection ctx={sectionContext} panel={AGENT_SETTINGS_PANELS[category]} />
              ) : null}
              {category === 'laboratory' ? <LaboratorySettingsSection ctx={sectionContext} /> : null}
              {category === 'subagents' ? <SubagentsSettingsSection ctx={sectionContext} /> : null}
              {category === 'archives' ? <ArchivedThreadsSettingsSection ctx={sectionContext} /> : null}
              {category === 'code' ? <CodeSettingsSection ctx={sectionContext} /> : null}
              {category === 'memory' ? <MemorySettingsSection ctx={sectionContext} /> : null}
              {category === 'shortcuts' ? <KeyboardShortcutsSettingsSection ctx={sectionContext} /> : null}
              {category === 'easterEgg' ? <EasterEggSettingsSection ctx={sectionContext} /> : null}
              {category === 'claw' ? <ClawSettingsSection ctx={sectionContext} /> : null}
              {category === 'connections' ? <ConnectionsSettingsSection ctx={sectionContext} /> : null}
              {category === 'updates' ? <UpdatesSettingsSection ctx={sectionContext} /> : null}
              {category === 'terminal' ? <TerminalSettingsSection ctx={sectionContext} /> : null}
              {category === 'debug' ? <LlmDebugSettingsSection ctx={sectionContext} /> : null}
              {category === 'dataMigration' ? (
                <>
                  <DataMigrationSettingsSection />
                  <LegacySessionImportCard t={t} tCommon={sectionContext.tCommon} />
                </>
              ) : null}
              {category === 'storage' ? <StorageRelocationSettingsSection /> : null}
              {category === 'storageCleanup' ? <StorageCleanupSettingsSection /> : null}
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
