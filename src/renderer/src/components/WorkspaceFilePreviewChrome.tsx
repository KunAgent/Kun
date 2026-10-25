import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  ReactElement,
  RefObject,
  WheelEvent as ReactWheelEvent
} from 'react'
import {
  ChevronDown,
  ExternalLink,
  Eye,
  FolderTree,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelRightClose,
  Pencil,
  Pin,
  X
} from 'lucide-react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { formatFilePathForDisplay } from '../lib/diff-stats'
import { FileTypeIcon } from './FileTypeIcon'
import { PreviewMenuButton, type PreviewMenuItem } from './WorkspaceFilePreviewMenus'
import { fileNameFromPath, targetKey } from './workspace-file-preview-support'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type PreviewViewMode = {
  /** Label of the rendered view: "Preview", "Table", ... */
  renderedLabel: string
  rendered: boolean
  disabled: boolean
  onShowRendered: () => void
  onShowSource: () => void
}

type Props = {
  t: Translate
  /** The hosting panel already shows the open files as tabs. */
  hostTabs?: boolean
  tabsScrollRef: RefObject<HTMLDivElement | null>
  handleTabWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
  visibleTargets: WorkspaceFileTarget[]
  target: WorkspaceFileTarget | null
  activeTargetKey: string
  dirtyTargetKeys: Set<string>
  textDirty: boolean
  pinnedTargetKeySet: Set<string>
  workspaceRoot: string
  tabButtonRefs: MutableRefObject<Map<string, HTMLButtonElement>>
  onSelectTarget?: (target: WorkspaceFileTarget) => void
  openTargetInEditor: (target: WorkspaceFileTarget) => void
  tabActionsEnabled: boolean
  openTabMenu: (event: ReactMouseEvent<HTMLButtonElement>, target: WorkspaceFileTarget) => void
  handleTabKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, target: WorkspaceFileTarget, index: number) => void
  onRequestCloseTarget?: (target: WorkspaceFileTarget, dirty: boolean) => void
  currentFileName: string
  breadcrumbSegments: string[]
  viewMode: PreviewViewMode | null
  editableText: boolean
  editingText: boolean
  onToggleEditing: () => void
  readingMode: boolean
  onToggleReadingMode: () => void
  openWithItems: PreviewMenuItem[]
  moreItems: PreviewMenuItem[]
  onToggleFileTree?: () => void
  fileTreeOpen: boolean
  onClose: () => void
}

const ICON_BUTTON = 'ds-code-sidebar-icon-button'

