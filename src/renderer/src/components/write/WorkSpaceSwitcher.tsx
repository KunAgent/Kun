import type { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown, FolderOpen, FolderPlus, FolderSearch, GraduationCap, Trash2 } from 'lucide-react'
import { confirmDialog } from '../../lib/confirm-dialog'
import { revealWorkspacePathInFileManager } from '../../lib/open-workspace-path'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../write/write-workspace-store'
import { normalizePath } from '../../write/write-workspace-store-helpers'
import { mountWorkSpace } from '../../write/work-session-actions'
import { RoomPopover } from '../rooms/RoomPopover'

/** Former paper libraries kept the app-owned default folder. */
const DEFAULT_PAPER_SPACE_SUFFIX = '/paper-workspaces/default'

export function useWorkSpaceLabel(): (root: string) => string {
  const { t } = useTranslation('common')
  const defaultWorkspaceRoot = useWriteWorkspaceStore((s) => s.defaultWorkspaceRoot)
  return (root: string): string => {
    const normalized = normalizePath(root)
    if (normalized === normalizePath(defaultWorkspaceRoot)) return t('writeDefaultSpace')
    if (normalized.endsWith(DEFAULT_PAPER_SPACE_SUFFIX)) return t('paperWorkspaceDefaultName')
    return writeBasenameFromPath(normalized) || normalized
  }
}

/** Parent folder shown under a space name, with the home folder shortened. */
function parentLabel(root: string): string {
  const normalized = normalizePath(root)
  const parent = normalized.slice(0, Math.max(0, normalized.lastIndexOf('/')))
  return parent.replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Za-z]:\/Users\/[^/]+/, '~')
}

/**
 * The space you are in. One space at a time: the sidebar below is its map.
 * Every registered folder is listed here (former paper libraries included);
 * adding, revealing and removing a space live in the same menu.
 */
export function WorkSpaceSwitcher({ onAddSpace }: { onAddSpace: () => void }): ReactElement | null {
  const { t } = useTranslation('common')
  const label = useWorkSpaceLabel()
  const { workspaceRoot, workspaceRoots, defaultWorkspaceRoot, libraries, removeWriteWorkspace } = useWriteWorkspaceStore(useShallow((s) => ({
    workspaceRoot: s.workspaceRoot,
    workspaceRoots: s.workspaceRoots,
    defaultWorkspaceRoot: s.defaultWorkspaceRoot,
    libraries: s.paperMode.libraries,
    removeWriteWorkspace: s.removeWriteWorkspace
  })))
  if (!workspaceRoot) return null
  const current = normalizePath(workspaceRoot)
  const paperSpaces = new Set(libraries.map(normalizePath))
  const removable = workspaceRoots.length > 1 && current !== normalizePath(defaultWorkspaceRoot)
  const revealLabel = window.kunGui?.platform === 'darwin' ? t('fileTreeRevealInFinder') : t('fileTreeRevealInFileManager')

  const remove = async (): Promise<void> => {
    if (!(await confirmDialog(t('workSpaceRemoveConfirm', { name: label(current) })))) return
    await removeWriteWorkspace(current)
  }

  return (
    <RoomPopover
      label={t('workSpaceSwitch')}
      width={272}
      className="work-space-switcher"
      trigger={(
        <>
          <FolderOpen className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} aria-hidden />
          <span className="work-space-switcher-name" data-work-space-name title={current}>{label(current)}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} aria-hidden />
        </>
      )}
    >
      {(close) => (
        <div className="rooms-menu-list work-space-menu">
          <div className="work-space-menu-label">{t('workSpaces')}</div>
          {workspaceRoots.map((root) => {
            const active = normalizePath(root) === current
            return (
              <button key={root} type="button" aria-pressed={active} title={root} data-work-space={root}
                onClick={() => { close(); if (!active) void mountWorkSpace(root) }}>
                {active ? <Check size={15} aria-hidden="true" /> : <span className="work-space-menu-gap" />}
                <span className="work-space-menu-text">
                  <span className="work-space-menu-name">{label(root)}</span>
                  <span className="work-space-menu-path">{parentLabel(root)}</span>
                </span>
                {paperSpaces.has(normalizePath(root)) ? (
                  <GraduationCap size={14} className="work-space-menu-mark" aria-label={t('workSpaceHasPapers')} />
                ) : null}
              </button>
            )
          })}
          <hr />
          <button type="button" data-work-space-action="add" onClick={() => { close(); onAddSpace() }}>
            <FolderPlus size={15} aria-hidden="true" /><span>{t('workSpaceAdd')}</span>
          </button>
          <button type="button" data-work-space-action="reveal"
            onClick={() => { close(); void revealWorkspacePathInFileManager(current, current) }}>
            <FolderSearch size={15} aria-hidden="true" /><span>{revealLabel}</span>
          </button>
          {removable ? (
            <button type="button" className="is-danger" data-work-space-action="remove" onClick={() => { close(); void remove() }}>
              <Trash2 size={15} aria-hidden="true" /><span>{t('workSpaceRemove')}</span>
            </button>
          ) : null}
        </div>
      )}
    </RoomPopover>
  )
}
