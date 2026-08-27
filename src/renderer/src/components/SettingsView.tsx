import {
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type AppSettingsPatch,
  type AppSettingsV1,
  type KunRuntimeSettingsPatchV1
} from '@shared/app-settings'
import {
  getKunRuntimeSettings,
  kunSettingsPatch
} from '@shared/app-settings-kun-defaults'
import { getModelProviderSettings } from '@shared/app-settings-provider-core'
import type { KunProjectConfigFileResult, SkillRootListItem } from '@shared/kun-gui-api'
import type { WriteInlineCompletionDebugEntry } from '@shared/write-inline-completion'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CoreMemoryDiagnosticsJson,
  CoreMemoryRecordJson,
  CoreRuntimeInfoJson,
  CoreRuntimeToolDiagnosticsJson
} from '../agent/kun-contract'
import { useActiveExtensionWorkspaceRoot } from '../extensions/active-extension-workspace'
import { useExtensionSettingsService } from '../extensions/ExtensionSettingsServiceContext'
import {
  isExtensionContributionSnapshotReady,
  useExtensionContributionLoadState,
  useWorkbenchContributions,
  workbenchContextForRoute
} from '../extensions/use-contributions'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import {
  compactHomePathForSettingsDisplay,
  compactHomePathListForSettingsDisplay,
  expandHomePathForSettingsUse,
  expandHomePathListForSettingsUse
} from '../lib/settings-home-paths'
import { defaultConversationWorkspaceRoot } from '../lib/workspace-path'
import { useChatStore } from '../store/chat-store'
import { useSettingsCommandPaletteShortcut } from '../palette/useSettingsCommandPaletteShortcut'
import {
  DEFAULT_WORKSPACE_ROOT,
  hasValidPort,
  listSettingsText,
  mergeSettings,
  splitSettingsList
} from './settings-utils'
import { SettingsViewLayout } from './settings-view-layout'
import type { SettingsSaveIssue } from './settings-save-error'
import {
  settingsCategoryDescriptionKey,
  settingsCategoryLabelKey,
  type SettingsCategory
} from './SettingsSidebar'
import {
  DEFAULT_PROJECT_CONFIG_TEXT,
  useSettingsDomainOperations
} from './use-settings-domain-operations'
import { useSettingsGuiUpdate } from './use-settings-gui-update'
import { useSettingsPersistence } from './use-settings-persistence'
import { useSettingsRouteSynchronization } from './use-settings-route-synchronization'
import { useSettingsViewBootstrap } from './use-settings-view-bootstrap'


