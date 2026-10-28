import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type ReactElement,
  type SetStateAction
} from 'react'
import { createPortal } from 'react-dom'
import { Copy, FolderSearch, Pin, PinOff, X } from 'lucide-react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { KunContextMenu, type KunContextMenuEntry, type KunContextMenuPoint } from './context-menu/KunContextMenu'
import type { FilePreviewCloseScope } from './workbench/file-preview-close-scope'
import {
  fileNameFromPath,
  targetKey,
  type CachedTextDraft
} from './workspace-file-preview-support'

type Translate = (key: string, values?: Record<string, unknown>) => string
type TabMenu = { target: WorkspaceFileTarget; point: KunContextMenuPoint }

function isAbsolutePath(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(path)
}

/** Absolute and root-relative forms of a preview target's path. */
export function filePreviewTargetPaths(target: WorkspaceFileTarget, workspaceRoot: string): { absolute: string; relative: string } {
  const root = (target.workspaceRoot ?? workspaceRoot).replace(/[\\/]+$/, '')
  const path = target.path
  if (!isAbsolutePath(path)) return { absolute: root ? `${root}/${path}` : path, relative: path }
  const normalized = path.replaceAll('\\', '/')
  const prefix = `${root.replaceAll('\\', '/')}/`
  return { absolute: path, relative: root && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : path }
}

type WorkspaceFilePreviewDialogsProps = {
  t: Translate
  tabMenu: TabMenu | null
  workspaceRoot: string
  requestCloseTarget?: (target: WorkspaceFileTarget) => void
  pinnedTargetKeySet: Set<string>
  onTogglePinnedTarget?: (target: WorkspaceFileTarget) => void
  setTabMenu: Dispatch<SetStateAction<TabMenu | null>>
  tabMenuTriggerRef: MutableRefObject<HTMLElement | null>
  onCloseOtherTargets?: (target: WorkspaceFileTarget, scope?: FilePreviewCloseScope) => void
  visibleTargets: WorkspaceFileTarget[]
  pendingCloseTarget: WorkspaceFileTarget | null
  setPendingCloseTarget: Dispatch<SetStateAction<WorkspaceFileTarget | null>>
  textDraftsRef: MutableRefObject<Map<string, CachedTextDraft>>
  setDirtyTargetKeys: Dispatch<SetStateAction<Set<string>>>
  onCloseTarget?: (target: WorkspaceFileTarget) => void
  savingText: boolean
  savePendingCloseTarget: () => Promise<void>
}

