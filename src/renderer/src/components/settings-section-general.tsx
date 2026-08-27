import type { AppSettingsV1, WindowCloseAction } from '@shared/app-settings'
import {
  APP_LOCALE_OPTIONS,
  CHAT_CONTENT_MAX_WIDTH_MAX,
  CHAT_CONTENT_MAX_WIDTH_MIN,
  normalizeDarkUiColors,
  normalizeChatContentMaxWidth,
  normalizeUiFontScale,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_MIN
} from '@shared/app-settings'
import {
  FolderInput,
  FolderOpen,
  GitBranch,
  Laptop,
  MessageSquareText,
  Monitor
} from 'lucide-react'
import { useState, type ReactElement } from 'react'
import {
  SettingRow,
  SettingsCard,
  SettingsSubTabs,
  SettingsTabPanel,
  SettingsTabs,
  Toggle
} from './settings-controls'
import { GeneralConversationSettingsPanel } from './settings-section-general-conversation'
import { GeneralDesktopSettingsPanel } from './settings-section-general-desktop'
import { LegacySessionImportCard } from './settings-section-general-legacy-import'
import { CheckpointSettingsPanel } from './settings-section-general-checkpoints'
import { SpotlightColorControl } from './settings-color-controls'
import { DarkUiColorsSettingsCard } from './settings-dark-ui-colors'

type GeneralSettingsTab = 'appearance' | 'conversation' | 'directories' | 'desktop'
type DirectorySettingsSubTab = 'workspace' | 'migration' | 'checkpoints'
type DesktopSettingsSubTab = 'command' | 'behavior' | 'logs'

