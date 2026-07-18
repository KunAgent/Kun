import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorInfo } from '@shared/editor'
import type { GuiUpdateState } from '@shared/gui-update'
import {
  ArrowUpCircle,
  Blocks,
  Bot,
  Check,
  Code2,
  ClipboardList,
  Download,
  ExternalLink,
  FileEdit,
  Folders,
  FolderOpen,
  Globe2,
  ListTodo,
  LockKeyhole,
  Loader2,
  MessageCircleMore,
  PanelRight,
  Puzzle,
  RefreshCw,
  Shapes,
  Terminal
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readPreferredEditorId, writePreferredEditorId } from '../../lib/editor-preferences'
import {
  extensionHostIconUrl,
  type ExtensionRightRailViewEntry
} from '../../extensions/contribution-registry'
import {
  type ExtensionRightContainerTarget
} from '../../extensions/ExtensionWorkbenchSurfaces'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  type RightPanelMode
} from '../../extensions/contribution-ids'
import { boundedPlainText } from '../../extensions/safe-text'

export type { RightPanelMode } from '../../extensions/contribution-ids'

type Props = {
  rightPanelMode: RightPanelMode
  onToggleRightPanelMode: (mode: Exclude<RightPanelMode, null>) => void
  planPanelEnabled?: boolean
  canvasEnabled?: boolean
  sideChatCount?: number
  sideChatRunningCount?: number
  sideChatOpen?: boolean
  sideChatEnabled?: boolean
  fileTreeOpen?: boolean
  fileTreeEnabled?: boolean
  onToggleFileTree?: () => void
  onOpenSideChat?: () => void
  extensionItems?: readonly ExtensionRightRailViewEntry[]
  extensionContainers?: readonly ExtensionRightContainerTarget[]
  onSelectExtension?: (entry: ExtensionRightRailViewEntry) => void
}

type WorkbenchTopActionsProps = {
  terminalOpen?: boolean
  onToggleTerminal?: () => void
  rightWorkspaceExpanded?: boolean
  onToggleRightWorkspace?: () => void
}

const TOPBAR_ICON_CLASS = 'h-4 w-4'
const SIDE_RAIL_BUTTON_BASE =
  'ds-side-rail-button inline-flex h-8 w-8 items-center justify-center rounded-[0.9rem] border shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
const SIDE_RAIL_BUTTON_ACTIVE = 'border-ds-border-strong bg-white/70 text-ds-ink dark:bg-white/10'
const SIDE_RAIL_BUTTON_IDLE =
  'border-transparent bg-white/38 text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:hover:bg-white/8'
const TOPBAR_ACTION_BUTTON_BASE =
  'ds-topbar-action-button inline-flex h-8 w-8 items-center justify-center rounded-[0.9rem] border shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'

function sideRailButtonClass(active: boolean, extra?: string): string {
  return `${SIDE_RAIL_BUTTON_BASE} ${active ? SIDE_RAIL_BUTTON_ACTIVE : SIDE_RAIL_BUTTON_IDLE}${extra ? ` ${extra}` : ''}`
}

function topbarActionButtonClass(active: boolean, extra?: string): string {
  return `${TOPBAR_ACTION_BUTTON_BASE} ${active ? SIDE_RAIL_BUTTON_ACTIVE : SIDE_RAIL_BUTTON_IDLE}${extra ? ` ${extra}` : ''}`
}