export function WorkspaceFilePreviewDialogs(props: WorkspaceFilePreviewDialogsProps): ReactElement {
  const {
    t,
    tabMenu,
    workspaceRoot,
    requestCloseTarget,
    pinnedTargetKeySet,
    onTogglePinnedTarget,
    setTabMenu,
    tabMenuTriggerRef,
    onCloseOtherTargets,
    visibleTargets,
    pendingCloseTarget,
    setPendingCloseTarget,
    textDraftsRef,
    setDirtyTargetKeys,
    onCloseTarget,
    savingText,
    savePendingCloseTarget
  } = props
  const dismissTabMenu = useCallback(() => {
    setTabMenu(null)
    // Escape or a menu action leaves focus nowhere: hand it back to the tab.
    window.requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) tabMenuTriggerRef.current?.focus()
    })
  }, [setTabMenu, tabMenuTriggerRef])
  const tabMenuEntries = (target: WorkspaceFileTarget): KunContextMenuEntry[] => {
    const key = targetKey(target)
    const index = visibleTargets.findIndex((item) => targetKey(item) === key)
    const unpinned = (items: WorkspaceFileTarget[]): number =>
      items.filter((item) => targetKey(item) !== key && !pinnedTargetKeySet.has(targetKey(item))).length
    const othersCount = unpinned(visibleTargets)
    const rightCount = index < 0 ? 0 : unpinned(visibleTargets.slice(index + 1))
    const allCount = othersCount + (pinnedTargetKeySet.has(key) ? 0 : 1)
    const paths = filePreviewTargetPaths(target, workspaceRoot)
    const copy = (value: string): void => {
      if (value) void navigator.clipboard?.writeText?.(value)?.catch(() => undefined)
    }
    const pinned = pinnedTargetKeySet.has(key)
    return [
      ...(requestCloseTarget ? [{ id: 'close', label: t('workTabMenuClose'), icon: <X aria-hidden />, onSelect: () => requestCloseTarget(target) }] : []),
      ...(onCloseOtherTargets
        ? [
            { id: 'closeOthers', label: t('filePreviewCloseOtherTabs'), count: othersCount, disabled: !othersCount, onSelect: () => onCloseOtherTargets(target, 'others') },
            { id: 'closeRight', label: t('workTabMenuCloseRight'), count: rightCount, disabled: !rightCount, onSelect: () => onCloseOtherTargets(target, 'right') },
            { id: 'closeAll', label: t('workTabMenuCloseAll'), count: allCount, disabled: !allCount, onSelect: () => onCloseOtherTargets(target, 'all') }
          ]
        : []),
      'separator',
      ...(onTogglePinnedTarget
        ? [{
            id: 'pin',
            label: pinned ? t('filePreviewUnpinTab') : t('filePreviewPinTab'),
            icon: pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />,
            onSelect: () => onTogglePinnedTarget(target)
          }]
        : []),
      'separator',
      { id: 'copyPath', label: t('fileTreeCopyAbsolutePath'), icon: <Copy aria-hidden />, onSelect: () => copy(paths.absolute) },
      { id: 'copyRelativePath', label: t('fileTreeCopyRelativePath'), onSelect: () => copy(paths.relative) },
      {
        id: 'reveal',
        label: window.kunGui?.platform === 'darwin' ? t('fileTreeRevealInFinder') : t('fileTreeRevealInFileManager'),
        icon: <FolderSearch aria-hidden />,
        onSelect: () => void window.kunGui?.revealWorkspaceFileInFolder?.({ ...target, workspaceRoot: target.workspaceRoot ?? workspaceRoot })
      }
    ]
  }
  return (
    <>
      {tabMenu ? (
        <KunContextMenu point={tabMenu.point} label={t('filePreviewTabActions')} onDismiss={dismissTabMenu}
          entries={tabMenuEntries(tabMenu.target)} />
      ) : null}
      {pendingCloseTarget && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[1px]">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="workspace-file-dirty-close-title"
            className="w-full max-w-[380px] rounded-xl border border-ds-border bg-ds-card p-4 shadow-2xl"
          >
            <h2 id="workspace-file-dirty-close-title" className="text-[14px] font-semibold text-ds-ink">
              {t('filePreviewCloseDirtyTitle', { defaultValue: 'Save changes before closing?' })}
            </h2>
            <p className="mt-2 text-[12px] leading-5 text-ds-muted">
              {t('filePreviewCloseDirtyBody', {
                defaultValue: '{{file}} has unsaved changes.',
                file: fileNameFromPath(pendingCloseTarget.path)
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                onClick={() => setPendingCloseTarget(null)}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[12px] text-red-700 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                onClick={() => {
                  const item = pendingCloseTarget
                  const key = targetKey(item)
                  textDraftsRef.current.delete(key)
                  setDirtyTargetKeys((current) => {
                    const updated = new Set(current)
                    updated.delete(key)
                    return updated
                  })
                  setPendingCloseTarget(null)
                  onCloseTarget?.(item)
                }}
              >
                {t('filePreviewDiscardChanges', { defaultValue: 'Discard' })}
              </button>
              <button
                type="button"
                disabled={savingText}
                className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
                onClick={() => void savePendingCloseTarget()}
              >
                {savingText ? t('saving', { defaultValue: 'Saving…' }) : t('save', { defaultValue: 'Save' })}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  )
}
