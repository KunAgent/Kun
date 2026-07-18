import {
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import {
  Blocks,
  Bot,
  ClipboardList,
  FileEdit,
  Files,
  Globe2,
  ListTodo,
  MessageCircleMore,
  PanelRightClose,
  Puzzle,
  Shapes,
  X,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  extensionHostIconUrl,
  type ExtensionRightRailViewEntry
} from '../../extensions/contribution-registry'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isExtensionContributionId,
  type RightPanelContributionId
} from '../../extensions/contribution-ids'
import { boundedPlainText } from '../../extensions/safe-text'
import type { CodeRightTabsState } from './code-right-tabs-state'

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
  onCollapse
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const idPrefix = safeDomId(domIdPrefix)
  const tabRefs = useRef(new Map<RightPanelContributionId, HTMLButtonElement>())

  const builtinTabs = useMemo<BuiltinTab[]>(() => [
    { id: BUILTIN_RIGHT_PANEL_IDS.browser, label: t('rightPanelBrowserTool'), icon: Globe2 },
    { id: BUILTIN_RIGHT_PANEL_IDS.files, label: t('rightPanelFiles'), icon: Files },
    {
      id: BUILTIN_RIGHT_PANEL_IDS.sideConversations,
      label: t('rightPanelSideConversations'),
      icon: MessageCircleMore
    },
    { id: BUILTIN_RIGHT_PANEL_IDS.todo, label: t('rightPanelTodoTool'), icon: ListTodo },
    { id: BUILTIN_RIGHT_PANEL_IDS.plan, label: t('rightPanelPlan'), icon: ClipboardList },
    { id: BUILTIN_RIGHT_PANEL_IDS.changes, label: t('rightPanelChangesReview'), icon: FileEdit },
    { id: BUILTIN_RIGHT_PANEL_IDS.canvas, label: t('rightPanelWhiteboard'), icon: Shapes },
    { id: BUILTIN_RIGHT_PANEL_IDS.subagents, label: t('rightPanelSubagents'), icon: Bot },
    { id: BUILTIN_RIGHT_PANEL_IDS.mcpSkills, label: t('rightPanelMcpSkills'), icon: Blocks }
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
  } => {
    const dynamicTitle = titles[id]?.trim()
    if (id === BUILTIN_RIGHT_PANEL_IDS.file) {
      return { label: dynamicTitle || t('filePreviewTitle'), icon: FileEdit }
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.browser) {
      return { label: dynamicTitle || t('rightPanelNewBrowserTab'), icon: Globe2 }
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

  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: RightPanelContributionId,
    index: number
  ): void => {
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % state.tabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + state.tabs.length) % state.tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = state.tabs.length - 1
    else if (event.key === 'Delete') {
      event.preventDefault()
      onClose(id)
      return
    } else return
    event.preventDefault()
    const nextId = state.tabs[nextIndex]
    onActivate(nextId)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => tabRefs.current.get(nextId)?.focus())
    }
  }

  return (
    <div className="ds-code-right-tabs ds-no-drag relative flex h-11 shrink-0 items-center gap-1 border-b border-ds-border-muted bg-ds-surface-subtle/90 px-2 backdrop-blur-xl dark:bg-ds-card/90">
      <div
        role="tablist"
        aria-label={t('rightPanelTabs')}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {state.tabs.map((id, index) => {
          const active = state.activeId === id
          const meta = tabMeta(id)
          const Icon = meta.icon
          const tabId = `${idPrefix}-tab-${safeDomId(id)}`
          const panelId = `${idPrefix}-panel-${safeDomId(id)}`
          return (
            <div
              key={id}
              className={`group flex h-8 min-w-[7rem] max-w-[15rem] shrink-0 items-center rounded-[9px] border transition ${
                active
                  ? 'border-ds-border-strong bg-ds-card text-ds-ink shadow-sm'
                  : 'border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              <button
                ref={(node) => {
                  if (node) tabRefs.current.set(id, node)
                  else tabRefs.current.delete(id)
                }}
                type="button"
                id={tabId}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                aria-controls={panelId}
                onClick={() => onActivate(id)}
                onKeyDown={(event) => handleTabKeyDown(event, id, index)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] font-semibold outline-none"
              >
                {meta.iconUrl ? (
                  <img src={meta.iconUrl} alt="" aria-hidden className="h-3.5 w-3.5 shrink-0 object-contain" />
                ) : Icon ? (
                  <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                {id === BUILTIN_RIGHT_PANEL_IDS.sideConversations && sideConversationCount > 0 ? (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] text-white">
                    {Math.min(sideConversationCount, 99)}
                  </span>
                ) : null}
                {id === BUILTIN_RIGHT_PANEL_IDS.sideConversations && sideConversationRunningCount > 0 ? (
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-label={t('sidePanelRunningDot')} />
                ) : null}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(id)
                }}
                aria-label={t('rightPanelCloseTab', { title: meta.label })}
                title={t('rightPanelCloseTab', { title: meta.label })}
                className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint opacity-0 transition hover:bg-ds-hover hover:text-ds-ink focus:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onCollapse}
        aria-label={t('rightPanelCollapse')}
        title={t('rightPanelCollapse')}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
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