export function GeneralSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
    form,
    kun,
    update,
    updateKun,
    showRuntimeToken,
    setShowRuntimeToken,
    portError,
    selectControlClass,
    openOnboardingPreview,
    pickWorkspace,
    resetWorkspaceToDefault,
    workspacePickerError,
    pickConversationWorkspace,
    resetConversationWorkspaceToDefault,
    conversationWorkspacePickerError,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    compactHomePath,
    expandHomePath,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineBaseUrlInherited,
    effectiveWriteInlineBaseUrl,
    writeInlineModelInherited,
    effectiveWriteInlineModel,
    setWriteDebugModalOpen,
    loadWriteDebugEntries,
    scrollToAgentSection,
    agentsSectionRef,
    skillSectionRef,
    mcpSectionRef,
    permissionsSectionRef,
    selectedSkillRoot,
    skillRootOptions,
    skillRootId,
    setSkillRootId,
    skillNotice,
    openSkillRoot,
    openPlugins,
    mcpConfigPath,
    mcpConfigExists,
    mcpConfigText,
    setMcpConfigText,
    mcpLoading,
    mcpBusy,
    mcpNotice,
    saveMcpConfig,
    loadMcpConfig,
    openMcpConfigDir,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  } = ctx
  const [activeTab, setActiveTab] = useState<GeneralSettingsTab>('appearance')
  const [directorySubTab, setDirectorySubTab] = useState<DirectorySettingsSubTab>('workspace')
  const [desktopSubTab, setDesktopSubTab] = useState<DesktopSettingsSubTab>('command')
  const platform = typeof window !== 'undefined' ? window.kunGui?.platform ?? '' : ''
  const openAtLoginSupported = platform === 'win32' || platform === 'darwin'
  const startMinimizedSupported = platform === 'win32'
  const systemTitleBarSupported = platform === 'linux'
  const desktopBehavior = form.appBehavior
  const closeAction = desktopBehavior.closeAction ?? (desktopBehavior.closeToTray ? 'tray' : 'ask')
  const closeActionOptions: WindowCloseAction[] = ['ask', 'tray', 'quit']
  const fontScale = normalizeUiFontScale(form.uiFontScale)
  const fontScalePercent = Math.round(fontScale * 100)
  const setFontScale = (value: number): void => update({ uiFontScale: normalizeUiFontScale(value) })
  const chatContentMaxWidthPx = normalizeChatContentMaxWidth(form.chatContentMaxWidthPx)
  const setChatContentMaxWidthPx = (value: number): void =>
    update({ chatContentMaxWidthPx: normalizeChatContentMaxWidth(value) })
  const cursorSpotlightColor = form.cursorSpotlightColor
  const darkUiColors = normalizeDarkUiColors(form.darkUiColors)
  const tabs = [
    { id: 'appearance' as const, label: t('generalTabAppearance'), icon: Monitor },
    { id: 'conversation' as const, label: t('generalTabConversation'), icon: MessageSquareText },
    { id: 'directories' as const, label: t('generalTabDirectories'), icon: FolderOpen },
    { id: 'desktop' as const, label: t('generalTabDesktop'), icon: Laptop }
  ]

  return (
    <>
      <SettingsTabs<GeneralSettingsTab>
        baseId="general-settings"
        ariaLabel={t('generalTabsLabel')}
        items={tabs}
        value={activeTab}
        onChange={setActiveTab}
      />

      <SettingsTabPanel
        baseId="general-settings"
        tabId="appearance"
        active={activeTab === 'appearance'}
      >
        <SettingsCard title={t('sectionGeneral')}>
          <SettingRow
            title={t('language')}
            description={t('languageDesc')}
            control={
              <select
                className={selectControlClass}
                value={form.locale}
                onChange={(e) => update({ locale: e.target.value as AppSettingsV1['locale'] })}
              >
                {APP_LOCALE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            }
          />
          <SettingRow
            title={t('theme')}
            description={t('themeDesc')}
            control={
              <select
                className={selectControlClass}
                value={form.theme}
                onChange={(e) => update({ theme: e.target.value as AppSettingsV1['theme'] })}
              >
                <option value="system">{t('themeSystem')}</option>
                <option value="light">{t('themeLight')}</option>
                <option value="dark">{t('themeDark')}</option>
              </select>
            }
          />
          <SettingRow
            title={t('fontScale')}
            description={t('fontScaleDesc')}
            control={
              <div className="w-full min-w-0 space-y-2.5 md:max-w-md">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-[12px] leading-none text-ds-faint" aria-hidden="true">
                    A
                  </span>
                  <input
                    type="range"
                    min={UI_FONT_SCALE_MIN}
                    max={UI_FONT_SCALE_MAX}
                    step={0.01}
                    value={fontScale}
                    aria-label={t('fontScale')}
                    className="w-full accent-accent"
                    onChange={(e) => setFontScale(Number(e.target.value))}
                  />
                  <span className="shrink-0 text-[18px] leading-none text-ds-faint" aria-hidden="true">
                    A
                  </span>
                  <div className="inline-flex shrink-0 items-center rounded-lg border border-ds-border bg-ds-card">
                    <button
                      type="button"
                      aria-label={t('fontScaleSmall')}
                      className="flex h-7 w-7 items-center justify-center rounded-l-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      onClick={() => setFontScale(fontScale - 0.05)}
                    >
                      −
                    </button>
                    <div className="flex h-7 w-[3.75rem] items-center justify-center border-x border-ds-border tabular-nums">
                      <input
                        type="number"
                        min={Math.round(UI_FONT_SCALE_MIN * 100)}
                        max={Math.round(UI_FONT_SCALE_MAX * 100)}
                        step={1}
                        value={fontScalePercent}
                        aria-label={t('fontScale')}
                        className="hide-number-spinner w-8 border-0 bg-transparent p-0 text-center text-[13px] font-medium text-ds-ink outline-none"
                        onChange={(e) => setFontScale(Number(e.target.value) / 100)}
                      />
                      <span className="text-[11px] text-ds-faint">%</span>
                    </div>
                    <button
                      type="button"
                      aria-label={t('fontScaleLarge')}
                      className="flex h-7 w-7 items-center justify-center rounded-r-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      onClick={() => setFontScale(fontScale + 0.05)}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            }
          />
          <SettingRow
            title={t('chatContentMaxWidth')}
            description={t('chatContentMaxWidthDesc')}
            control={
              <div className="w-full min-w-0 space-y-2.5 md:max-w-md">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-[12px] leading-none text-ds-faint" aria-hidden="true">
                    {t('chatContentMaxWidthNarrow')}
                  </span>
                  <input
                    type="range"
                    min={CHAT_CONTENT_MAX_WIDTH_MIN}
                    max={CHAT_CONTENT_MAX_WIDTH_MAX}
                    step={8}
                    value={chatContentMaxWidthPx}
                    aria-label={t('chatContentMaxWidth')}
                    className="w-full accent-accent"
                    onChange={(e) => setChatContentMaxWidthPx(Number(e.target.value))}
                  />
                  <span className="shrink-0 text-[12px] leading-none text-ds-faint" aria-hidden="true">
                    {t('chatContentMaxWidthWide')}
                  </span>
                  <div className="inline-flex shrink-0 items-center rounded-lg border border-ds-border bg-ds-card">
                    <button
                      type="button"
                      aria-label={t('chatContentMaxWidthDecrease')}
                      className="flex h-7 w-7 items-center justify-center rounded-l-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      onClick={() => setChatContentMaxWidthPx(chatContentMaxWidthPx - 32)}
                    >
                      −
                    </button>
                    <div className="flex h-7 min-w-[4.5rem] items-center justify-center border-x border-ds-border px-2 tabular-nums">
                      <input
                        type="number"
                        min={CHAT_CONTENT_MAX_WIDTH_MIN}
                        max={CHAT_CONTENT_MAX_WIDTH_MAX}
                        step={8}
                        value={chatContentMaxWidthPx}
                        aria-label={t('chatContentMaxWidth')}
                        className="hide-number-spinner w-full border-0 bg-transparent p-0 text-center text-[13px] font-medium text-ds-ink outline-none"
                        onChange={(e) => setChatContentMaxWidthPx(Number(e.target.value))}
                      />
                      <span className="text-[11px] text-ds-faint">px</span>
                    </div>
                    <button
                      type="button"
                      aria-label={t('chatContentMaxWidthIncrease')}
                      className="flex h-7 w-7 items-center justify-center rounded-r-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      onClick={() => setChatContentMaxWidthPx(chatContentMaxWidthPx + 32)}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            }
          />
          <SettingRow
            title={t('cursorSpotlight')}
            description={t('cursorSpotlightDesc')}
            wideControl
            control={
              <div className="grid w-full min-w-0 gap-3">
                <div className="flex justify-end">
                  <Toggle
                    checked={form.cursorSpotlight !== false}
                    onChange={(enabled) => update({ cursorSpotlight: enabled })}
                  />
                </div>
                <SpotlightColorControl
                  color={cursorSpotlightColor}
                  disabled={form.cursorSpotlight === false}
                  t={t}
                  onChange={(color) => update({ cursorSpotlightColor: color })}
                />
              </div>
            }
          />
        </SettingsCard>
        <DarkUiColorsSettingsCard
          colors={darkUiColors}
          t={t}
          onChange={(darkUiColors) => update({ darkUiColors })}
        />
      </SettingsTabPanel>

      <GeneralConversationSettingsPanel view={{ t, form, update, selectControlClass, openOnboardingPreview, activeTab }} />

      <SettingsTabPanel
        baseId="general-settings"
        tabId="directories"
        active={activeTab === 'directories'}
      >
        <SettingsSubTabs<DirectorySettingsSubTab>
          baseId="general-directories"
          ariaLabel={t('generalTabDirectories')}
          items={[
            { id: 'workspace', label: t('workspaceRoot'), icon: FolderOpen },
            { id: 'migration', label: t('legacyImportTitle'), icon: FolderInput },
            { id: 'checkpoints', label: t('gitCheckpointTitle'), icon: GitBranch }
          ]}
          value={directorySubTab}
          onChange={setDirectorySubTab}
        />
        <SettingsTabPanel
          baseId="general-directories"
          tabId="workspace"
          active={directorySubTab === 'workspace'}
          className="mt-4"
        >
          <SettingsCard title={t('generalTabDirectories')}>
          <SettingRow
            title={t('workspaceRoot')}
            description={t('workspaceRootDesc')}
            control={
              <div className="grid w-full min-w-0 gap-2 md:max-w-xl">
                <div className="min-w-0">
                  <input
                    className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                    value={compactHomePath(form.workspaceRoot)}
                    onChange={(e) => update({ workspaceRoot: expandHomePath(e.target.value) })}
                    placeholder={t('workspaceRootPlaceholder')}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetWorkspaceToDefault}
                    className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                  >
                    {t('restoreWorkspaceDefault')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void pickWorkspace()}
                    className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                  >
                    {t('browse')}
                  </button>
                </div>
                {workspacePickerError ? (
                  <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                    {workspacePickerError}
                  </p>
                ) : null}
              </div>
            }
          />
          <SettingRow
            title={t('conversationWorkspaceRoot')}
            description={t('conversationWorkspaceRootDesc')}
            control={
              <div className="grid w-full min-w-0 gap-2 md:max-w-xl">
                <div className="min-w-0">
                  <input
                    className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                    value={compactHomePath(form.conversationWorkspaceRoot)}
                    onChange={(e) => update({ conversationWorkspaceRoot: expandHomePath(e.target.value) })}
                    placeholder={t('conversationWorkspaceRootPlaceholder')}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetConversationWorkspaceToDefault}
                    className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                  >
                    {t('restoreConversationWorkspaceDefault')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void pickConversationWorkspace()}
                    className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                  >
                    {t('browse')}
                  </button>
                </div>
                {conversationWorkspacePickerError ? (
                  <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                    {conversationWorkspacePickerError}
                  </p>
                ) : null}
              </div>
            }
          />
          </SettingsCard>
        </SettingsTabPanel>
        <SettingsTabPanel
          baseId="general-directories"
          tabId="migration"
          active={directorySubTab === 'migration'}
          className="mt-4"
        >
          <div className="[&>.ds-settings-card]:mt-0">
            <LegacySessionImportCard t={t} tCommon={tCommon} />
          </div>
        </SettingsTabPanel>
        <SettingsTabPanel
          baseId="general-directories"
          tabId="checkpoints"
          active={directorySubTab === 'checkpoints'}
          className="mt-4"
        >
          <CheckpointSettingsPanel t={t} form={form} update={update} selectControlClass={selectControlClass} />
        </SettingsTabPanel>
      </SettingsTabPanel>

      <GeneralDesktopSettingsPanel view={{
        t, form, update, selectControlClass, logPath, logDirOpenError, setLogDirOpenError,
        compactHomePath, activeTab, desktopSubTab, setDesktopSubTab, openAtLoginSupported,
        startMinimizedSupported, systemTitleBarSupported, desktopBehavior, closeAction, closeActionOptions
      }} />
    </>
  )
}
