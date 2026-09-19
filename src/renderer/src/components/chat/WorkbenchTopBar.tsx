import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorInfo } from '@shared/editor'
import { WorkbenchGuiUpdateButton } from './WorkbenchGuiUpdateButton'
import {
  Blocks,
  Bot,
  Check,
  Code2,
  ClipboardList,
  Ellipsis,
  FileEdit,
  Folders,
  FolderOpen,
  Globe2,
  Gauge,
  GitBranch,
  LockKeyhole,
  Loader2,
  MessageCircleMore,
  PanelRight,
  Puzzle,
  Radio,
  RefreshCw,
  Search,
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
import { useRemoteMobileLayout } from '../../lib/remote-mobile'

export type { RightPanelMode } from '../../extensions/contribution-ids'

type Props = {
  rightPanelMode: RightPanelMode
  onToggleRightPanelMode: (mode: Exclude<RightPanelMode, null>) => void
  /** 'rail' renders the desktop icon column; 'sheet' renders a mobile bottom sheet. */
  presentation?: 'rail' | 'sheet'
  sheetOpen?: boolean
  onCloseSheet?: () => void
  planPanelEnabled?: boolean
  canvasEnabled?: boolean
  graphEnabled?: boolean
  sideChatRunningCount?: number
  sideChatOpen?: boolean
  sideChatEnabled?: boolean
  /** @deprecated Agent Perspective moved to the center trajectory view. */
  agentPerspectiveEnabled?: boolean
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
  onOpenCommandPalette?: () => void
  /** Remote-mobile only: opens the right rail as a bottom sheet. */
  onOpenMobileRail?: () => void
}

const TOPBAR_ICON_CLASS = 'h-4 w-4'
const SIDE_RAIL_BUTTON_BASE =
  'ds-side-rail-button inline-flex h-8 w-8 items-center justify-center rounded-[var(--ds-radius-control)] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30'
const SIDE_RAIL_BUTTON_ACTIVE = 'border-ds-border-strong bg-ds-card text-ds-ink'
const SIDE_RAIL_BUTTON_IDLE =
  'border-transparent bg-transparent text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-ds-hover hover:text-ds-ink hover:opacity-100'
const TOPBAR_ACTION_BUTTON_BASE =
  'ds-topbar-action-button inline-flex h-8 w-8 items-center justify-center rounded-[var(--ds-radius-control)] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30'

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
  onToggleRightWorkspace,
  onOpenCommandPalette,
  onOpenMobileRail
}: WorkbenchTopActionsProps): ReactElement {
  const { t } = useTranslation(['common', 'settings'])
  const remoteMobile = useRemoteMobileLayout()
  const [editors, setEditors] = useState<EditorInfo[]>([])
  const [selectedEditorId, setSelectedEditorId] = useState(() => readPreferredEditorId() ?? '')
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [failedIconIds, setFailedIconIds] = useState<Set<string>>(() => new Set())
  const [restartingKunServe, setRestartingKunServe] = useState(false)
  const [restartKunServeError, setRestartKunServeError] = useState('')
  const restartKunServeAvailable =
    typeof window !== 'undefined' && typeof window.kunGui?.restartKunServe === 'function'
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

  const restartKunServe = async (): Promise<void> => {
    if (restartingKunServe || !restartKunServeAvailable) return
    setRestartKunServeError('')
    setRestartingKunServe(true)
    try {
      const result = await window.kunGui.restartKunServe()
      if (result.error) setRestartKunServeError(result.error)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRestartKunServeError(message)
      if (typeof window.kunGui?.logError === 'function') {
        await window.kunGui.logError('runtime-restart-serve', 'Top bar Kun service restart failed', { message })
      }
    } finally {
      setRestartingKunServe(false)
    }
  }

  return (
    <div className="ds-workbench-top-actions ds-no-drag relative flex shrink-0 items-center gap-1.5">
      {onOpenCommandPalette ? (
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className={topbarActionButtonClass(false)}
          data-tooltip={t('paletteOpenTooltip')}
          aria-label={t('paletteOpenTooltip')}
        >
          <Search className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
        </button>
      ) : null}

      <WorkbenchGuiUpdateButton />

      {/* Host-side affordances (editor picker, runtime restart) are dropped on
          Remote mobile — they operate on the desktop host and crowd the bar. */}
      {!remoteMobile ? (
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
          <div className="ds-card-strong absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-[var(--ds-radius-card)] border border-ds-border py-1.5 shadow-[var(--ds-shadow-overlay)]">
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
      ) : null}

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

      {/* On Remote mobile the right rail opens as the "…" bottom sheet, so
          the expand-workspace toggle only duplicates it. */}
      {onToggleRightWorkspace && !(remoteMobile && onOpenMobileRail) ? (
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

      {!remoteMobile ? (
      <button
        type="button"
        onClick={() => void restartKunServe()}
        disabled={restartingKunServe || !restartKunServeAvailable}
        className="ds-topbar-action-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ds-radius-control)] border border-amber-200/75 bg-white/70 text-amber-600/85 shadow-[0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-sm transition hover:border-amber-300/90 hover:bg-amber-50/90 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800/55 dark:bg-amber-950/15 dark:text-amber-400/85 dark:shadow-none dark:hover:border-amber-700/80 dark:hover:bg-amber-950/35 dark:hover:text-amber-300"
        data-tooltip={restartingKunServe
          ? t('restartKunServeRestarting')
          : restartKunServeError || t('restartKunServeTooltip')}
        data-tooltip-wrap="true"
        aria-label={restartingKunServe
          ? t('restartKunServeRestarting')
          : t('restartKunServe')}
      >
        {restartingKunServe ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <RefreshCw className="h-4 w-4" strokeWidth={1.85} />
        )}
      </button>
      ) : null}

      {onOpenMobileRail ? (
        <button
          type="button"
          onClick={onOpenMobileRail}
          className={topbarActionButtonClass(false)}
          data-tooltip={t('rightPanelMore')}
          aria-label={t('rightPanelMore')}
          aria-haspopup="dialog"
        >
          <Ellipsis className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  )
}

export function WorkbenchSideRail({
  rightPanelMode,
  onToggleRightPanelMode,
  presentation = 'rail',
  sheetOpen = false,
  onCloseSheet,
  planPanelEnabled = false,
  canvasEnabled = false,
  graphEnabled = false,
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
}: Props): ReactElement | null {
  const { t } = useTranslation(['common', 'settings'])
  // The Remote panel configures this host; hide the entry inside Remote clients.
  const isRemoteWeb = typeof window !== 'undefined' && window.kunGui?.isRemoteWeb === true
  const items = [
    ...(planPanelEnabled ? [{ mode: BUILTIN_RIGHT_PANEL_IDS.plan, label: t('rightPanelPlan'), icon: ClipboardList }] : []),
    { mode: BUILTIN_RIGHT_PANEL_IDS.changes, label: t('rightPanelChanges'), icon: FileEdit },
    { mode: BUILTIN_RIGHT_PANEL_IDS.browser, label: t('rightPanelBrowser'), icon: Globe2 },
    ...(canvasEnabled ? [{ mode: BUILTIN_RIGHT_PANEL_IDS.canvas, label: t('rightPanelWhiteboard'), icon: Shapes }] : []),
    ...(graphEnabled ? [{
      mode: BUILTIN_RIGHT_PANEL_IDS.graph,
      label: t('rightPanelGraph', { defaultValue: 'Graph' }),
      icon: GitBranch
    }] : []),
    { mode: BUILTIN_RIGHT_PANEL_IDS.subagents, label: t('rightPanelSubagents'), icon: Bot },
    { mode: BUILTIN_RIGHT_PANEL_IDS.mcpSkills, label: t('rightPanelMcpSkills'), icon: Blocks },
    {
      mode: BUILTIN_RIGHT_PANEL_IDS.providerQuotas,
      label: t('rightPanelProviderQuotas'),
      icon: Gauge
    },
    ...(isRemoteWeb ? [] : [{ mode: BUILTIN_RIGHT_PANEL_IDS.remote, label: t('rightPanelRemote'), icon: Radio }])
  ]

  if (presentation === 'sheet') {
    if (!sheetOpen) return null
    const pick = (action: () => void): void => {
      action()
      onCloseSheet?.()
    }
    const rowClass =
      'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45'
    const rowIconClass = 'h-5 w-5 shrink-0 text-ds-muted'
    const extensionEntries = [
      ...extensionContainers.map(({ container, target }) => ({ kind: 'container' as const, container, target })),
      ...extensionItems
        .filter((item) => !extensionContainers.some(({ target }) => target.id === item.id))
        .map((item) => ({ kind: 'item' as const, item }))
    ]
    return (
      <div className="ds-no-drag fixed inset-0 z-[70]" role="dialog" aria-modal="true">
        <button
          type="button"
          className="absolute inset-0 bg-black/45"
          onClick={() => onCloseSheet?.()}
          aria-label={t('close')}
        />
        <div className="ds-sidebar-surface absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-ds-border-muted px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-2 shadow-2xl">
          <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-ds-border-strong" aria-hidden />
          {onOpenSideChat ? (
            <button
              type="button"
              onClick={() => pick(onOpenSideChat)}
              disabled={!sideChatEnabled}
              className={rowClass}
              aria-pressed={sideChatOpen}
            >
              <MessageCircleMore className={rowIconClass} strokeWidth={1.75} />
              <span className="flex-1">{t('sidePanelOpen')}</span>
              {sideChatRunningCount > 0 ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
              ) : null}
            </button>
          ) : null}
          {items.map((item) => {
            const Icon = item.icon
            const active = rightPanelMode === item.mode
            return (
              <button
                key={item.mode}
                type="button"
                onClick={() => pick(() => onToggleRightPanelMode(item.mode))}
                disabled={'disabled' in item && item.disabled === true}
                className={rowClass}
                aria-pressed={active}
              >
                <Icon className={rowIconClass} strokeWidth={1.75} />
                <span className="flex-1">{item.label}</span>
                {active ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
              </button>
            )
          })}
          {onToggleFileTree ? (
            <button
              type="button"
              onClick={() => pick(onToggleFileTree)}
              disabled={!fileTreeEnabled}
              className={rowClass}
              aria-pressed={fileTreeOpen}
            >
              <Folders className={rowIconClass} strokeWidth={1.75} />
              <span className="flex-1">{t('rightPanelFiles')}</span>
              {fileTreeOpen ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
            </button>
          ) : null}
          {extensionEntries.length > 0 ? (
            <div className="mt-1 border-t border-ds-border-muted pt-1">
              {extensionEntries.map((entry) => {
                const target = entry.kind === 'container' ? entry.target : entry.item
                const owner = entry.kind === 'container' ? entry.container.owner : entry.item.owner
                const ownerId = owner.kind === 'extension' ? owner.extensionId : null
                const icon = entry.kind === 'container' ? entry.container.payload.icon : entry.item.payload.icon
                const title = boundedPlainText(
                  entry.kind === 'container' ? entry.container.payload.title : entry.item.payload.title,
                  128
                )
                const label = target.workspaceTrusted ? title : t('extensionRailAuthorize', { title })
                const active = rightPanelMode === target.id
                return (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => pick(() => onSelectExtension
                      ? onSelectExtension(target)
                      : onToggleRightPanelMode(target.id as Exclude<RightPanelMode, null>))}
                    className={rowClass}
                    aria-pressed={active}
                  >
                    {icon && ownerId ? (
                      <img src={extensionHostIconUrl(ownerId, icon)} alt="" aria-hidden className={rowIconClass} />
                    ) : (
                      <Puzzle className={rowIconClass} strokeWidth={1.75} />
                    )}
                    <span className="flex-1">{label}</span>
                    {!target.workspaceTrusted ? (
                      <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} />
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="ds-workbench-side-rail ds-sidebar-surface ds-no-drag flex h-full w-12 shrink-0 flex-col items-center gap-1.5 border-l border-ds-border-muted py-3">
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
            disabled={'disabled' in item && item.disabled === true}
            className={sideRailButtonClass(active, 'disabled:cursor-not-allowed disabled:opacity-45')}
            data-tooltip={item.label}
            aria-label={item.label}
            aria-pressed={active}
          >
            <Icon className={TOPBAR_ICON_CLASS} strokeWidth={1.75} />
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

      {extensionContainers.length > 0 || extensionItems.length > 0 ? (
        <div className="ds-extension-side-rail-group mt-auto flex shrink-0 flex-col items-center gap-1.5 border-t border-ds-border-muted pt-2">
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
        </div>
      ) : null}

    </div>
  )
}
