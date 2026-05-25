import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe2, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { parseClawCommand } from '@shared/claw-commands'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import type { ChatBlock } from '../agent/types'
import { CLAW_COMPOSER_MODEL_IDS, useChatStore } from '../store/chat-store'
import {
  extractLatestTurnAutoOpenDevPreviewUrls,
  extractLatestTurnDevPreviewUrls,
  formatDevPreviewUrlLabel
} from '../lib/dev-preview-detection'
import {
  WORKSPACE_FILE_PREVIEW_EVENT,
  type WorkspaceFilePreviewDetail
} from '../lib/workspace-file-preview'
import { Sidebar } from './chat/Sidebar'
import { WorkbenchTopBar, type RightPanelMode } from './chat/WorkbenchTopBar'
import { MessageTimeline } from './chat/MessageTimeline'
import { FloatingComposer } from './chat/FloatingComposer'
import { ConnectionStatusBar } from './ConnectionStatusBar'
import { SessionHeader } from './SessionHeader'
import { RuntimeDiagnosticsDialog } from './RuntimeDiagnosticsDialog'
import { WriteWorkspaceView } from './write/WriteWorkspaceView'
import { WriteAssistantPanel } from './write/WriteAssistantPanel'
import { WriteSidebar } from './write/WriteSidebar'
import { composeWritePrompt } from '../write/quoted-selection'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { isWriteThreadId } from '../write/write-thread-registry'

const ChangeInspector = lazy(() =>
  import('./ChangeInspector').then((module) => ({ default: module.ChangeInspector }))
)
const DevBrowserPanel = lazy(() =>
  import('./DevBrowserPanel').then((module) => ({ default: module.DevBrowserPanel }))
)
const RuntimeInsightsPanel = lazy(() =>
  import('./RuntimeInsightsPanel').then((module) => ({ default: module.RuntimeInsightsPanel }))
)
const PluginMarketplaceView = lazy(() =>
  import('./PluginMarketplaceView').then((module) => ({ default: module.PluginMarketplaceView }))
)
const WorkspaceFilePreviewPanel = lazy(() =>
  import('./WorkspaceFilePreviewPanel').then((module) => ({
    default: module.WorkspaceFilePreviewPanel
  }))
)
const AppTerminalPanel = lazy(() =>
  import('./AppTerminalPanel').then((module) => ({ default: module.AppTerminalPanel }))
)

const LEFT_PANEL_WIDTH_KEY = 'deepseekgui.layout.leftSidebarWidth'
const LEFT_PANEL_COLLAPSED_KEY = 'deepseekgui.layout.leftSidebarCollapsed'
const RIGHT_PANEL_WIDTH_KEY = 'deepseekgui.layout.rightInspectorWidth'
const RIGHT_PANEL_MODE_KEY = 'deepseekgui.layout.rightPanelMode'
const BOTTOM_PANEL_HEIGHT_KEY = 'deepseekgui.layout.bottomTerminalHeight'
const LEFT_PANEL_DEFAULT = 288
const RIGHT_PANEL_DEFAULT = 360
const CODE_PANEL_PREFERRED = 560
const BOTTOM_PANEL_DEFAULT = 260
const LEFT_PANEL_MIN = 236
const LEFT_PANEL_MAX = 500
const RIGHT_PANEL_MIN = 280
const RIGHT_PANEL_MAX = 760
const BOTTOM_PANEL_MIN = 180
const BOTTOM_PANEL_MAX = 520
const SIDEBAR_HARD_MIN = 180
const MAIN_MIN_WIDTH = 560
const MAIN_MIN_HEIGHT = 240
const PANEL_RESIZE_HANDLE_WIDTH = 8

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readStoredWidth(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return fallback
    return Math.round(parsed)
  } catch {
    return fallback
  }
}

function persistWidth(key: string, width: number): void {
  try {
    window.localStorage.setItem(key, String(Math.round(width)))
  } catch {
    /* ignore persistence failures */
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {
    /* ignore persistence failures */
  }
  return fallback
}

function persistBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore persistence failures */
  }
}

function readStoredRightPanelMode(): RightPanelMode {
  try {
    const raw = window.localStorage.getItem(RIGHT_PANEL_MODE_KEY)
    return raw === 'changes' || raw === 'browser' || raw === 'runtime' ? raw : null
  } catch {
    return null
  }
}

function persistRightPanelMode(mode: RightPanelMode): void {
  try {
    if (mode === 'changes' || mode === 'browser' || mode === 'runtime') {
      window.localStorage.setItem(RIGHT_PANEL_MODE_KEY, mode)
    } else {
      window.localStorage.removeItem(RIGHT_PANEL_MODE_KEY)
    }
  } catch {
    /* ignore persistence failures */
  }
}

function clampBottomPanelHeight(containerHeight: number, value: number): number {
  const maxHeight = Math.min(
    BOTTOM_PANEL_MAX,
    Math.max(BOTTOM_PANEL_MIN, containerHeight - MAIN_MIN_HEIGHT)
  )
  return clampWidth(value, BOTTOM_PANEL_MIN, maxHeight)
}