export function WorkbenchTopActions({
  terminalOpen = false,
  onToggleTerminal,
  rightWorkspaceExpanded = false,
  onToggleRightWorkspace
}: WorkbenchTopActionsProps): ReactElement {
  const { t } = useTranslation(['common', 'settings'])
  const [editors, setEditors] = useState<EditorInfo[]>([])
  const [selectedEditorId, setSelectedEditorId] = useState(() => readPreferredEditorId() ?? '')
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [failedIconIds, setFailedIconIds] = useState<Set<string>>(() => new Set())
  const [guiUpdateState, setGuiUpdateState] = useState<GuiUpdateState>({ status: 'idle' })
  const [applyingGuiUpdate, setApplyingGuiUpdate] = useState(false)
  const editorMenuRef = useRef<HTMLDivElement>(null)
  const selectedEditor = useMemo(
    () => editors.find((editor) => editor.id === selectedEditorId) ?? editors[0],
    [editors, selectedEditorId]
  )
  const editorButtonTitle = selectedEditor
    ? t('editorPickerTitleWithEditor', { editor: selectedEditor.label })
    : t('editorPickerTitle')

  useEffect(() => {
    let cancelled = false
    if (typeof window.kunGui?.listEditors !== 'function') return

    void window.kunGui.listEditors()
      .then((result) => {
        if (cancelled) return
        const available = result.editors.filter((editor) => editor.available)
        const stored = readPreferredEditorId()
        const nextId =
          stored && available.some((editor) => editor.id === stored)
            ? stored
            : result.defaultEditorId
        setEditors(available)
        setSelectedEditorId(nextId)
        writePreferredEditorId(nextId)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!editorMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && editorMenuRef.current?.contains(target)) return
      setEditorMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [editorMenuOpen])

  useEffect(() => {
    if (typeof window.kunGui?.onGuiUpdateState !== 'function') return
    const applyState = (state: GuiUpdateState): void => {
      setGuiUpdateState(state)
    }
    const unsubscribe = window.kunGui.onGuiUpdateState(applyState)
    if (typeof window.kunGui?.getGuiUpdateState === 'function') {
      void window.kunGui.getGuiUpdateState().then(applyState).catch(() => undefined)
    }
    return unsubscribe
  }, [])

  const guiUpdateAction = useMemo(() => {
    if (guiUpdateState.status === 'available' || guiUpdateState.status === 'downloaded') {
      return guiUpdateState.info.hasUpdate ? guiUpdateState.info : null
    }
    if (guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing') {
      return guiUpdateState.info?.hasUpdate ? guiUpdateState.info : null
    }
    if (guiUpdateState.status === 'error' && guiUpdateState.info?.ok && guiUpdateState.info.hasUpdate) {
      return guiUpdateState.info
    }
    return null
  }, [guiUpdateState])
  const guiUpdateBusy =
    applyingGuiUpdate || guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing'
  const guiUpdateLabel = useMemo(() => {
    if (!guiUpdateAction) return ''
    if (guiUpdateState.status === 'downloading') {
      return t('guiUpdateTopbarDownloading', {
        percent: Math.max(0, Math.round(guiUpdateState.progress.percent))
      })
    }
    if (guiUpdateState.status === 'installing') {
      return t('guiUpdateTopbarInstalling')
    }
    if (guiUpdateAction.downloaded || guiUpdateState.status === 'downloaded') {
      return t('settings:guiUpdateInstall')
    }
    if (guiUpdateAction.manualOnly) {
      return t('guiUpdateTopbarManual', { version: guiUpdateAction.latestVersion })
    }
    return t('guiUpdateTopbarAvailable', { version: guiUpdateAction.latestVersion })
  }, [guiUpdateAction, guiUpdateState, t])
  const guiUpdateTitle = useMemo(() => {
    if (!guiUpdateAction) return ''
    return guiUpdateAction.manualOnly
      ? t('settings:guiUpdateAvailableManual', {
          current: guiUpdateAction.currentVersion,
          latest: guiUpdateAction.latestVersion
        })
      : t('settings:guiUpdateAvailable', {
          current: guiUpdateAction.currentVersion,
          latest: guiUpdateAction.latestVersion
        })
  }, [guiUpdateAction, t])

  const chooseEditor = (editor: EditorInfo): void => {
    setSelectedEditorId(editor.id)
    writePreferredEditorId(editor.id)
    setEditorMenuOpen(false)
  }

  const markEditorIconFailed = (editorId: string): void => {
    setFailedIconIds((prev) => {
      if (prev.has(editorId)) return prev
      const next = new Set(prev)
      next.add(editorId)
      return next
    })
  }

  const renderEditorIcon = (editor: EditorInfo | null | undefined, className: string): ReactElement => {
    const Icon =
      editor?.kind === 'terminal' ? Terminal : editor?.kind === 'viewer' ? FolderOpen : Code2

    if (editor?.iconDataUrl && !failedIconIds.has(editor.id)) {
      return (
        <img
          src={editor.iconDataUrl}
          alt=""
          aria-hidden="true"
          className={`${className} shrink-0 rounded-[4px] object-contain`}
          onError={() => markEditorIconFailed(editor.id)}
        />
      )
    }

    return <Icon className={`${className} shrink-0`} strokeWidth={1.8} />
  }

  const runGuiUpdateAction = async (): Promise<void> => {
    if (!guiUpdateAction || guiUpdateBusy) return
    if (guiUpdateAction.manualOnly) {
      if (typeof window.kunGui?.openExternal === 'function') {
        await window.kunGui.openExternal(guiUpdateAction.releaseUrl)
      }
      return
    }
    if (
      typeof window.kunGui?.downloadGuiUpdate !== 'function' ||
      typeof window.kunGui?.installGuiUpdate !== 'function'
    ) {
      return
    }

    setApplyingGuiUpdate(true)
    try {
      if (!guiUpdateAction.downloaded && guiUpdateState.status !== 'downloaded') {
        const downloadResult = await window.kunGui.downloadGuiUpdate(guiUpdateAction.channel)
        if (!downloadResult.ok) return
      }
      const installResult = await window.kunGui.installGuiUpdate()
      if (!installResult.ok && typeof window.kunGui?.logError === 'function') {
        await window.kunGui.logError('gui-update', 'Failed to install GUI update from workbench top bar', {
          version: guiUpdateAction.latestVersion,
          message: installResult.message
        })
      }
    } catch (error) {
      if (typeof window.kunGui?.logError === 'function') {
        await window.kunGui.logError('gui-update', 'Failed to apply GUI update from workbench top bar', {
          version: guiUpdateAction.latestVersion,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      setApplyingGuiUpdate(false)
    }
  }

  const renderGuiUpdateIcon = (): ReactElement => {
    if (guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing' || applyingGuiUpdate) {
      return <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
    }
    if (guiUpdateAction?.downloaded || guiUpdateState.status === 'downloaded') {
      return <RefreshCw className="h-4 w-4" strokeWidth={1.85} />
    }
    if (guiUpdateAction?.manualOnly) {
      return <ExternalLink className="h-4 w-4" strokeWidth={1.85} />
    }
    if (guiUpdateAction) {
      return <ArrowUpCircle className="h-4 w-4" strokeWidth={1.85} />
    }
    return <Download className="h-4 w-4" strokeWidth={1.85} />
  }

  return (
    <div className="ds-workbench-top-actions ds-no-drag relative flex shrink-0 items-center gap-1.5">
      {guiUpdateAction ? (
        <button
          type="button"
          onClick={() => void runGuiUpdateAction()}
          disabled={guiUpdateBusy}
          className="ds-topbar-action-button relative inline-flex h-8 w-8 items-center justify-center rounded-[0.9rem] border border-amber-300/75 bg-amber-50/92 text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700/70 dark:bg-amber-950/35 dark:text-amber-100 dark:hover:bg-amber-900/45"
          data-tooltip={guiUpdateBusy ? guiUpdateLabel : guiUpdateTitle}
          aria-label={guiUpdateBusy ? guiUpdateLabel : guiUpdateTitle}
        >
          {renderGuiUpdateIcon()}
          {!guiUpdateBusy ? (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_0_2px_rgba(245,158,11,0.18)]" />
          ) : null}
        </button>
      ) : null}

      <div ref={editorMenuRef} className="relative">
        <button
          type="button"
          onClick={() => setEditorMenuOpen((value) => !value)}
          className={topbarActionButtonClass(false)}
          data-tooltip={editorButtonTitle}
          aria-label={t('editorPickerTitle')}
          aria-expanded={editorMenuOpen}
        >
          {renderEditorIcon(selectedEditor, 'h-4 w-4')}
        </button>

        {editorMenuOpen ? (
          <div className="ds-card-strong absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-[18px] border border-ds-border py-1.5 shadow-[0_18px_52px_rgba(20,47,95,0.18)] backdrop-blur-xl dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]">
            <div className="border-b border-ds-border-muted px-3 pb-2 pt-1.5 text-[11px] font-semibold text-ds-faint">
              {t('editorPickerMenuTitle')}
            </div>
            {editors.map((editor) => {
              const active = editor.id === selectedEditor?.id
              return (
                <button
                  key={editor.id}
                  type="button"
                  onClick={() => chooseEditor(editor)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-[14px] transition ${
                    active
                      ? 'bg-ds-hover text-ds-ink'
                      : 'text-ds-muted hover:bg-ds-hover/70 hover:text-ds-ink'
                  }`}
                >
                  {renderEditorIcon(editor, 'h-4 w-4')}
                  <span className="min-w-0 flex-1 truncate">{editor.label}</span>
                  {editor.supportsLine ? (
                    <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      {t('editorLineBadge')}
                    </span>
                  ) : null}
                  {active ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {onToggleTerminal ? (
        <button
          type="button"
          onClick={onToggleTerminal}
          className={topbarActionButtonClass(terminalOpen)}
          data-tooltip={t('rightPanelTerminal')}
          aria-label={t('rightPanelTerminal')}
          aria-pressed={terminalOpen}
        >
          <Terminal className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
        </button>
      ) : null}

      {onToggleRightWorkspace ? (
        <button
          type="button"
          onClick={onToggleRightWorkspace}
          className={topbarActionButtonClass(rightWorkspaceExpanded)}
          data-tooltip={t('rightPanelWorkspaceToggle')}
          aria-label={t('rightPanelWorkspaceToggle')}
          aria-pressed={rightWorkspaceExpanded}
        >
          <PanelRight className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  )
}

export function WorkbenchSideRail({
  rightPanelMode,
  onToggleRightPanelMode,
  planPanelEnabled = false,
  canvasEnabled = false,
  sideChatCount = 0,
  sideChatRunningCount = 0,
  sideChatOpen = false,
  sideChatEnabled = true,
  fileTreeOpen = false,
  fileTreeEnabled = true,
  onToggleFileTree,
  onOpenSideChat,
  extensionItems = [],
  extensionContainers = [],
  onSelectExtension
}: Props): ReactElement {
  const { t } = useTranslation(['common', 'settings'])
  const items = [
    { mode: BUILTIN_RIGHT_PANEL_IDS.todo, label: t('rightPanelTodo'), icon: ListTodo },
    ...(planPanelEnabled ? [{ mode: BUILTIN_RIGHT_PANEL_IDS.plan, label: t('rightPanelPlan'), icon: ClipboardList }] : []),
    { mode: BUILTIN_RIGHT_PANEL_IDS.changes, label: t('rightPanelChanges'), icon: FileEdit },
    { mode: BUILTIN_RIGHT_PANEL_IDS.browser, label: t('rightPanelBrowser'), icon: Globe2 },
    ...(canvasEnabled ? [{ mode: BUILTIN_RIGHT_PANEL_IDS.canvas, label: t('rightPanelWhiteboard'), icon: Shapes }] : []),
    { mode: BUILTIN_RIGHT_PANEL_IDS.subagents, label: t('rightPanelSubagents'), icon: Bot },
    { mode: BUILTIN_RIGHT_PANEL_IDS.mcpSkills, label: t('rightPanelMcpSkills'), icon: Blocks }
  ]

  return (
    <div className="ds-no-drag flex h-full w-12 shrink-0 flex-col items-center gap-1.5 border-l border-ds-border-muted bg-white/80 py-3 backdrop-blur-xl dark:bg-ds-canvas">
      {onOpenSideChat ? (
        <button
          type="button"
          onClick={onOpenSideChat}
          disabled={!sideChatEnabled}
          className={sideRailButtonClass(sideChatOpen, 'relative disabled:cursor-not-allowed disabled:opacity-45')}
          data-tooltip={t('sidePanelOpen')}
          aria-label={t('sidePanelOpen')}
          aria-pressed={sideChatOpen}
        >
          <MessageCircleMore className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
          {sideChatCount > 0 ? (
            <span className="absolute -left-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
              {Math.min(sideChatCount, 9)}
            </span>
          ) : null}
          {sideChatRunningCount > 0 ? (
            <span className="absolute -bottom-0.5 -left-0.5 h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.18)]" />
          ) : null}
        </button>
      ) : null}

      {items.map((item) => {
        const active = rightPanelMode === item.mode
        const Icon = item.icon
        return (
          <button
            key={item.mode}
            type="button"
            onClick={() => onToggleRightPanelMode(item.mode)}
            className={sideRailButtonClass(active)}
            data-tooltip={item.label}
            aria-label={item.label}
            aria-pressed={active}
          >
            <Icon className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
          </button>
        )
      })}

      {extensionContainers.map(({ container, target }) => {
        if (container.owner.kind !== 'extension') return null
        const active = rightPanelMode === target.id
        const icon = container.payload.icon
        const title = boundedPlainText(container.payload.title, 128)
        const label = target.workspaceTrusted
          ? title
          : t('extensionRailAuthorize', { title })
        return (
          <button
            key={container.id}
            type="button"
            onClick={() => onSelectExtension
              ? onSelectExtension(target)
              : onToggleRightPanelMode(target.id as Exclude<RightPanelMode, null>)}
            className={sideRailButtonClass(active, 'relative')}
            data-tooltip={label}
            aria-label={label}
            aria-pressed={active}
            data-contribution-id={container.id}
            data-extension-trusted={String(target.workspaceTrusted)}
          >
            {icon ? (
              <img
                src={extensionHostIconUrl(container.owner.extensionId, icon)}
                alt=""
                aria-hidden="true"
                className={TOPBAR_ICON_CLASS}
              />
            ) : (
              <Puzzle className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
            )}
            {!target.workspaceTrusted ? (
              <span className="absolute -bottom-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm" aria-hidden>
                <LockKeyhole className="h-2.5 w-2.5" strokeWidth={2.25} />
              </span>
            ) : null}
          </button>
        )
      })}

      {extensionItems.map((item) => {
        if (item.owner.kind !== 'extension') return null
        if (extensionContainers.some(({ target }) => target.id === item.id)) return null
        const active = rightPanelMode === item.id
        const icon = item.payload.icon
        const title = boundedPlainText(item.payload.title, 128)
        const label = item.workspaceTrusted
          ? title
          : t('extensionRailAuthorize', { title })
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectExtension
              ? onSelectExtension(item)
              : onToggleRightPanelMode(item.id as Exclude<RightPanelMode, null>)}
            className={sideRailButtonClass(active, 'relative')}
            data-tooltip={label}
            aria-label={label}
            aria-pressed={active}
            data-contribution-id={item.id}
            data-extension-trusted={String(item.workspaceTrusted)}
          >
            {icon ? (
              <img
                src={extensionHostIconUrl(item.owner.extensionId, icon)}
                alt=""
                aria-hidden="true"
                className={TOPBAR_ICON_CLASS}
              />
            ) : (
              <Puzzle className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
            )}
            {!item.workspaceTrusted ? (
              <span className="absolute -bottom-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm" aria-hidden>
                <LockKeyhole className="h-2.5 w-2.5" strokeWidth={2.25} />
              </span>
            ) : null}
          </button>
        )
      })}

      {onToggleFileTree ? (
        <button
          type="button"
          onClick={onToggleFileTree}
          disabled={!fileTreeEnabled}
          className={sideRailButtonClass(fileTreeOpen, 'disabled:cursor-not-allowed disabled:opacity-45')}
          data-tooltip={t('rightPanelFiles')}
          aria-label={t('rightPanelFiles')}
          aria-pressed={fileTreeOpen}
        >
          <Folders className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
        </button>
      ) : null}

    </div>
  )
}