export function WorkspaceFilePreviewChrome(props: Props): ReactElement {
  const {
    t,
    hostTabs = false,
    tabsScrollRef,
    handleTabWheel,
    visibleTargets,
    target,
    activeTargetKey,
    dirtyTargetKeys,
    textDirty,
    pinnedTargetKeySet,
    workspaceRoot,
    tabButtonRefs,
    onSelectTarget,
    openTargetInEditor,
    tabActionsEnabled,
    openTabMenu,
    handleTabKeyDown,
    onRequestCloseTarget,
    currentFileName,
    breadcrumbSegments,
    viewMode,
    editableText,
    editingText,
    onToggleEditing,
    readingMode,
    onToggleReadingMode,
    openWithItems,
    moreItems,
    onToggleFileTree,
    fileTreeOpen,
    onClose
  } = props
  const editLabel = editingText
    ? t('filePreviewStopEditing', { defaultValue: 'Stop editing' })
    : t('filePreviewEditText', { defaultValue: 'Edit file' })
  const fileTreeLabel = fileTreeOpen ? t('fileTreeClose') : t('fileTreeOpen')
  const toggleFileTree = (): void => {
    if (readingMode) onToggleReadingMode()
    onToggleFileTree?.()
  }
  return (
    <>
      {hostTabs ? null : <div className="ds-code-sidebar-topbar">
        <div
          ref={tabsScrollRef}
          className="ds-code-sidebar-tabs"
          role="tablist"
          aria-label={t('filePreviewOpenFiles')}
          onWheel={handleTabWheel}
        >
          {visibleTargets.map((item, index) => {
            const itemKey = targetKey(item)
            const active = itemKey === activeTargetKey
            const dirty = dirtyTargetKeys.has(itemKey) || (active && textDirty)
            const pinned = pinnedTargetKeySet.has(itemKey)
            const itemLabel = fileNameFromPath(item.path)
            const itemTitle = formatFilePathForDisplay(item.path, item.workspaceRoot ?? workspaceRoot) ?? item.path
            return (
              <div
                key={itemKey}
                data-kun-preview-key={itemKey}
                role="presentation"
                className={`ds-code-sidebar-tab ${active ? 'is-active' : ''}`}
              >
                <button
                  ref={(element) => {
                    if (element) tabButtonRefs.current.set(itemKey, element)
                    else tabButtonRefs.current.delete(itemKey)
                  }}
                  type="button"
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  aria-selected={active}
                  aria-label={pinned ? t('filePreviewPinnedTab', { file: itemLabel }) : itemLabel}
                  className="ds-code-sidebar-tab-selector"
                  title={itemTitle}
                  onClick={() => onSelectTarget?.(item)}
                  onDoubleClick={() => openTargetInEditor(item)}
                  onContextMenu={tabActionsEnabled ? (event) => openTabMenu(event, item) : undefined}
                  onKeyDown={(event) => handleTabKeyDown(event, item, index)}
                >
                  {pinned ? (
                    <Pin aria-hidden="true" className="h-3 w-3 shrink-0" style={{ color: 'var(--ds-accent)' }} strokeWidth={1.8} />
                  ) : null}
                  <FileTypeIcon path={item.path} size={14} />
                  <span className="min-w-0 truncate">{itemLabel}</span>
                  {dirty ? (
                    <span
                      aria-label={t('filePreviewUnsavedChanges', { defaultValue: 'Unsaved changes' })}
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ds-git-modified)]"
                    />
                  ) : null}
                </button>
                {onRequestCloseTarget ? (
                  <button
                    type="button"
                    aria-label={t('filePreviewCloseTab', { file: itemLabel })}
                    title={t('filePreviewCloseTab', { file: itemLabel })}
                    className="ds-code-sidebar-tab-close"
                    onClick={() => onRequestCloseTarget(item, dirty)}
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                ) : null}
              </div>
            )
          })}
          {!visibleTargets.length ? (
            <div role="presentation" className="ds-code-sidebar-tab is-active" title={t('filePreviewEmpty')}>
              <button type="button" role="tab" aria-selected="false" disabled className="ds-code-sidebar-tab-selector">
                <span className="truncate">{currentFileName}</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="ds-code-sidebar-actions">
          {onToggleFileTree ? (
            <button
              type="button"
              onClick={toggleFileTree}
              className={`${ICON_BUTTON} ${fileTreeOpen ? 'is-active' : ''}`}
              title={fileTreeLabel}
              aria-label={fileTreeLabel}
              aria-pressed={fileTreeOpen}
            >
              <FolderTree className="h-4 w-4" strokeWidth={1.75} />
            </button>
          ) : null}
          <button type="button" onClick={onClose} className={ICON_BUTTON} title={t('rightPanelCollapse')} aria-label={t('rightPanelCollapse')}>
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>
      </div>}

      <div className={`ds-code-sidebar-breadcrumbs ${hostTabs ? 'is-hosted' : ''}`}>
        {hostTabs && onToggleFileTree ? (
          <button
            type="button"
            onClick={toggleFileTree}
            className={`${ICON_BUTTON} ${fileTreeOpen ? 'is-active' : ''}`}
            title={fileTreeLabel}
            aria-label={fileTreeLabel}
            aria-pressed={fileTreeOpen}
          >
            <FolderTree className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : null}
        <nav aria-label={t('filePreviewPath')} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {breadcrumbSegments.length ? breadcrumbSegments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="contents">
              {index > 0 ? <span aria-hidden="true" className="shrink-0 text-ds-faint">/</span> : null}
              <span
                className={index === breadcrumbSegments.length - 1 ? 'truncate font-semibold text-ds-ink' : 'truncate text-ds-muted'}
                title={segment}
              >
                {segment}
              </span>
            </span>
          )) : (
            <span className="truncate text-ds-muted">{t('filePreviewEmpty')}</span>
          )}
        </nav>
        {viewMode ? (
          <div role="group" aria-label={t('filePreviewViewMode')} className="inline-flex shrink-0 rounded-lg bg-ds-subtle p-0.5">
            <button
              type="button"
              aria-pressed={viewMode.rendered}
              aria-label={viewMode.renderedLabel}
              disabled={viewMode.disabled}
              onClick={viewMode.onShowRendered}
              className={`inline-flex h-6 items-center gap-1 rounded-md px-2.5 text-[12px] font-semibold transition disabled:opacity-45 ${
                viewMode.rendered ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
              {viewMode.renderedLabel}
            </button>
            <button
              type="button"
              aria-pressed={!viewMode.rendered}
              aria-label={t('filePreviewShowSource')}
              disabled={viewMode.disabled}
              onClick={viewMode.onShowSource}
              className={`inline-flex h-6 items-center rounded-md px-2.5 text-[12px] font-semibold transition disabled:opacity-45 ${
                !viewMode.rendered ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              {t('filePreviewSourceTab')}
            </button>
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-0.5">
          {editableText ? (
            <button
              type="button"
              onClick={onToggleEditing}
              className={`${ICON_BUTTON} ${editingText ? 'is-active' : ''}`}
              title={editLabel}
              aria-label={editLabel}
              aria-pressed={editingText}
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          ) : null}
          <PreviewMenuButton
            label={t('filePreviewOpenWith')}
            items={openWithItems}
            className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span className="ds-file-preview-openwith-label">{t('filePreviewOpenWith')}</span>
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          </PreviewMenuButton>
          <PreviewMenuButton label={t('filePreviewMoreActions')} items={moreItems} className={ICON_BUTTON}>
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
          </PreviewMenuButton>
          <button
            type="button"
            onClick={onToggleReadingMode}
            disabled={!target && !readingMode}
            className={ICON_BUTTON}
            title={readingMode ? t('filePreviewExitReadingMode') : t('filePreviewEnterReadingMode')}
            aria-label={readingMode ? t('filePreviewExitReadingMode') : t('filePreviewEnterReadingMode')}
            aria-pressed={readingMode}
          >
            {readingMode ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} /> : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
          </button>
        </div>
      </div>
    </>
  )
}
