import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactElement
} from 'react'
import {
  Blocks,
  Bot,
  ClipboardList,
  FileEdit,
  Files,
  Gauge,
  Globe2,
  GitBranch,
  GitCompare,
  IdCard,
  MessageCircleMore,
  PanelRightClose,
  Pin,
  Plus,
  Puzzle,
  Radio,
  ScanSearch,
  Shapes,
  Shirt,
  Users,
  X,
  type LucideIcon,
  AppWindow
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  extensionHostIconUrl,
  type ExtensionRightRailViewEntry
} from '../../extensions/contribution-registry'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isExtensionContributionId,
  workerIdFromSessionTab,
  type RightPanelContributionId
} from '../../extensions/contribution-ids'
import { boundedPlainText } from '../../extensions/safe-text'
import { useWorkerViewStore } from '../workers/worker-view-store'
import { WorkerSessionTabDot } from '../workers/WorkerSessionTabDot'
import type { CodeRightTabsState } from './code-right-tabs-state'
import { FileTypeIcon } from '../FileTypeIcon'
import type {
  FilePreviewHostTab,
  FilePreviewHostTabActions,
  FilePreviewHostTabs
} from '../workspace-file-preview-host-tabs'
import './code-right-tabs.css'

type Props = {
  state: CodeRightTabsState
  domIdPrefix: string
  titles?: Readonly<Record<string, string>>
  sideConversationCount: number
  sideConversationRunningCount: number
  extensionItems: readonly ExtensionRightRailViewEntry[]
  onActivate: (id: RightPanelContributionId) => void
  onClose: (id: RightPanelContributionId) => void
  onCollapse: () => void
  onNewSideConversation?: () => void
  /** Open files of the file tab, drawn as one tab each. */
  fileTabs?: FilePreviewHostTabs | null
  fileTabActions?: MutableRefObject<FilePreviewHostTabActions | null>
}

type StripItem = {
  key: string
  id: RightPanelContributionId
  file?: FilePreviewHostTab
}

type BuiltinTab = {
  id: RightPanelContributionId
  label: string
  icon: LucideIcon
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-')
}

