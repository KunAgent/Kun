import type { ComponentProps, ReactElement } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  kunSettingsPatch,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  type AppSettingsPatch,
  getActiveAgentApiKey,
  getKunRuntimeSettings,
  getModelProviderSettings,
  isKunRuntimeInsecure,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type AppSettingsV1,
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { getProvider } from '../agent/registry'
import type {
  CoreMemoryDiagnosticsJson,
  CoreMemoryRecordJson,
  CoreRuntimeInfoJson,
  CoreRuntimeToolDiagnosticsJson
} from '../agent/kun-contract'
import type { WriteInlineCompletionDebugEntry } from '@shared/write-inline-completion'
import {
  applyChatContentMaxWidth,
  applyCursorSpotlight,
  applyCursorSpotlightColor,
  applyTheme,
  applyUiFontScale,
  applyWriteTypography
} from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import type { SkillRootListItem } from '@shared/kun-gui-api'
import { defaultConversationWorkspaceRoot, normalizeWorkspaceRoot } from '../lib/workspace-path'
import {
  compactHomePathForSettingsDisplay,
  compactHomePathListForSettingsDisplay,
  expandHomePathForSettingsUse,
  expandHomePathListForSettingsUse,
  expandSettingsHomePathsForUse
} from '../lib/settings-home-paths'
import { useChatStore, type SettingsRouteSection } from '../store/chat-store'
import { SettingsSidebar } from './SettingsSidebar'
import { useSettingsGuiUpdate } from './use-settings-gui-update'
import {
  DEFAULT_WORKSPACE_ROOT,
  coerceRendererSettings,
  hasValidPort,
  listSettingsText,
  mergeSettings,
  splitSettingsList
} from './settings-utils'
import { loadKunDiagnostics } from '../lib/load-kun-diagnostics'
import { SETTINGS_CHANGED_EVENT, emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import { confirmDialog } from '../lib/confirm-dialog'
import { GeneralSettingsSection } from './settings-section-general'

const ProvidersSettingsSection = lazy(() =>
  import('./settings-section-providers').then((module) => ({ default: module.ProvidersSettingsSection }))
)
const WriteSettingsSection = lazy(() =>
  import('./settings-section-write').then((module) => ({ default: module.WriteSettingsSection }))
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

type SettingsCategory = 'general' | 'providers' | 'write' | 'mediaGeneration' | 'speechToText' | 'agents' | 'archives' | 'permissions' | 'worktree' | 'memory' | 'shortcuts' | 'easterEgg' | 'claw' | 'updates' | 'debug' | 'terminal'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SettingsPatch = AppSettingsPatch
type InlineNotice = {
  tone: 'success' | 'error' | 'info'
  message: string
}
export function SettingsView(): ReactElement {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const setRoute = useChatStore((s) => s.setRoute)
  const settingsReturnRoute = useChatStore((s) => s.settingsReturnRoute)
  const settingsSection = useChatStore((s) => s.settingsSection)
  const openCode = useChatStore((s) => s.openCode)
  const openWrite = useChatStore((s) => s.openWrite)
  const openClaw = useChatStore((s) => s.openClaw)
  const openSchedule = useChatStore((s) => s.openSchedule)
  const openInitialSetup = useChatStore((s) => s.openInitialSetup)
  const openPlugins = useChatStore((s) => s.openPlugins)
  const applyI18n = useChatStore((s) => s.applyI18nFromSettings)
  const reloadUiSettings = useChatStore((s) => s.reloadUiSettings)
  const probeRuntime = useChatStore((s) => s.probeRuntime)
  const threads = useChatStore((s) => s.threads)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
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
  const initializedCategory = useRef(false)
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const statusTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const draftVersion = useRef(0)
  // Snapshot of a debounced-but-not-yet-persisted edit, flushed on unmount so
  // exits that bypass goBack() (Esc, route changes, closing settings) don't
  // drop the last edit made within the 450ms debounce window (issue #602).
  const pendingSnapshotRef = useRef<AppSettingsV1 | null>(null)
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
  const markAgentsSectionReady = useCallback(() => setAgentsSectionReady(true), [])
  const settingsPlatform = typeof window !== 'undefined' ? window.kunGui?.platform ?? '' : ''
  const settingsHomeDir = typeof window !== 'undefined' ? window.kunGui?.homeDir ?? '' : ''
  const compactHomePath = useCallback((value: string): string =>
    compactHomePathForSettingsDisplay(value, settingsHomeDir, settingsPlatform), [settingsHomeDir, settingsPlatform])
  const expandHomePath = useCallback((value: string): string =>
    expandHomePathForSettingsUse(value, settingsHomeDir, settingsPlatform), [settingsHomeDir, settingsPlatform])
  const compactHomePathList = useCallback((values: readonly string[]): string =>
    compactHomePathListForSettingsDisplay(values, settingsHomeDir, settingsPlatform), [settingsHomeDir, settingsPlatform])
  const expandHomePathList = useCallback((values: readonly string[]): string[] =>
    expandHomePathListForSettingsUse(values, settingsHomeDir, settingsPlatform), [settingsHomeDir, settingsPlatform])
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
    category,
    channel: formGuiUpdateChannel,
    form,
    t
  })

  useEffect(() => {
    let cancelled = false
    if (typeof window.kunGui === 'undefined') {
      setLoadError('PRELOAD_BRIDGE')
      return
    }
    void rendererRuntimeClient
      .getSettings({ forceRefresh: true })
      .then((s) => {
        if (!cancelled) setForm(coerceRendererSettings(s))
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!formTheme || formUiFontScale == null || formChatContentMaxWidthPx == null) return
    applyTheme(formTheme)
    applyUiFontScale(formUiFontScale)
    applyChatContentMaxWidth(formChatContentMaxWidthPx)
  }, [formTheme, formUiFontScale, formChatContentMaxWidthPx])

  useEffect(() => {
    if (typeof formCursorSpotlight === 'boolean') {
      applyCursorSpotlight(formCursorSpotlight)
    }
    applyCursorSpotlightColor(formCursorSpotlightColor)
  }, [formCursorSpotlight, formCursorSpotlightColor])

  // Live-preview the Write editor typography as the form changes, mirroring the
  // theme/scale preview above. Keyed on the scalar fields so it only re-applies
  // on real changes.
  useEffect(() => {
    if (writeTypography) applyWriteTypography(writeTypography)
  }, [
    writeTypography?.fontPreset,
    writeTypography?.customFontFamily,
    writeTypography?.fontSizePx,
    writeTypography?.lineHeight
  ])

  useEffect(() => {
    const onSettingsChanged = (event: Event): void => {
      const next = (event as CustomEvent<AppSettingsV1>).detail
      if (next) setForm(coerceRendererSettings(next))
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [])

  useEffect(() => {
    if (typeof window.kunGui?.getLogPath !== 'function') return
    void window.kunGui.getLogPath().then((p) => setLogPath(p)).catch(() => undefined)
  }, [category])

  const loadWriteDebugEntries = useCallback(async (): Promise<void> => {
    setWriteDebugLoading(true)
    setWriteDebugError(null)
    try {
      const completionEntries = typeof window.kunGui?.listWriteInlineCompletionDebugEntries === 'function'
        ? await window.kunGui.listWriteInlineCompletionDebugEntries()
        : []
      setWriteCompletionDebugEntries(completionEntries)
      setWriteCompletionDebugSelectedId((current) =>
        current && completionEntries.some((entry) => entry.id === current)
          ? current
          : completionEntries[0]?.id ?? null
      )
    } catch (error) {
      setWriteDebugError(error instanceof Error ? error.message : String(error))
    } finally {
      setWriteDebugLoading(false)
    }
  }, [])

  useEffect(() => {
    if (category !== 'write') return
    void loadWriteDebugEntries()
  }, [category, loadWriteDebugEntries])

  useEffect(() => {
    if (!form || initializedCategory.current) return
    initializedCategory.current = true
    if (!getActiveAgentApiKey(form).trim()) {
      setCategory('providers')
    }
  }, [form])

  useEffect(() => {
    if (settingsSection === 'general') {
      setCategory('general')
      return
    }
    if (settingsSection === 'providers') {
      setCategory('providers')
      return
    }
    if (settingsSection === 'write') {
      setCategory('write')
      return
    }
    if (settingsSection === 'imageGeneration') {
      setCategory('mediaGeneration')
      return
    }
    if (settingsSection === 'mediaGeneration') {
      setCategory('mediaGeneration')
      return
    }
    if (settingsSection === 'speechToText') {
      setCategory('speechToText')
      return
    }
    if (settingsSection === 'permissions') {
      setCategory('agents')
      return
    }
    if (settingsSection === 'archives') {
      setCategory('archives')
      return
    }
    if (settingsSection === 'claw') {
      setCategory('claw')
      return
    }
    if (settingsSection === 'shortcuts') {
      setCategory('shortcuts')
      return
    }
    if (settingsSection === 'easterEgg') {
      setCategory('easterEgg')
      return
    }
    if (settingsSection === 'updates') {
      setCategory('updates')
      return
    }
    if (settingsSection === 'terminal') {
      setCategory('terminal')
      return
    }
    setCategory('agents')
  }, [settingsSection])

  useEffect(() => {
    if (!form) return
    if (
      settingsSection === 'general' ||
      settingsSection === 'providers' ||
      settingsSection === 'write' ||
      settingsSection === 'imageGeneration' ||
      settingsSection === 'mediaGeneration' ||
      settingsSection === 'speechToText' ||
      settingsSection === 'archives' ||
      settingsSection === 'claw' ||
      settingsSection === 'shortcuts' ||
      settingsSection === 'easterEgg' ||
      settingsSection === 'updates' ||
      settingsSection === 'terminal' ||
      category !== 'agents'
    ) {
      return
    }
    if (!agentsSectionReady) return
    const refs: Record<
      Exclude<SettingsRouteSection, 'general' | 'providers' | 'write' | 'imageGeneration' | 'mediaGeneration' | 'speechToText' | 'archives' | 'claw' | 'shortcuts' | 'easterEgg' | 'updates' | 'terminal'>,
      HTMLDivElement | null
    > = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: mcpSectionRef.current,
      permissions: permissionsSectionRef.current
    }
    const target = refs[settingsSection]
    if (!target) return
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [agentsSectionReady, category, form, settingsSection])

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

  const refreshSkillRoots = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.listSkillRoots !== 'function') return
    setSkillRootsLoading(true)
    try {
      // Settings is global: list every configured skill root from persisted
      // settings, not the sidebar's currently selected project workspace.
      const result = await window.kunGui.listSkillRoots()
      if (result.ok) setSkillRoots(result.roots)
    } catch {
      /* listing skill roots is best-effort; keep the last known list */
    } finally {
      setSkillRootsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (category !== 'agents') return
    void refreshSkillRoots()
  }, [category, refreshSkillRoots])

  const loadMcpConfig = async (): Promise<void> => {
    if (typeof window.kunGui?.getKunConfigFile !== 'function') return
    setMcpLoading(true)
    setMcpNotice(null)
    try {
      const config = await window.kunGui.getKunConfigFile()
      setMcpConfigPath(config.path)
      setMcpConfigText(config.content)
      setMcpConfigExists(config.exists)
      setMcpLoaded(true)
    } catch (e) {
      setMcpNotice({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setMcpLoading(false)
    }
  }

  useEffect(() => {
    if (category !== 'agents' || mcpLoaded || mcpLoading) return
    void loadMcpConfig()
  }, [category, mcpLoaded, mcpLoading])

  const openSkillRoot = async (path: string): Promise<void> => {
    if (!path) {
      setSkillNotice({ tone: 'error', message: t('skillsRootUnavailable') })
      return
    }
    if (typeof window.kunGui?.openSkillRoot !== 'function') return
    setSkillNotice(null)
    const result = await window.kunGui.openSkillRoot(path)
    if (!result.ok) {
      setSkillNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const toggleSkillRoot = (root: SkillRootListItem, enabled: boolean): void => {
    const current = form?.claw.skills.disabledDirs ?? []
    const keys = new Set([root.disableKey, root.id])
    const nextDisabled = enabled
      ? current.filter((entry) => !keys.has(entry))
      : [...new Set([...current, root.disableKey])]
    update({ claw: { skills: { disabledDirs: nextDisabled } } })
    // Optimistically reflect the toggle so the row responds before the
    // debounced save round-trips; skill counts are unaffected by toggling.
    setSkillRoots((roots) =>
      roots.map((item) =>
        item.id === root.id && item.path === root.path ? { ...item, enabled } : item
      )
    )
  }

  const saveMcpConfig = async (): Promise<void> => {
    if (typeof window.kunGui?.setKunConfigFile !== 'function') return
    setMcpBusy(true)
    setMcpNotice(null)
    try {
      const result = await window.kunGui.setKunConfigFile(mcpConfigText)
      setMcpConfigPath(result.path)
      setMcpConfigExists(true)
      setMcpNotice({
        tone: 'success',
        message: t('mcpSaved', { path: compactHomePath(result.path) })
      })
    } catch (e) {
      setMcpNotice({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setMcpBusy(false)
    }
  }

  const openMcpConfigDir = async (): Promise<void> => {
    if (typeof window.kunGui?.openKunConfigDir !== 'function') return
    const result = await window.kunGui.openKunConfigDir()
    if (!result.ok) {
      setMcpNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const refreshKunDiagnostics = useCallback(async (): Promise<void> => {
    const provider = getProvider()
    setRuntimeDiagnosticsBusy(true)
    setRuntimeDiagnosticsNotice(null)
    try {
      const loaded = await loadKunDiagnostics(provider, { listAllMemories: true })
      if (loaded.runtimeInfo !== undefined) setRuntimeInfo(loaded.runtimeInfo)
      if (loaded.toolDiagnostics !== undefined) setToolDiagnostics(loaded.toolDiagnostics)
      if (loaded.memoryRecords !== undefined) setMemoryRecords(loaded.memoryRecords)
      if (loaded.errors.length > 0) {
        setRuntimeDiagnosticsNotice({
          tone: 'error',
          message: loaded.errors.join(' | ')
        })
      }
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setRuntimeDiagnosticsBusy(false)
    }
  }, [])

  useEffect(() => {
    if (category !== 'agents' && category !== 'memory') return
    void refreshKunDiagnostics()
  }, [category, refreshKunDiagnostics])

  const refreshMemoryDiagnostics = async (): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.getMemoryDiagnostics !== 'function') return
    try {
      const diagnostics = await provider.getMemoryDiagnostics()
      setMemoryDiagnostics(diagnostics)
    } catch {
      // best-effort; surfaced via runtimeDiagnosticsNotice elsewhere
    }
  }

  useEffect(() => {
    if (category !== 'memory') return
    void refreshMemoryDiagnostics()
  }, [category, memoryRecords])

  const memoryMutationWorkspace = useCallback((memoryId: string): string | undefined => {
    const record = memoryRecords.find((item) => item.id === memoryId)
    if (!record || record.scope === 'user') return undefined
    if (record.scope === 'project') {
      return record.project ?? record.workspace
    }
    return record.workspace
  }, [memoryRecords])

  const createMemoryRecord = async (input: {
    content: string
    scope?: 'user' | 'workspace' | 'project'
    targetPath?: string
    tags?: string[]
    confidence?: number
  }): Promise<boolean> => {
    const provider = getProvider()
    if (typeof provider.createMemory !== 'function') return false
    try {
      const workspace = normalizeWorkspaceRoot(expandHomePath(input.targetPath ?? ''))
      const memory = await provider.createMemory({
        content: input.content,
        scope: input.scope,
        tags: input.tags,
        confidence: input.confidence,
        ...(input.scope === 'user' ? {} : { workspace }),
        ...(input.scope === 'project' ? { project: workspace } : {})
      })
      setMemoryRecords((records) => [memory, ...records])
      return true
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const updateMemoryRecord = async (
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; disabled?: boolean }
  ): Promise<boolean> => {
    const provider = getProvider()
    if (typeof provider.updateMemory !== 'function') return false
    try {
      const memory = await provider.updateMemory(memoryId, patch, {
        workspace: memoryMutationWorkspace(memoryId)
      })
      setMemoryRecords((records) => records.map((record) => (record.id === memoryId ? memory : record)))
      return true
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const setMemoryRecordDisabled = async (memoryId: string, disabled: boolean): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.updateMemory !== 'function') return
    try {
      const memory = await provider.updateMemory(memoryId, { disabled }, {
        workspace: memoryMutationWorkspace(memoryId)
      })
      setMemoryRecords((records) => records.map((record) => record.id === memoryId ? memory : record))
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const disableMemoryRecord = async (memoryId: string): Promise<void> => {
    const confirmed = await confirmDialog(
      t('memoryDisableConfirm'),
      t('memoryDisableConfirmDetail')
    )
    if (!confirmed) return
    await setMemoryRecordDisabled(memoryId, true)
  }

  const restoreMemoryRecord = async (memoryId: string): Promise<void> => {
    await setMemoryRecordDisabled(memoryId, false)
  }

  const deleteMemoryRecord = async (memoryId: string): Promise<void> => {
    const confirmed = await confirmDialog(
      t('memoryDeleteConfirm'),
      t('memoryDeleteConfirmDetail')
    )
    if (!confirmed) return
    const provider = getProvider()
    if (typeof provider.deleteMemory !== 'function') return
    try {
      await provider.deleteMemory(memoryId, {
        workspace: memoryMutationWorkspace(memoryId)
      })
      setMemoryRecords((records) => records.filter((record) => record.id !== memoryId))
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const scrollToAgentSection = (target: 'agents' | 'skill' | 'mcp' | 'permissions'): void => {
    const refs = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: mcpSectionRef.current,
      permissions: permissionsSectionRef.current
    }
    refs[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const persistSettings = async (snapshot: AppSettingsV1, version: number): Promise<void> => {
    if (!hasValidPort(snapshot)) return
    setSaveStatus('saving')
    setSaveError(null)

    try {
      const next = coerceRendererSettings(
        await rendererRuntimeClient.setSettings(
          expandSettingsHomePathsForUse(snapshot, settingsHomeDir, settingsPlatform)
        )
      )
      if (version !== draftVersion.current) return

      setForm(next)
      emitRendererSettingsChanged(next)
      await applyI18n(next.locale)
      void reloadUiSettings()
      void probeRuntime('background')
      if (version !== draftVersion.current) return

      setSaveStatus('saved')
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
      statusTimer.current = window.setTimeout(() => {
        if (version === draftVersion.current) setSaveStatus('idle')
        statusTimer.current = null
      }, 1500)
    } catch (e) {
      if (version !== draftVersion.current) return
      const message = e instanceof Error ? e.message : String(e)
      setSaveError(message)
      setSaveStatus('error')
      void window.kunGui?.logError?.('settings', 'Failed to apply settings', { message }).catch(() => undefined)
    }
  }

  const scheduleSave = (next: AppSettingsV1): void => {
    draftVersion.current += 1
    const version = draftVersion.current

    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    if (statusTimer.current) window.clearTimeout(statusTimer.current)
    statusTimer.current = null
    setSaveError(null)

    if (!hasValidPort(next)) {
      pendingSnapshotRef.current = null
      setSaveStatus('idle')
      return
    }

    pendingSnapshotRef.current = next
    setSaveStatus('saving')
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      pendingSnapshotRef.current = null
      void persistSettings(next, version)
    }, 450)
  }

  const flushPendingSave = async (): Promise<void> => {
    pendingSnapshotRef.current = null
    if (!form || !hasValidPort(form)) return
    draftVersion.current += 1
    const version = draftVersion.current

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (statusTimer.current) {
      window.clearTimeout(statusTimer.current)
      statusTimer.current = null
    }

    await persistSettings(form, version)
  }

  // Recomputed every render so the unmount cleanup always sees current values.
  // Persists the pending snapshot directly over IPC (no React state writes,
  // since the component is unmounting) and broadcasts the change so other
  // surfaces stay in sync.
  flushOnUnmountRef.current = (): void => {
    const snapshot = pendingSnapshotRef.current
    pendingSnapshotRef.current = null
    if (!snapshot || !hasValidPort(snapshot)) return
    void rendererRuntimeClient
      .setSettings(expandSettingsHomePathsForUse(snapshot, settingsHomeDir, settingsPlatform))
      .then((saved) => {
        const next = coerceRendererSettings(saved)
        emitRendererSettingsChanged(next)
        // App-wide effects the normal save path runs, so a last-moment locale or
        // UI-token edit still takes effect immediately rather than on next start.
        void applyI18n(next.locale)
        void reloadUiSettings()
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        void window.kunGui?.logError?.('settings', 'Failed to flush settings on unmount', { message }).catch(
          () => undefined
        )
      })
  }

  const goBack = (): void => {
    void (async () => {
      await flushPendingSave()
      await reloadUiSettings()
      if (settingsReturnRoute === 'write') {
        await openWrite()
        return
      }
      if (settingsReturnRoute === 'claw') {
        openClaw()
        return
      }
      if (settingsReturnRoute === 'schedule') {
        openSchedule()
        return
      }
      if (settingsReturnRoute === 'plugins') {
        setRoute('plugins')
        return
      }
      await openCode()
    })()
  }

  const openOnboardingPreview = (): void => {
    void (async () => {
      await flushPendingSave()
      openInitialSetup('preview')
    })()
  }

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
  const activeApiKey = getActiveAgentApiKey(form)

  const update = (partial: SettingsPatch): void => {
    const next = mergeSettings(form, partial)
    setForm(next)
    if (partial.locale) void applyI18n(partial.locale)
    if (partial.guiUpdate?.channel && partial.guiUpdate.channel !== form.guiUpdate.channel) {
      resetGuiUpdateState()
    }
    scheduleSave(next)
  }

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

  const updateKun = (patch: Partial<AppSettingsV1['agents']['kun']>): void => {
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
    'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

  const settingsSectionContext = {
    t,
    tCommon,
    form,
    provider,
    kun,
    activeApiKey,
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

  return (
    <div className="ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main">
      <SettingsSidebar category={category} setCategory={setCategory} goBack={goBack} t={t} />

      <div className="ds-no-drag min-h-0 min-w-0 flex-1 overflow-y-auto px-10 py-10">
        <div className="mx-auto max-w-3xl">
          {!activeApiKey.trim() ? (
            <div className="mb-6 rounded-2xl border border-amber-300/80 bg-amber-50/95 px-5 py-4 text-amber-950 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
              <div className="text-[15px] font-semibold">{t('apiKeyRequiredTitle')}</div>
              <p className="mt-1 text-[13px] leading-6 text-amber-900/90 dark:text-amber-100/90">
                {t('apiKeyRequiredBody')}
              </p>
            </div>
          ) : null}

          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ds-ink">{t('title')}</h1>
              <p className="mt-1 text-[14px] text-ds-muted">{t('subtitle')}</p>
            </div>
            <span
              title={saveStatus === 'error' && saveError ? saveError : undefined}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ${
                portError
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                  : saveStatus === 'saved'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                    : saveStatus === 'error'
                      ? 'bg-red-500/15 text-red-700 dark:text-red-200'
                      : 'bg-ds-subtle text-ds-muted'
              }`}
            >
              {portError
                ? t('autoApplyBlocked')
                : saveStatus === 'saving'
                  ? t('applying')
                  : saveStatus === 'saved'
                    ? t('applied')
                    : saveStatus === 'error'
                      ? t('applyFailed')
                      : t('autoApplyHint')}
            </span>
          </div>

          {saveStatus === 'error' && saveError ? (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] leading-5 text-red-800 shadow-sm dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
            >
              {saveError}
            </div>
          ) : null}

          {category === 'general' ? <GeneralSettingsSection ctx={settingsSectionContext} /> : null}
          <Suspense fallback={<SettingsSectionFallback />}>
            {category === 'providers' ? <ProvidersSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'write' ? <WriteSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'mediaGeneration' ? <MediaGenerationSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'speechToText' ? <SpeechToTextSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'agents' ? (
              <LoadedAgentsSettingsSection ctx={settingsSectionContext} onReady={markAgentsSectionReady} />
            ) : null}
            {category === 'archives' ? <ArchivedThreadsSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'worktree' ? <WorktreeSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'memory' ? <MemorySettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'shortcuts' ? <KeyboardShortcutsSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'easterEgg' ? <EasterEggSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'claw' ? <ClawSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'updates' ? <UpdatesSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'terminal' ? <TerminalSettingsSection ctx={settingsSectionContext} /> : null}
            {category === 'debug' ? <LlmDebugSettingsSection ctx={settingsSectionContext} /> : null}
          </Suspense>
        </div>
      </div>
      {saveStatus === 'error' && saveError ? (
        <div
          role="alert"
          className="ds-no-drag fixed bottom-6 right-8 z-30 flex max-w-[min(560px,calc(100vw-3rem))] items-center gap-3 rounded-2xl border border-red-300/70 bg-red-50/95 px-4 py-3 text-red-900 shadow-2xl shadow-red-950/10 backdrop-blur dark:border-red-500/30 dark:bg-red-950/90 dark:text-red-100"
        >
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{t('applyFailed')}</div>
            <div className="mt-0.5 truncate text-[12px] text-red-800/85 dark:text-red-100/80">
              {saveError}
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl bg-red-600 px-3 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(portError)}
            onClick={() => void flushPendingSave()}
          >
            {t('retrySave')}
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