function fitWorkbenchWidths(
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  panels: { leftPanelVisible: boolean; rightPanelVisible: boolean }
): { left: number; right: number } {
  const handleWidth =
    (panels.leftPanelVisible ? PANEL_RESIZE_HANDLE_WIDTH : 0) +
    (panels.rightPanelVisible ? PANEL_RESIZE_HANDLE_WIDTH : 0)
  const usableWidth = Math.max(0, containerWidth - handleWidth)

  if (!panels.leftPanelVisible) {
    if (!panels.rightPanelVisible) {
      return {
        left: clampWidth(leftWidth, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
        right: clampWidth(rightWidth, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX)
      }
    }
    const safeContainer = Math.max(usableWidth, MAIN_MIN_WIDTH + SIDEBAR_HARD_MIN)
    const rightFloor =
      safeContainer - MAIN_MIN_WIDTH >= RIGHT_PANEL_MIN ? RIGHT_PANEL_MIN : SIDEBAR_HARD_MIN
    const rightCeil = Math.min(
      RIGHT_PANEL_MAX,
      Math.max(rightFloor, safeContainer - MAIN_MIN_WIDTH)
    )
    return {
      left: clampWidth(leftWidth, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
      right: clampWidth(rightWidth, rightFloor, rightCeil)
    }
  }

  const safeContainer = Math.max(
    usableWidth,
    MAIN_MIN_WIDTH + SIDEBAR_HARD_MIN + (panels.rightPanelVisible ? SIDEBAR_HARD_MIN : 0)
  )
  if (!panels.rightPanelVisible) {
    const leftFloor =
      safeContainer - MAIN_MIN_WIDTH >= LEFT_PANEL_MIN ? LEFT_PANEL_MIN : SIDEBAR_HARD_MIN
    const leftCeil = Math.min(
      LEFT_PANEL_MAX,
      Math.max(leftFloor, safeContainer - MAIN_MIN_WIDTH)
    )
    return {
      left: clampWidth(leftWidth, leftFloor, leftCeil),
      right: clampWidth(rightWidth, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX)
    }
  }

  const availableSides = Math.max(
    SIDEBAR_HARD_MIN * 2,
    safeContainer - MAIN_MIN_WIDTH
  )
  const leftFloor =
    availableSides - SIDEBAR_HARD_MIN >= LEFT_PANEL_MIN ? LEFT_PANEL_MIN : SIDEBAR_HARD_MIN
  const rightFloor =
    availableSides - SIDEBAR_HARD_MIN >= RIGHT_PANEL_MIN ? RIGHT_PANEL_MIN : SIDEBAR_HARD_MIN

  let nextLeft = clampWidth(leftWidth, leftFloor, LEFT_PANEL_MAX)
  let nextRight = clampWidth(rightWidth, rightFloor, RIGHT_PANEL_MAX)

  if (nextLeft + nextRight > availableSides) {
    const overflow = nextLeft + nextRight - availableSides
    const rightShrink = Math.min(overflow, nextRight - rightFloor)
    nextRight -= rightShrink
    const remaining = overflow - rightShrink
    if (remaining > 0) {
      nextLeft = Math.max(leftFloor, nextLeft - remaining)
    }
  }

  const maxLeft = Math.min(LEFT_PANEL_MAX, availableSides - rightFloor)
  nextLeft = clampWidth(nextLeft, leftFloor, Math.max(leftFloor, maxLeft))
  const maxRight = Math.min(RIGHT_PANEL_MAX, availableSides - nextLeft)
  nextRight = clampWidth(nextRight, rightFloor, Math.max(rightFloor, maxRight))

  return { left: nextLeft, right: nextRight }
}

export function Workbench(): ReactElement {
  const { t } = useTranslation('common')
  const {
    threads,
    threadSearch,
    showArchivedThreads,
    activeThreadId,
    selectThread,
    createThread,
    blocks,
    liveReasoning,
    liveAssistant,
    error,
    runtimeErrorDetail,
    busy,
    route,
    pluginHostRoute,
    workspaceRoot,
    runtimeConnection,
    setRoute,
    openCode,
    openWrite,
    ensureWriteThreadForWorkspace,
    createWriteThread,
    openSettings,
    openPlugins,
    openClaw,
    clawChannels,
    activeClawChannelId,
    selectClawChannel,
    resetClawChannelSession,
    setClawChannelModel,
    appendLocalClawTurn,
    setError,
    sendMessage,
    queuedMessages,
    removeQueuedMessage,
    interrupt,
    probeRuntime,
    composerModel,
    composerPickList,
    setComposerModel,
    setThreadSearch,
    setShowArchivedThreads,
    archiveThread,
    deleteThread
  } = useChatStore(
    useShallow((s) => ({
      threads: s.threads,
      threadSearch: s.threadSearch,
      showArchivedThreads: s.showArchivedThreads,
      activeThreadId: s.activeThreadId,
      selectThread: s.selectThread,
      createThread: s.createThread,
      blocks: s.blocks,
      liveReasoning: s.liveReasoning,
      liveAssistant: s.liveAssistant,
      error: s.error,
      runtimeErrorDetail: s.runtimeErrorDetail,
      busy: s.busy,
      route: s.route,
      pluginHostRoute: s.pluginHostRoute,
      workspaceRoot: s.workspaceRoot,
      runtimeConnection: s.runtimeConnection,
      setRoute: s.setRoute,
      openCode: s.openCode,
      openWrite: s.openWrite,
      ensureWriteThreadForWorkspace: s.ensureWriteThreadForWorkspace,
      createWriteThread: s.createWriteThread,
      openSettings: s.openSettings,
      openPlugins: s.openPlugins,
      openClaw: s.openClaw,
      clawChannels: s.clawChannels,
      activeClawChannelId: s.activeClawChannelId,
      selectClawChannel: s.selectClawChannel,
      resetClawChannelSession: s.resetClawChannelSession,
      setClawChannelModel: s.setClawChannelModel,
      appendLocalClawTurn: s.appendLocalClawTurn,
      setError: s.setError,
      sendMessage: s.sendMessage,
      queuedMessages: s.queuedMessages,
      removeQueuedMessage: s.removeQueuedMessage,
      interrupt: s.interrupt,
      probeRuntime: s.probeRuntime,
      composerModel: s.composerModel,
      composerPickList: s.composerPickList,
      setComposerModel: s.setComposerModel,
      setThreadSearch: s.setThreadSearch,
      setShowArchivedThreads: s.setShowArchivedThreads,
      archiveThread: s.archiveThread,
      deleteThread: s.deleteThread
    }))
  )
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'plan' | 'agent'>('agent')
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>(readStoredRightPanelMode)
  const [filePreviewTarget, setFilePreviewTarget] = useState<WorkspaceFileTarget | null>(null)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    readStoredWidth(LEFT_PANEL_WIDTH_KEY, LEFT_PANEL_DEFAULT)
  )
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    readStoredBoolean(LEFT_PANEL_COLLAPSED_KEY, false)
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readStoredWidth(RIGHT_PANEL_WIDTH_KEY, RIGHT_PANEL_DEFAULT)
  )
  const [terminalPanelVisible, setTerminalPanelVisible] = useState(false)
  const [terminalPanelMounted, setTerminalPanelMounted] = useState(false)
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(() =>
    readStoredWidth(BOTTOM_PANEL_HEIGHT_KEY, BOTTOM_PANEL_DEFAULT)
  )
  const [runtimeDiagnosticsOpen, setRuntimeDiagnosticsOpen] = useState(false)
  const writeAssistantOpen = useWriteWorkspaceStore((s) => s.assistantOpen)
  const setWriteAssistantOpen = useWriteWorkspaceStore((s) => s.setAssistantOpen)
  const writeAssistantModel = useWriteWorkspaceStore((s) => s.assistantModel)
  const setWriteAssistantModel = useWriteWorkspaceStore((s) => s.setAssistantModel)
  const writeAssistantPickList = useMemo(() => {
    const ordered = new Set<string>()
    for (const id of DEFAULT_COMPOSER_MODEL_IDS) {
      const normalized = id.trim()
      if (normalized) ordered.add(normalized)
    }
    for (const id of composerPickList) {
      const normalized = id.trim()
      if (normalized) ordered.add(normalized)
    }
    const current = writeAssistantModel.trim()
    if (current) ordered.add(current)
    return [...ordered]
  }, [composerPickList, writeAssistantModel])
  const rightPanelVisible = route === 'write' ? writeAssistantOpen : rightPanelMode !== null
  const stageInsetClass = 'ds-stage-inset'

  const shellRef = useRef<HTMLDivElement | null>(null)
  const draftByThread = useRef<Record<string, string>>({})
  const prevThreadId = useRef<string | null>(null)
  const previewThreadId = useRef<string | null>(activeThreadId)
  const inputRef = useRef('')
  const autoOpenedPreviewUrlRef = useRef<string | null>(null)
  const lastAutoDiagnosticsErrorRef = useRef('')
  const devPreviewBlocks = useMemo<ChatBlock[]>(() => {
    const liveText = liveAssistant.trim()
    if (!liveText) return blocks
    return [
      ...blocks,
      {
        kind: 'assistant',
        id: '__live-assistant-dev-preview',
        text: liveAssistant
      }
    ]
  }, [blocks, liveAssistant])
  const detectedDevPreviewUrls = useMemo(
    () => extractLatestTurnDevPreviewUrls(devPreviewBlocks),
    [devPreviewBlocks]
  )
  const autoOpenDevPreviewUrls = useMemo(
    () => extractLatestTurnAutoOpenDevPreviewUrls(devPreviewBlocks),
    [devPreviewBlocks]
  )
  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? null,
    [activeClawChannelId, clawChannels]
  )
  const latestDevPreviewUrl = detectedDevPreviewUrls[0] ?? null
  const latestAutoOpenDevPreviewUrl = autoOpenDevPreviewUrls[0] ?? null
  const showDevPreviewCard =
    route === 'chat' &&
    latestDevPreviewUrl !== null
  const codeThreads = useMemo(
    () => threads.filter((thread) => !isWriteThreadId(thread.id)),
    [threads]
  )

  const mirrorClawCommand = async (userText: string, replyText: string): Promise<void> => {
    if (!activeThreadId || typeof window.dsGui?.mirrorClawChannelMessageToFeishu !== 'function') return
    const userResult = await window.dsGui.mirrorClawChannelMessageToFeishu(
      activeThreadId,
      userText,
      'user'
    )
    if (!userResult.ok) return
    await window.dsGui.mirrorClawChannelMessageToFeishu(
      activeThreadId,
      replyText,
      'assistant'
    )
  }

  const clawHelpText = (): string =>
    [
      t('clawHelpTitle'),
      '',
      `- \`/help\`: ${t('clawHelpCommandHelp')}`,
      `- \`/new\`: ${t('clawHelpCommandNew')}`,
      `- \`/model auto\`: ${t('clawHelpCommandModelAuto')}`,
      `- \`/model pro\`: ${t('clawHelpCommandModelPro')}`,
      `- \`/model flash\`: ${t('clawHelpCommandModelFlash')}`,
      `- \`/model\`: ${t('clawHelpCommandModelShow')}`
    ].join('\n')

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    persistWidth(LEFT_PANEL_WIDTH_KEY, leftSidebarWidth)
  }, [leftSidebarWidth])

  useEffect(() => {
    persistBoolean(LEFT_PANEL_COLLAPSED_KEY, leftSidebarCollapsed)
  }, [leftSidebarCollapsed])

  useEffect(() => {
    persistWidth(RIGHT_PANEL_WIDTH_KEY, rightSidebarWidth)
  }, [rightSidebarWidth])

  useEffect(() => {
    persistWidth(BOTTOM_PANEL_HEIGHT_KEY, terminalPanelHeight)
  }, [terminalPanelHeight])

  useEffect(() => {
    persistRightPanelMode(rightPanelMode)
  }, [rightPanelMode])

  useEffect(() => {
    const onPreview = (event: Event): void => {
      const detail = (event as CustomEvent<WorkspaceFilePreviewDetail>).detail
      if (!detail?.path) return
      setFilePreviewTarget({
        ...detail,
        workspaceRoot: detail.workspaceRoot ?? workspaceRoot
      })
      setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
      setRightPanelMode('file')
    }

    window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
    return () => window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
  }, [workspaceRoot])

  useEffect(() => {
    if (previewThreadId.current === activeThreadId) return
    previewThreadId.current = activeThreadId
    autoOpenedPreviewUrlRef.current = null
    if (rightPanelMode === 'browser') setRightPanelMode(null)
    if (rightPanelMode === 'file') {
      setRightPanelMode(null)
      setFilePreviewTarget(null)
    }
  }, [activeThreadId, rightPanelMode])

  useEffect(() => {
    if (!latestAutoOpenDevPreviewUrl || route !== 'chat') return
    if (autoOpenedPreviewUrlRef.current === latestAutoOpenDevPreviewUrl) return
    autoOpenedPreviewUrlRef.current = latestAutoOpenDevPreviewUrl
    setRightPanelMode('browser')
  }, [latestAutoOpenDevPreviewUrl, route])

  useEffect(() => {
    if (workspaceRoot.trim()) return
    setTerminalPanelVisible(false)
    setTerminalPanelMounted(false)
  }, [workspaceRoot])

  useEffect(() => {
    if (route !== 'write') return
    if (rightPanelMode !== null) setRightPanelMode(null)
    if (terminalPanelVisible) setTerminalPanelVisible(false)
  }, [route, rightPanelMode, terminalPanelVisible])

  useEffect(() => {
    const prev = prevThreadId.current
    prevThreadId.current = activeThreadId
    if (prev != null && prev !== activeThreadId) {
      draftByThread.current[prev] = inputRef.current
    }
    if (activeThreadId != null && activeThreadId !== prev) {
      setInput(draftByThread.current[activeThreadId] ?? '')
    }
    if (activeThreadId == null) {
      setInput('')
    }
  }, [activeThreadId])

  // Periodic background probe — keeps connected state fresh and
  // attempts to recover when the runtime is offline.
  useEffect(() => {
    let cancelled = false
    const tick = (): void => {
      if (cancelled) return
      void useChatStore.getState().probeRuntime('background')
    }
    const onlineDelay = 30_000
    const offlineDelay = 6_000
    let id = window.setTimeout(function loop() {
      tick()
      if (cancelled) return
      const next = useChatStore.getState().runtimeConnection === 'ready' ? onlineDelay : offlineDelay
      id = window.setTimeout(loop, next)
    }, onlineDelay)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [])

  useEffect(() => {
    if (runtimeConnection !== 'offline' || !runtimeErrorDetail) return
    const lowered = runtimeErrorDetail.toLowerCase()
    const shouldOpen =
      !lowered.includes('missing_api_key') &&
      (lowered.includes('config') ||
        lowered.includes('toml') ||
        lowered.includes('deepseek') ||
        lowered.includes('runtime') ||
        lowered.includes('serve') ||
        lowered.includes('spawn') ||
        lowered.includes('fetch failed'))
    if (!shouldOpen || lastAutoDiagnosticsErrorRef.current === runtimeErrorDetail) return
    lastAutoDiagnosticsErrorRef.current = runtimeErrorDetail
    setRuntimeDiagnosticsOpen(true)
  }, [runtimeConnection, runtimeErrorDetail])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (useChatStore.getState().route === 'write') {
          void createWriteThread()
          return
        }
        void createThread()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createThread, createWriteThread])

  useLayoutEffect(() => {
    const sync = (): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const next = fitWorkbenchWidths(
        containerWidth,
        leftSidebarWidth,
        rightSidebarWidth,
        {
          leftPanelVisible: !leftSidebarCollapsed,
          rightPanelVisible
        }
      )
      if (next.left !== leftSidebarWidth) setLeftSidebarWidth(next.left)
      if (next.right !== rightSidebarWidth) setRightSidebarWidth(next.right)
      const containerHeight = shellRef.current?.clientHeight ?? window.innerHeight
      const nextTerminalHeight = clampBottomPanelHeight(containerHeight, terminalPanelHeight)
      if (nextTerminalHeight !== terminalPanelHeight) {
        setTerminalPanelHeight(nextTerminalHeight)
      }
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [leftSidebarCollapsed, leftSidebarWidth, rightPanelVisible, rightSidebarWidth, terminalPanelHeight])

  const sendWritePrompt = (value: string): void => {
    const v = value.trim()
    if (!v) return
    const writeState = useWriteWorkspaceStore.getState()
    const writeWorkspaceRoot = writeState.workspaceRoot || workspaceRoot
    const prompt = composeWritePrompt(v, writeState.quotedSelections, {
      workspaceRoot: writeWorkspaceRoot,
      activeFilePath: writeState.activeFilePath
    })
    setInput('')
    void (async () => {
      const threadId = await ensureWriteThreadForWorkspace(writeWorkspaceRoot)
      if (!threadId) {
        setInput(v)
        return
      }
      const model = writeState.assistantModel.trim()
      const sent = await sendMessage(
        prompt,
        mode === 'plan' ? 'plan' : 'agent',
        model ? { model } : undefined
      )
      if (sent) {
        useWriteWorkspaceStore.getState().clearQuotedSelections()
      }
    })()
  }

  const handleSend = (): void => {
    const v = input.trim()
    if (!v) return
    if (route === 'write') {
      sendWritePrompt(v)
      return
    }
    if (route === 'claw') {
      const command = parseClawCommand(v)
      if (command?.kind === 'clear') {
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          await resetClawChannelSession(activeClawChannelId)
          const replyText = t('clawNewSessionStarted')
          appendLocalClawTurn(v, replyText)
          await mirrorClawCommand(v, replyText)
        })()
        return
      }
      if (command?.kind === 'help') {
        setInput('')
        const replyText = clawHelpText()
        appendLocalClawTurn(v, replyText)
        void mirrorClawCommand(v, replyText)
        return
      }
      if (command?.kind === 'model') {
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          await setClawChannelModel(activeClawChannelId, command.model)
          const replyText = t('clawModelChanged', { model: command.model })
          appendLocalClawTurn(v, replyText)
          await mirrorClawCommand(v, replyText)
        })()
        return
      }
      if (command?.kind === 'showModel') {
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        const replyText = t('clawModelCurrent', {
          model: activeClawChannel?.model ?? 'auto'
        })
        appendLocalClawTurn(v, replyText)
        void mirrorClawCommand(v, replyText)
        return
      }
      if (command?.kind === 'invalidModel') {
        setError(t('clawModelCommandHint'))
        return
      }
      if (!activeClawChannelId) {
        setError(t('clawNoActiveIm'))
        return
      }
      setInput('')
      void (async () => {
        const taskResult = typeof window.dsGui?.createClawTaskFromText === 'function'
          ? await window.dsGui.createClawTaskFromText(v, {
              channelId: activeClawChannelId,
              modelHint: activeClawChannel?.model,
              mode
            })
          : { kind: 'noop' as const }
        if (taskResult.kind === 'created') {
          appendLocalClawTurn(v, taskResult.confirmationText)
          await mirrorClawCommand(v, taskResult.confirmationText)
          return
        }
        if (taskResult.kind === 'error') {
          appendLocalClawTurn(v, `Failed to create scheduled task: ${taskResult.message}`)
          return
        }
        if (!activeThreadId) {
          await selectClawChannel(activeClawChannelId)
          await useChatStore.getState().sendMessage(v, mode === 'plan' ? 'plan' : 'agent')
          return
        }
        await sendMessage(v, mode === 'plan' ? 'plan' : 'agent')
      })()
      return
    }
    setInput('')
    void sendMessage(v, mode === 'plan' ? 'plan' : 'agent')
  }

  const openThread = (id: string): void => {
    setRoute('chat')
    void selectThread(id)
  }

  const startNewChat = (): void => {
    setRoute('chat')
    void createThread()
  }

  const startNewChatInWorkspace = (workspaceRoot: string): void => {
    setRoute('chat')
    void createThread({ workspaceRoot })
  }

  const sidebarView: 'chat' | 'write' | 'claw' =
    route === 'claw' || (route === 'plugins' && pluginHostRoute === 'claw')
      ? 'claw'
      : route === 'write'
        ? 'write'
        : 'chat'

  const toggleRightPanelMode = (nextMode: Exclude<RightPanelMode, null>): void => {
    setRightPanelMode((current) => (current === nextMode ? null : nextMode))
  }

  const openRuntimePanel = (): void => {
    setRightPanelMode('runtime')
  }

  const closeRightPanel = (): void => {
    if (route === 'write') {
      setWriteAssistantOpen(false)
      return
    }
    setRightPanelMode(null)
    setFilePreviewTarget(null)
  }

  const startNewWriteAssistantConversation = (): void => {
    const writeState = useWriteWorkspaceStore.getState()
    const writeWorkspaceRoot = writeState.workspaceRoot || workspaceRoot
    setInput('')
    writeState.clearQuotedSelections()
    void createWriteThread(writeWorkspaceRoot)
  }

  const toggleLeftSidebar = (): void => {
    setLeftSidebarCollapsed((current) => !current)
  }

  const toggleTerminalPanel = (): void => {
    if (!workspaceRoot.trim()) return
    if (terminalPanelVisible) {
      setTerminalPanelVisible(false)
      return
    }
    setTerminalPanelMounted(true)
    setTerminalPanelVisible(true)
  }

  const openDevPreview = (): void => {
    if (latestDevPreviewUrl) {
      autoOpenedPreviewUrlRef.current = latestDevPreviewUrl
    }
    setRightPanelMode('browser')
  }

  const beginLeftResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (leftSidebarCollapsed || event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startLeft = leftSidebarWidth
    const startRight = rightSidebarWidth
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const delta = moveEvent.clientX - startX
      const next = fitWorkbenchWidths(
        containerWidth,
        startLeft + delta,
        startRight,
        {
          leftPanelVisible: true,
          rightPanelVisible
        }
      )
      setLeftSidebarWidth(next.left)
      if (next.right !== rightSidebarWidth) setRightSidebarWidth(next.right)
    }

    const onUp = (): void => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const beginRightResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !rightPanelVisible) return
    event.preventDefault()
    const startX = event.clientX
    const startLeft = leftSidebarWidth
    const startRight = rightSidebarWidth
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const delta = moveEvent.clientX - startX
      const next = fitWorkbenchWidths(
        containerWidth,
        startLeft,
        startRight - delta,
        {
          leftPanelVisible: !leftSidebarCollapsed,
          rightPanelVisible: true
        }
      )
      if (next.left !== leftSidebarWidth) setLeftSidebarWidth(next.left)
      setRightSidebarWidth(next.right)
    }

    const onUp = (): void => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const beginBottomResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !terminalPanelVisible) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = terminalPanelHeight
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerHeight = shellRef.current?.clientHeight ?? window.innerHeight
      const delta = startY - moveEvent.clientY
      setTerminalPanelHeight(clampBottomPanelHeight(containerHeight, startHeight + delta))
    }

    const onUp = (): void => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const renderRightPanel = (): ReactElement | null => {
    if (!rightPanelVisible) return null
    return (
      <>
        <div
          role="separator"
          aria-orientation="vertical"
          className="ds-no-drag group relative z-20 w-2 shrink-0 cursor-col-resize"
          onPointerDown={beginRightResize}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ds-border-muted/70 transition group-hover:bg-ds-border-strong" />
        </div>
        <div className="h-full min-h-0 shrink-0" style={{ width: rightSidebarWidth }}>
          <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
            {route === 'write' && writeAssistantOpen ? (
              <WriteAssistantPanel
                input={input}
                setInput={setInput}
                mode={mode}
                setMode={setMode}
                busy={busy}
                runtimeConnection={runtimeConnection}
                activeThreadId={activeThreadId}
                blocks={blocks}
                liveReasoning={liveReasoning}
                liveAssistant={liveAssistant}
                composerModel={writeAssistantModel}
                composerPickList={writeAssistantPickList}
                setComposerModel={setWriteAssistantModel}
                queuedMessages={queuedMessages}
                removeQueuedMessage={removeQueuedMessage}
                onSend={handleSend}
                onInterrupt={() => void interrupt()}
                onRetryConnection={() => void probeRuntime('user')}
                onOpenSettings={() => openSettings('agents')}
                onOpenDiagnostics={() => setRuntimeDiagnosticsOpen(true)}
                onNewConversation={startNewWriteAssistantConversation}
                onCollapse={closeRightPanel}
                className="h-full max-h-full w-full"
              />
            ) : rightPanelMode === 'changes' ? (
              <ChangeInspector
                blocks={blocks}
                className="h-full max-h-full w-full flex-col"
                onCollapse={closeRightPanel}
              />
            ) : rightPanelMode === 'browser' ? (
              <DevBrowserPanel
                blocks={devPreviewBlocks}
                preferredUrl={latestDevPreviewUrl}
                className="h-full max-h-full w-full flex-col"
                onCollapse={closeRightPanel}
              />
            ) : rightPanelMode === 'runtime' ? (
              <RuntimeInsightsPanel
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
              />
            ) : (
              <WorkspaceFilePreviewPanel
                target={filePreviewTarget}
                workspaceRoot={workspaceRoot}
                className="h-full max-h-full w-full"
                onClose={closeRightPanel}
              />
            )}
          </Suspense>
        </div>
      </>
    )
  }

  return (
    <div
      ref={shellRef}
      className="ds-workbench-shell ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main"
    >
      {!leftSidebarCollapsed ? (
        <>
          <div className="min-h-0 shrink-0" style={{ width: leftSidebarWidth }}>
            {route === 'write' ? (
              <WriteSidebar
                activeView={sidebarView}
                onCodeOpen={() => void openCode()}
                onWriteOpen={() => void openWrite()}
                onClawOpen={() => openClaw()}
                onOpenSettings={(section) => openSettings(section)}
              />
            ) : (
            <Sidebar
              threads={codeThreads}
              activeThreadId={activeThreadId}
              activeView={sidebarView}
              pluginsActive={route === 'plugins'}
              runtimeReady={runtimeConnection === 'ready'}
              threadSearch={threadSearch}
              showArchivedThreads={showArchivedThreads}
              onThreadSearchChange={setThreadSearch}
              onShowArchivedThreadsChange={setShowArchivedThreads}
              onSelectThread={openThread}
              onDeleteThread={deleteThread}
              onRestoreThread={(id) => archiveThread(id, false)}
              onNewChat={startNewChat}
              onNewChatInWorkspace={startNewChatInWorkspace}
              onOpenSettings={(section) => openSettings(section)}
              onOpenPlugins={() => openPlugins(sidebarView === 'claw' ? 'claw' : 'chat')}
              onCodeOpen={() => void openCode()}
              onWriteOpen={() => void openWrite()}
              onClawOpen={() => openClaw()}
            />
            )}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            className="ds-no-drag group relative z-20 w-2 shrink-0 cursor-col-resize"
            onPointerDown={beginLeftResize}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ds-border-muted/70 transition group-hover:bg-ds-border-strong" />
          </div>
        </>
      ) : null}

      <main
        className={`ds-drag ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
          route === 'plugins' ? 'px-0' : ''
        }`}
      >
        {route === 'plugins' ? (
          <>
            <div className="ds-no-drag shrink-0 px-4 pt-4">
              <button
                type="button"
                onClick={toggleLeftSidebar}
                className="ds-sidebar-toggle-button"
                aria-label={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              >
                {leftSidebarCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.85} />
                ) : (
                  <PanelLeftClose className="h-4 w-4" strokeWidth={1.85} />
                )}
              </button>
            </div>
            <Suspense fallback={<div className="h-full bg-ds-main" />}>
              <PluginMarketplaceView />
            </Suspense>
          </>
        ) : route === 'write' ? (
          <div className="flex min-h-0 flex-1">
            <WriteWorkspaceView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={toggleLeftSidebar}
              input={input}
              setInput={setInput}
              onSubmitPrompt={sendWritePrompt}
            />
            {renderRightPanel()}
          </div>
        ) : (
          <>
        {error && !(runtimeConnection !== 'ready' && !activeThreadId) && (
          <div className="ds-no-drag shrink-0 border-b border-amber-200/70 bg-[rgba(255,248,235,0.82)] backdrop-blur-lg dark:border-amber-800/50 dark:bg-amber-950/35">
            <div className={`${stageInsetClass} flex w-full min-w-0 items-start justify-between gap-3 py-3`}>
              <p className="min-w-0 flex-1 text-[14px] leading-6 text-amber-950 dark:text-amber-100">
                {error}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                {runtimeConnection !== 'ready' ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-amber-300/70 bg-white px-3 py-1 text-[12px] font-medium text-amber-950 transition hover:bg-amber-100/80 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/40"
                      onClick={() => void probeRuntime('user')}
                    >
                      {t('retryConnection')}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-amber-300/70 bg-white px-3 py-1 text-[12px] font-medium text-amber-950 transition hover:bg-amber-100/80 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/40"
                      onClick={() => setRuntimeDiagnosticsOpen(true)}
                    >
                      {t('runtimeDiagnosticsButton')}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1 text-[12px] font-medium text-amber-900/80 transition hover:bg-amber-50/70 dark:text-amber-100 dark:hover:bg-amber-900/30"
                      onClick={() => openSettings('agents')}
                    >
                      {t('openSettings')}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className={`flex min-h-0 min-w-0 flex-1 ${stageInsetClass}`}>
          <section className="ds-chat-stage ds-drag flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="chat-topbar ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full shrink-0 items-stretch overflow-visible rounded-[24px]">
              <div className="chat-topbar-grid grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
                <div className="chat-topbar-session flex min-w-0 items-center gap-2.5">
                  <button
                    type="button"
                    onClick={toggleLeftSidebar}
                    className="ds-sidebar-toggle-button shrink-0"
                    aria-label={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                    title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                  >
                    {leftSidebarCollapsed ? (
                      <PanelLeftOpen className="h-4 w-4" strokeWidth={1.85} />
                    ) : (
                      <PanelLeftClose className="h-4 w-4" strokeWidth={1.85} />
                    )}
                  </button>
                  <SessionHeader compact className="min-w-0 flex-1" />
                </div>
                <div className="chat-topbar-actions flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <ConnectionStatusBar compact />
                  {busy ? (
                    <span className="inline-flex shrink-0 rounded-full bg-amber-500/16 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 dark:text-amber-100">
                      {t('running')}
                    </span>
                  ) : null}
                  <WorkbenchTopBar
                    rightPanelMode={rightPanelMode}
                    onToggleRightPanelMode={toggleRightPanelMode}
                    terminalPanelOpen={terminalPanelVisible}
                    terminalPanelEnabled={workspaceRoot.trim().length > 0}
                    onToggleTerminalPanel={toggleTerminalPanel}
                  />
                </div>
              </div>
            </header>
            <MessageTimeline
              blocks={blocks}
              liveReasoning={liveReasoning}
              live={liveAssistant}
              activeThreadId={activeThreadId}
              runtimeConnection={runtimeConnection}
              onRetryConnection={() => void probeRuntime('user')}
              onOpenSettings={() => openSettings('agents')}
              onOpenDiagnostics={() => setRuntimeDiagnosticsOpen(true)}
              onSelectSuggestion={(text) => setInput(text)}
              devPreviewCard={
                showDevPreviewCard ? (
                  <DevPreviewLaunchCard
                    url={latestDevPreviewUrl}
                    onOpen={openDevPreview}
                  />
                ) : null
              }
            />
            <div className="flex shrink-0 justify-center px-2 pb-3 pt-0 sm:px-4 md:px-6 lg:px-8">
              <FloatingComposer
                input={input}
                setInput={setInput}
                mode={mode}
                setMode={setMode}
                busy={busy}
                runtimeReady={runtimeConnection === 'ready'}
                hasActiveThread={Boolean(activeThreadId)}
                composerModel={
                  route === 'claw'
                    ? clawChannels.find((channel) => channel.id === activeClawChannelId)?.model ?? 'auto'
                    : composerModel
                }
                composerPickList={route === 'claw' ? CLAW_COMPOSER_MODEL_IDS : composerPickList}
                onComposerModelChange={(modelId) => {
                  if (route === 'claw' && activeClawChannelId) {
                    void setClawChannelModel(activeClawChannelId, modelId)
                    return
                  }
                  setComposerModel(modelId)
                }}
                onSend={handleSend}
                queuedMessages={queuedMessages}
                onRemoveQueuedMessage={removeQueuedMessage}
                onInterrupt={() => void interrupt()}
                onOpenRuntimePanel={openRuntimePanel}
              />
            </div>
          </section>
          </div>

          {renderRightPanel()}
        </div>

        {terminalPanelMounted ? (
          <div className={terminalPanelVisible ? '' : 'hidden'}>
            <div
              role="separator"
              aria-orientation="horizontal"
              className="ds-no-drag group relative z-20 h-2 shrink-0 cursor-row-resize"
              onPointerDown={beginBottomResize}
            >
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ds-border-muted/70 transition group-hover:bg-ds-border-strong" />
            </div>
            <div className="min-h-0 shrink-0" style={{ height: terminalPanelHeight }}>
              <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
                <AppTerminalPanel
                  workspaceRoot={workspaceRoot}
                  className="h-full w-full"
                  onClose={() => setTerminalPanelVisible(false)}
                />
              </Suspense>
            </div>
          </div>
        ) : null}
          </>
        )}
      </main>
      <RuntimeDiagnosticsDialog
        open={runtimeDiagnosticsOpen}
        lastError={runtimeErrorDetail ?? error}
        onClose={() => setRuntimeDiagnosticsOpen(false)}
        onRetry={() => probeRuntime('user')}
        onOpenSettings={() => {
          setRuntimeDiagnosticsOpen(false)
          openSettings('agents')
        }}
      />
    </div>
  )
}

function DevPreviewLaunchCard({
  url,
  onOpen
}: {
  url: string
  onOpen: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex min-h-[72px] w-full items-center gap-3 rounded-[18px] border border-ds-border-muted bg-white/[0.78] px-4 py-3 shadow-[0_12px_34px_rgba(15,23,42,0.07)] backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.045] dark:shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-sky-400/20 bg-sky-500/10 text-sky-500 dark:border-sky-300/20 dark:bg-sky-300/10 dark:text-sky-300">
        <Globe2 className="h-5 w-5" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold text-ds-ink">
          {t('devPreviewCardTitle')}
        </div>
        <div
          className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-ds-muted"
          title={url}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]" />
          <span className="truncate">
            {t('devPreviewCardSubtitle')} · {formatDevPreviewUrlLabel(url)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(0,136,255,0.22)] transition hover:brightness-110"
        title={t('devPreviewCardOpen')}
      >
        {t('devPreviewCardOpen')}
      </button>
    </div>
  )
}