export function CodeRightPanelTabs({
  state,
  domIdPrefix,
  titles = {},
  sideConversationCount,
  sideConversationRunningCount,
  extensionItems,
  onActivate,
  onClose,
  onCollapse,
  onNewSideConversation,
  fileTabs,
  fileTabActions
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const idPrefix = safeDomId(domIdPrefix)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const tabListRef = useRef<HTMLDivElement>(null)
  const workerLabels = useWorkerViewStore((s) => s.labels)
  const tabOrder = `${state.tabs.join('\n')}\n${fileTabs?.tabs.map((tab) => tab.key).join('\n') ?? ''}`
  const activeTitle = state.activeId ? titles[state.activeId] : undefined
  const activeRevealKey = state.activeId === BUILTIN_RIGHT_PANEL_IDS.file && fileTabs?.tabs.length
    ? `${state.activeId}\n${fileTabs.activeKey}`
    : state.activeId
  useLayoutEffect(() => {
    const list = tabListRef.current
    if (!list || !state.expanded || !activeRevealKey) return
    let live = true
    const reveal = () => { if (live) tabRefs.current.get(activeRevealKey)?.parentElement?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }
    reveal()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal)
    observer?.observe(list)
    return () => { live = false; observer?.disconnect() }
  }, [activeRevealKey, state.expanded, tabOrder, activeTitle])

  const builtinTabs = useMemo<BuiltinTab[]>(() => [
    { id: BUILTIN_RIGHT_PANEL_IDS.browser, label: t('rightPanelBrowserTool'), icon: Globe2 },
    { id: BUILTIN_RIGHT_PANEL_IDS.files, label: t('rightPanelFiles'), icon: Files },
    {
      id: BUILTIN_RIGHT_PANEL_IDS.sideConversations,
      label: t('rightPanelSideConversations'),
      icon: MessageCircleMore
    },
    { id: BUILTIN_RIGHT_PANEL_IDS.plan, label: t('rightPanelPlan'), icon: ClipboardList },
    { id: BUILTIN_RIGHT_PANEL_IDS.changes, label: t('rightPanelChanges'), icon: FileEdit },
    { id: BUILTIN_RIGHT_PANEL_IDS.canvas, label: t('rightPanelWhiteboard'), icon: Shapes },
    {
      id: BUILTIN_RIGHT_PANEL_IDS.graph,
      label: t('rightPanelGraph', { defaultValue: 'Graph' }),
      icon: GitBranch
    },
    { id: BUILTIN_RIGHT_PANEL_IDS.subagents, label: t('rightPanelSubagents'), icon: Bot },
    { id: BUILTIN_RIGHT_PANEL_IDS.mcpSkills, label: t('rightPanelMcpSkills'), icon: Blocks },
    {
      id: BUILTIN_RIGHT_PANEL_IDS.providerQuotas,
      label: t('rightPanelProviderQuotas'),
      icon: Gauge
    },
    { id: BUILTIN_RIGHT_PANEL_IDS.remote, label: t('rightPanelRemote'), icon: Radio },
    {
      id: BUILTIN_RIGHT_PANEL_IDS.review,
      label: t('rightPanelReview', { defaultValue: 'Review' }),
      icon: GitCompare
    },
    {
      id: BUILTIN_RIGHT_PANEL_IDS.workers,
      label: t('rightPanelWorkers', { defaultValue: 'Workers' }),
      icon: Users
    },
    { id: BUILTIN_RIGHT_PANEL_IDS.conversationInfo, label: t('conversationInfoTab'), icon: IdCard },
    { id: BUILTIN_RIGHT_PANEL_IDS.wardrobe, label: t('rightPanelWardrobe'), icon: Shirt },
  ], [t])

  const builtinById = useMemo(
    () => new Map(builtinTabs.map((tab) => [tab.id, tab])),
    [builtinTabs]
  )
  const extensionById = useMemo(
    () => new Map(extensionItems.map((entry) => [entry.id, entry])),
    [extensionItems]
  )

  const tabMeta = (id: RightPanelContributionId): {
    label: string
    icon: LucideIcon | null
    iconUrl?: string
    workerId?: string
  } => {
    const dynamicTitle = titles[id]?.trim()
    const workerId = workerIdFromSessionTab(id)
    if (workerId) {
      return { label: workerLabels[workerId] || dynamicTitle || t('workerTab.fallbackTitle'), icon: null, workerId }
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.file) {
      return { label: dynamicTitle || t('filePreviewTitle'), icon: FileEdit }
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.browser) {
      return { label: dynamicTitle || t('rightPanelNewBrowserTab'), icon: Globe2 }
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.appSurface) {
      return { label: dynamicTitle || t('appSurfacePanelTab'), icon: AppWindow }
    }
    const builtin = builtinById.get(id)
    if (builtin) return { label: dynamicTitle || builtin.label, icon: builtin.icon }
    const extension = extensionById.get(id)
    if (extension) {
      return {
        label: dynamicTitle || boundedPlainText(extension.payload.title, 128),
        icon: extension.payload.icon ? null : Puzzle,
        ...(extension.payload.icon && extension.owner.kind === 'extension'
          ? { iconUrl: extensionHostIconUrl(extension.owner.extensionId, extension.payload.icon) }
          : {})
      }
    }
    return { label: dynamicTitle || t('rightPanelUnavailable'), icon: Puzzle }
  }

  const fileModel = fileTabs?.tabs.length ? fileTabs : null
  const items: StripItem[] = state.tabs.flatMap((id): StripItem[] => (
    id === BUILTIN_RIGHT_PANEL_IDS.file && fileModel
      ? fileModel.tabs.map((file) => ({ key: `${id}\n${file.key}`, id, file }))
      : [{ key: id, id }]
  ))
  const itemActive = (item: StripItem): boolean => state.activeId === item.id &&
    (!item.file || item.file.key === fileModel?.activeKey)
  const activeItemKey = items.find(itemActive)?.key

  const activateItem = (item: StripItem): void => {
    onActivate(item.id)
    if (item.file) fileTabActions?.current?.select(item.file.target)
  }
  const closeItem = (item: StripItem): void => {
    if (item.file) fileTabActions?.current?.requestClose(item.file.target, item.file.dirty)
    else onClose(item.id)
  }

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, item: StripItem, index: number): void => {
    if (item.file && fileTabActions?.current?.openMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      fileTabActions.current.openMenu(event, item.file.target)
      return
    }
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = items.length - 1
    else if (event.key === 'Delete') {
      event.preventDefault()
      closeItem(item)
      return
    } else return
    event.preventDefault()
    const next = items[nextIndex]
    if (!next) return
    activateItem(next)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => tabRefs.current.get(next.key)?.focus())
    }
  }

  return (
    <div className="ds-code-right-tabs ds-sidebar-surface-chrome ds-no-drag relative flex shrink-0 items-center">
      <div
        ref={tabListRef}
        role="tablist"
        aria-label={t('rightPanelTabs')}
        className="ds-code-right-tabs__list flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, index) => {
          const active = itemActive(item)
          const meta = item.file
            ? { label: item.file.label, icon: null }
            : tabMeta(item.id)
          const Icon = meta.icon
          const domIds = codeRightTabDomIds(idPrefix, item.id)
          // The tab panel is labelled by the active chip of a multi-file tab.
          const tabId = item.file && !active ? `${domIds.tabId}-${safeDomId(item.file.key)}` : domIds.tabId
          const closeLabel = t('rightPanelCloseTab', { title: meta.label })
          return (
            <Fragment key={item.key}>
            <div
              data-active={active ? 'true' : 'false'}
              data-kind={item.file ? 'file' : 'panel'}
              title={item.file?.title}
              className="ds-right-tab group"
            >
              <button
                ref={(node) => {
                  if (node) tabRefs.current.set(item.key, node)
                  else tabRefs.current.delete(item.key)
                }}
                type="button"
                id={tabId}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-label={meta.label}
                aria-selected={active}
                aria-controls={domIds.panelId}
                onClick={() => activateItem(item)}
                onDoubleClick={item.file ? () => fileTabActions?.current?.openInEditor(item.file!.target) : undefined}
                onContextMenu={item.file && fileTabActions?.current?.openMenu
                  ? (event) => fileTabActions.current?.openMenu?.(event, item.file!.target)
                  : undefined}
                onKeyDown={(event) => handleTabKeyDown(event, item, index)}
                className="ds-right-tab__select"
              >
                {item.file ? (
                  <>
                    {item.file.pinned ? <Pin aria-hidden className="ds-right-tab__pin" strokeWidth={1.8} /> : null}
                    <FileTypeIcon path={item.file.target.path} size={14} />
                  </>
                ) : 'workerId' in meta && meta.workerId ? (
                  <WorkerSessionTabDot workerId={meta.workerId} active={active} />
                ) : 'iconUrl' in meta && meta.iconUrl ? (
                  <img src={meta.iconUrl} alt="" aria-hidden className="ds-right-tab__icon object-contain" />
                ) : Icon ? (
                  <Icon className="ds-right-tab__icon" strokeWidth={1.8} />
                ) : null}
                {item.file?.dirty ? (
                  <span aria-label={t('filePreviewUnsavedChanges', { defaultValue: 'Unsaved changes' })} className="ds-right-tab__dirty" />
                ) : null}
                <span className="ds-right-tab__label">{meta.label}</span>
                {item.id === BUILTIN_RIGHT_PANEL_IDS.sideConversations && !active && sideConversationCount > 0 ? (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] text-white">
                    {Math.min(sideConversationCount, 99)}
                  </span>
                ) : null}
                {item.id === BUILTIN_RIGHT_PANEL_IDS.sideConversations && sideConversationRunningCount > 0 ? (
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-label={t('sidePanelRunningDot')} />
                ) : null}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  closeItem(item)
                }}
                aria-label={closeLabel}
                title={closeLabel}
                className="ds-right-tab__close"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>
            {item.id === BUILTIN_RIGHT_PANEL_IDS.sideConversations && active && onNewSideConversation ? (
              <button
                type="button"
                onClick={onNewSideConversation}
                aria-label={t('sidePanelNew')}
                title={t('sidePanelNew')}
                className="ds-right-tabs__icon-button"
              >
                <Plus className="h-4 w-4" strokeWidth={1.8} />
              </button>
            ) : null}
            </Fragment>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onCollapse}
        aria-label={t('rightPanelCollapse')}
        title={t('rightPanelCollapse')}
        className="ds-right-tabs__icon-button"
      >
        <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </div>
  )
}

export function codeRightTabDomIds(prefix: string, id: RightPanelContributionId): { tabId: string; panelId: string } {
  const safePrefix = safeDomId(prefix)
  const safeId = safeDomId(id)
  return {
    tabId: `${safePrefix}-tab-${safeId}`,
    panelId: `${safePrefix}-panel-${safeId}`
  }
}

export function isCodeRightExtensionTab(id: RightPanelContributionId): boolean {
  return isExtensionContributionId(id)
}