type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SettingsPatch = AppSettingsPatch
type InlineNotice = {
  tone: 'success' | 'error' | 'info'
  message: string
}
export function SettingsView(): ReactElement {
  const { t, i18n } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const closeSettings = useChatStore((s) => s.closeSettings)
  useSettingsCommandPaletteShortcut(closeSettings)
  const settingsSection = useChatStore((s) => s.settingsSection)
  const openCode = useChatStore((s) => s.openCode)
  const openInitialSetup = useChatStore((s) => s.openInitialSetup)
  const openPlugins = useChatStore((s) => s.openPlugins)
  const applyI18n = useChatStore((s) => s.applyI18nFromSettings)
  const reloadUiSettings = useChatStore((s) => s.reloadUiSettings)
  const probeRuntime = useChatStore((s) => s.probeRuntime)
  const threads = useChatStore((s) => s.threads)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const extensionWorkspaceRoot = useActiveExtensionWorkspaceRoot()
  const refreshThreads = useChatStore((s) => s.refreshThreads)
  const selectThread = useChatStore((s) => s.selectThread)
  const archiveThread = useChatStore((s) => s.archiveThread)
  const deleteThread = useChatStore((s) => s.deleteThread)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const [category, setCategory] = useState<SettingsCategory>('general')
  const [form, setForm] = useState<AppSettingsV1 | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [workspacePickerError, setWorkspacePickerError] = useState<string | null>(null)
  const [writeWorkspacePickerError, setWriteWorkspacePickerError] = useState<string | null>(null)
  const [conversationWorkspacePickerError, setConversationWorkspacePickerError] = useState<string | null>(null)
  const [clawWorkspacePickerError, setClawWorkspacePickerError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveIssue, setSaveIssue] = useState<SettingsSaveIssue | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showRuntimeToken, setShowRuntimeToken] = useState(false)
  const [logPath, setLogPath] = useState('')
  const [logDirOpenError, setLogDirOpenError] = useState<string | null>(null)
  const [skillRoots, setSkillRoots] = useState<SkillRootListItem[]>([])
  const [skillRootsLoading, setSkillRootsLoading] = useState(false)
  const [skillNotice, setSkillNotice] = useState<InlineNotice | null>(null)
  const [mcpConfigPath, setMcpConfigPath] = useState('~/.kun/mcp.json')
  const [mcpConfigText, setMcpConfigText] = useState('')
  const [mcpConfigExists, setMcpConfigExists] = useState(false)
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpLoaded, setMcpLoaded] = useState(false)
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpNotice, setMcpNotice] = useState<InlineNotice | null>(null)
  const [projectConfig, setProjectConfig] = useState<KunProjectConfigFileResult | null>(null)
  const [projectConfigText, setProjectConfigText] = useState(DEFAULT_PROJECT_CONFIG_TEXT)
  const [projectConfigLoading, setProjectConfigLoading] = useState(false)
  const [projectConfigBusy, setProjectConfigBusy] = useState(false)
  const [projectConfigNotice, setProjectConfigNotice] = useState<InlineNotice | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfoJson | null>(null)
  const [toolDiagnostics, setToolDiagnostics] = useState<CoreRuntimeToolDiagnosticsJson | null>(null)
  const [memoryRecords, setMemoryRecords] = useState<CoreMemoryRecordJson[]>([])
  const [memoryDiagnostics, setMemoryDiagnostics] = useState<CoreMemoryDiagnosticsJson | null>(null)
  const [runtimeDiagnosticsBusy, setRuntimeDiagnosticsBusy] = useState(false)
  const [runtimeDiagnosticsNotice, setRuntimeDiagnosticsNotice] = useState<InlineNotice | null>(null)
  const [agentsSectionReady, setAgentsSectionReady] = useState(false)
  const [writeDebugModalOpen, setWriteDebugModalOpen] = useState(false)
  const [writeCompletionDebugEntries, setWriteCompletionDebugEntries] = useState<WriteInlineCompletionDebugEntry[]>([])
  const [writeCompletionDebugSelectedId, setWriteCompletionDebugSelectedId] = useState<string | null>(null)
  const [writeDebugLoading, setWriteDebugLoading] = useState(false)
  const [writeDebugError, setWriteDebugError] = useState<string | null>(null)
  const extensionSettingsService = useExtensionSettingsService()
  const extensionSettingsContext = useMemo(
    () => workbenchContextForRoute('settings', extensionWorkspaceRoot),
    [extensionWorkspaceRoot]
  )
  const extensionContributionLoadState = useExtensionContributionLoadState()
  const extensionContributionSnapshotReady = isExtensionContributionSnapshotReady(
    extensionContributionLoadState,
    extensionWorkspaceRoot,
    i18n.language
  )
  const extensionSettingsContributions = useWorkbenchContributions(
    'settings',
    extensionSettingsContext,
    extensionContributionSnapshotReady
  )
  const extensionSettingsAvailable = extensionSettingsService !== null &&
    extensionSettingsContributions.length > 0
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const statusTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const draftVersion = useRef(0)
  const settingsScrollerRef = useRef<HTMLDivElement | null>(null)
  // Snapshot of a debounced-but-not-yet-persisted edit, flushed on unmount so
  // exits that bypass goBack() (Esc, route changes, closing settings) don't
  // drop the last edit made within the 450ms debounce window (issue #602).
  const pendingSnapshotRef = useRef<AppSettingsV1 | null>(null)
  const persistedSettingsRef = useRef<AppSettingsV1 | null>(null)
  const flushOnUnmountRef = useRef<() => void>(() => {})
  const agentsSectionRef = useRef<HTMLDivElement | null>(null)
  const skillSectionRef = useRef<HTMLDivElement | null>(null)
  const mcpSectionRef = useRef<HTMLDivElement | null>(null)
  const permissionsSectionRef = useRef<HTMLDivElement | null>(null)
  const formTheme = form?.theme
  const formUiFontScale = form?.uiFontScale
  const formChatContentMaxWidthPx = form?.chatContentMaxWidthPx
  const writeTypography = form?.write?.typography
  const formKun = form ? getKunRuntimeSettings(form) : null
  const formPort = formKun?.port
  const formGuiUpdateChannel = form?.guiUpdate?.channel
  const formCursorSpotlight = form?.cursorSpotlight
  const formCursorSpotlightColor = form?.cursorSpotlightColor
  const formDarkUiColors = form?.darkUiColors
  const markAgentsSectionReady = useCallback(() => setAgentsSectionReady(true), [])
  const settingsPlatform = typeof window !== 'undefined' ? window.kunGui?.platform ?? '' : ''
  const settingsHomeDir = typeof window !== 'undefined' ? window.kunGui?.homeDir ?? '' : ''
  const categoryTitle = t(settingsCategoryLabelKey(category))
  const categoryDescription = t(settingsCategoryDescriptionKey(category))
  const compactHomePath = useCallback((value: string): string =>
    compactHomePathForSettingsDisplay(value, settingsHomeDir, settingsPlatform), [settingsHomeDir, settingsPlatform])
  const expandHomePath = useCallback((value: string): string =>
    expandHomePathForSettingsUse(value, settingsHomeDir, settingsPlatform), [settingsHomeDir, settingsPlatform])
  const compactHomePathList = useCallback((values: readonly string[]): string =>
    compactHomePathListForSettingsDisplay(values, settingsHomeDir, settingsPlatform), [settingsHomeDir, settingsPlatform])
  const expandHomePathList = useCallback((values: readonly string[]): string[] =>
    expandHomePathListForSettingsUse(values, settingsHomeDir, settingsPlatform), [settingsHomeDir, settingsPlatform])
  const activeProjectWorkspaceRoot = useMemo(
    () => expandHomePath(workspaceRoot || form?.workspaceRoot || ''),
    [expandHomePath, form?.workspaceRoot, workspaceRoot]
  )
  const projectConfigGrantFingerprint = useMemo(
    () => JSON.stringify(formKun?.projectConfig.grants ?? []),
    [formKun?.projectConfig.grants]
  )
  const {
    checkingGuiUpdate,
    checkGuiUpdate,
    downloadingGuiUpdate,
    downloadGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateError,
    guiUpdateInfo,
    guiUpdateProgress,
    installingGuiUpdate,
    installGuiUpdate,
    resetGuiUpdateState
  } = useSettingsGuiUpdate({
    category: category === 'extensions' ? 'general' : category,
    channel: formGuiUpdateChannel,
    form,
    t
  })

  const { loadWriteDebugEntries } = useSettingsViewBootstrap({
    category, setCategory, form, setForm, setLoadError, setLogPath,
    setWriteCompletionDebugEntries, setWriteCompletionDebugSelectedId, setWriteDebugLoading,
    setWriteDebugError, extensionContributionSnapshotReady, extensionSettingsAvailable,
    settingsScrollerRef, persistedSettingsRef, formTheme, formUiFontScale,
    formChatContentMaxWidthPx, writeTypography, formCursorSpotlight, formCursorSpotlightColor,
    formDarkUiColors
  })

  useSettingsRouteSynchronization({
    settingsSection, category, setCategory, form, agentsSectionReady, agentsSectionRef,
    skillSectionRef, mcpSectionRef, permissionsSectionRef
  })

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
      // Persist any debounced edit that hasn't been flushed yet (issue #602).
      flushOnUnmountRef.current()
    }
  }, [])

  const portError = useMemo(() => {
    if (!form || typeof formPort !== 'number') return null
    if (!hasValidPort(form)) return t('portInvalid')
    return null
  }, [form, formPort, t])

  const { scheduleSave, flushPendingSave, goBack, openOnboardingPreview } = useSettingsPersistence({
    closeSettings, openInitialSetup, applyI18n, reloadUiSettings, probeRuntime, form, setForm,
    setSaveStatus, setSaveError, setSaveIssue, saveTimer, statusTimer, draftVersion, pendingSnapshotRef,
    persistedSettingsRef, flushOnUnmountRef, settingsPlatform, settingsHomeDir
  })

  const update = useCallback((partial: SettingsPatch): void => {
    if (!form) return
    const next = mergeSettings(form, partial)
    setForm(next)
    if (partial.locale) void applyI18n(partial.locale)
    if (partial.guiUpdate?.channel && partial.guiUpdate.channel !== form.guiUpdate.channel) {
      resetGuiUpdateState()
    }
    scheduleSave(next)
  }, [applyI18n, form, resetGuiUpdateState, scheduleSave])

  const {
    loadMcpConfig, openSkillRoot, toggleSkillRoot, saveMcpConfig, openMcpConfigDir,
    loadProjectConfig, saveProjectConfig, setProjectConfigTrust, openProjectConfigDir,
    refreshKunDiagnostics, createMemoryRecord, updateMemoryRecord, disableMemoryRecord,
    restoreMemoryRecord, deleteMemoryRecord, scrollToAgentSection
  } = useSettingsDomainOperations({
    t, reloadUiSettings, category, form, setForm, setSkillRoots, setSkillRootsLoading,
    setSkillNotice, setMcpConfigPath, mcpConfigText, setMcpConfigText, setMcpConfigExists,
    mcpLoading, setMcpLoading, mcpLoaded, setMcpLoaded, setMcpBusy, setMcpNotice,
    projectConfig, setProjectConfig, projectConfigText, setProjectConfigText,
    setProjectConfigLoading, setProjectConfigBusy, setProjectConfigNotice, runtimeInfo,
    setRuntimeInfo, toolDiagnostics, setToolDiagnostics, memoryRecords, setMemoryRecords,
    setMemoryDiagnostics, setRuntimeDiagnosticsBusy, runtimeDiagnosticsNotice,
    setRuntimeDiagnosticsNotice, persistedSettingsRef, agentsSectionRef, skillSectionRef,
    mcpSectionRef, permissionsSectionRef, compactHomePath, expandHomePath,
    activeProjectWorkspaceRoot, projectConfigGrantFingerprint, update
  })

  if (loadError) {
    const msg =
      loadError === 'PRELOAD_BRIDGE' ? t('preloadBridgeError') : t('loadFailed', { message: loadError })
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-ds-main p-6 text-center">
        <p className="max-w-md text-sm text-red-700 dark:text-red-300">{msg}</p>
        <button
          type="button"
          className="rounded-xl bg-ds-userbubble px-4 py-2 text-sm font-medium text-ds-userbubbleFg"
          onClick={goBack}
        >
          {t('back')}
        </button>
      </div>
    )
  }

  if (!form) {
    return (
      <div className="flex h-full items-center justify-center bg-ds-main text-ds-faint">
        {t('loading')}
      </div>
    )
  }

  const kun = getKunRuntimeSettings(form)
  const provider = getModelProviderSettings(form)

  const sharedApiKey = provider.apiKey
  const sharedBaseUrl = provider.baseUrl
  const writeInlineApiKeyInherited = !form.write.inlineCompletion.apiKey.trim()
  const writeInlineBaseUrlInherited =
    !form.write.inlineCompletion.baseUrl.trim() ||
    form.write.inlineCompletion.baseUrl.trim() === DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL
  const writeInlineModelInherited = form.write.inlineCompletion.inheritModel !== false
  const effectiveWriteInlineBaseUrl = resolveWriteInlineCompletionBaseUrl(form)
  const effectiveWriteInlineApiKey = resolveWriteInlineCompletionApiKey(form)
  const effectiveWriteInlineModel = resolveWriteInlineCompletionModel(form)
  const updateSharedCredential = (patch: { apiKey?: string; baseUrl?: string }): void => {
    update({ provider: patch })
  }

  const updateKun = (patch: KunRuntimeSettingsPatchV1): void => {
    update({ agents: kunSettingsPatch(patch) })
  }

  const pickWorkspace = async (): Promise<void> => {
    try {
      setWorkspacePickerError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(expandHomePath(form.workspaceRoot) || undefined)
      if (!picked.canceled && picked.path) {
        update({ workspaceRoot: picked.path })
      }
    } catch (e) {
      setWorkspacePickerError(formatWorkspacePickerError(e))
    }
  }

  const resetWorkspaceToDefault = (): void => {
    setWorkspacePickerError(null)
    update({ workspaceRoot: expandHomePath(DEFAULT_WORKSPACE_ROOT) })
  }

  const pickConversationWorkspace = async (): Promise<void> => {
    try {
      setConversationWorkspacePickerError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(
        expandHomePath(form.conversationWorkspaceRoot || defaultConversationWorkspaceRoot())
      )
      if (!picked.canceled && picked.path) {
        update({ conversationWorkspaceRoot: picked.path })
      }
    } catch (e) {
      setConversationWorkspacePickerError(formatWorkspacePickerError(e))
    }
  }

  const resetConversationWorkspaceToDefault = (): void => {
    setConversationWorkspacePickerError(null)
    update({ conversationWorkspaceRoot: expandHomePath(defaultConversationWorkspaceRoot()) })
  }

  const pickWriteWorkspace = async (): Promise<void> => {
    try {
      setWriteWorkspacePickerError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(
        expandHomePath(form.write.defaultWorkspaceRoot || DEFAULT_WRITE_WORKSPACE_ROOT)
      )
      if (!picked.canceled && picked.path) {
        const workspaces = [
          picked.path,
          form.write.activeWorkspaceRoot,
          ...form.write.workspaces
        ].filter((value, index, list) => value.trim() && list.indexOf(value) === index)
        update({
          write: {
            defaultWorkspaceRoot: picked.path,
            activeWorkspaceRoot: picked.path,
            workspaces
          }
        })
      }
    } catch (e) {
      setWriteWorkspacePickerError(formatWorkspacePickerError(e))
    }
  }

  const resetWriteWorkspaceToDefault = (): void => {
    setWriteWorkspacePickerError(null)
    const workspaceRoot = expandHomePath(DEFAULT_WRITE_WORKSPACE_ROOT)
    update({
      write: {
        defaultWorkspaceRoot: workspaceRoot,
        activeWorkspaceRoot: workspaceRoot,
        workspaces: [workspaceRoot, ...form.write.workspaces]
      }
    })
  }

  const pickClawWorkspace = async (): Promise<void> => {
    try {
      setClawWorkspacePickerError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(
        expandHomePath(form.claw.im.workspaceRoot || form.workspaceRoot) || undefined
      )
      if (!picked.canceled && picked.path) {
        update({ claw: { im: { workspaceRoot: picked.path } } })
      }
    } catch (e) {
      setClawWorkspacePickerError(formatWorkspacePickerError(e))
    }
  }

  const resetClawWorkspaceToDefault = (): void => {
    setClawWorkspacePickerError(null)
    update({ claw: { im: { workspaceRoot: '' } } })
  }

  const clearWriteDebugEntries = async (): Promise<void> => {
    setWriteDebugLoading(true)
    setWriteDebugError(null)
    try {
      if (typeof window.kunGui?.clearWriteInlineCompletionDebugEntries === 'function') {
        await window.kunGui.clearWriteInlineCompletionDebugEntries()
      }
      setWriteCompletionDebugEntries([])
      setWriteCompletionDebugSelectedId(null)
    } catch (error) {
      setWriteDebugError(error instanceof Error ? error.message : String(error))
    } finally {
      setWriteDebugLoading(false)
    }
  }

  const selectControlClass =
    'w-full min-w-0 rounded-full border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/15'

  const settingsSectionContext = {
    t,
    tCommon,
    openStorageSettings: () => setCategory('storage'),
    settingsSection,
    form,
    provider,
    kun,
    saveStatus,
    saveError,
    saveIssue,
    retrySave: () => { void flushPendingSave() },
    update,
    updateKun,
    updateSharedCredential,
    sharedApiKey,
    sharedBaseUrl,
    showApiKey,
    setShowApiKey,
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
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    compactHomePath,
    expandHomePath,
    compactHomePathList,
    expandHomePathList,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineApiKeyInherited,
    effectiveWriteInlineApiKey,
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
    skillRoots,
    skillRootsLoading,
    toggleSkillRoot,
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
    activeProjectWorkspaceRoot,
    projectConfig,
    projectConfigText,
    setProjectConfigText,
    projectConfigLoading,
    projectConfigBusy,
    projectConfigNotice,
    loadProjectConfig,
    saveProjectConfig,
    setProjectConfigTrust,
    openProjectConfigDir,
    runtimeInfo,
    toolDiagnostics,
    memoryRecords,
    memoryDiagnostics,
    runtimeDiagnosticsBusy,
    runtimeDiagnosticsNotice,
    refreshKunDiagnostics,
    createMemoryRecord,
    updateMemoryRecord,
    disableMemoryRecord,
    restoreMemoryRecord,
    deleteMemoryRecord,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    addClawChannel,
    splitSettingsList,
    listSettingsText,
    threads,
    runtimeReady: runtimeConnection === 'ready',
    locale: form.locale,
    refreshThreads,
    openCode,
    selectThread,
    archiveThread,
    deleteThread
  }

  return <SettingsViewLayout view={{
    t, workspaceRoot, extensionWorkspaceRoot, category, setCategory, saveStatus, saveError, saveIssue,
    writeDebugModalOpen, setWriteDebugModalOpen, writeCompletionDebugEntries,
    writeCompletionDebugSelectedId, setWriteCompletionDebugSelectedId, writeDebugLoading,
    writeDebugError, extensionSettingsService, extensionSettingsContributions,
    extensionSettingsAvailable, settingsScrollerRef, markAgentsSectionReady, categoryTitle,
    categoryDescription, loadWriteDebugEntries, portError, flushPendingSave, goBack,
    clearWriteDebugEntries, settingsSectionContext
  }} />
}
