import { useMemo, useState, type ReactElement } from 'react'
import { ChevronRight, FolderInput } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { normalizePath } from '../../../write/write-workspace-store-helpers'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { setImportFolder } from '../../../paper/paper-import-target'
import { usePaperRowMenu } from '../library/use-paper-row-menu'
import { PaperTreeRow } from './PaperTreeRow'
import { PaperNewFolderRow } from './PaperNewFolderRow'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

/**
 * Sidebar paper tree (U3): library entries grouped by `entry.group` into
 * collapsible sections, then paper rows — no raw file tree, so paper.md /
 * figures/ internals stay hidden. Flattened to a plain list when the library
 * has no groups.
 */
export function PaperTree({
  creatingFolder = false,
  onCreatingFolderDone
}: {
  creatingFolder?: boolean
  onCreatingFolderDone?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const entries = usePaperModeStore((s) => s.entries)
  const folders = usePaperModeStore((s) => s.groups)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const { host, openMenu } = usePaperRowMenu()

  const sections = useMemo(() => {
    // Empty folders stay visible so they can be filled by imports.
    const groups = new Map<string, PaperLibraryEntry[]>(folders.map((folder) => [folder, []]))
    const top: PaperLibraryEntry[] = []
    const sorted = [...entries].sort(
      (a, b) => (Date.parse(b.lastOpenedAt ?? '') || 0) - (Date.parse(a.lastOpenedAt ?? '') || 0)
        || a.meta.title.localeCompare(b.meta.title)
    )
    for (const entry of sorted) {
      if (entry.group) {
        const list = groups.get(entry.group)
        if (list) list.push(entry)
        else groups.set(entry.group, [entry])
      } else {
        top.push(entry)
      }
    }
    return { groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)), top }
  }, [entries, folders])

  const toggle = (group: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const importInto = (folder: string): void => {
    setImportFolder(folder)
    usePaperModeStore.getState().setImportDialogOpen(true)
  }

  const newFolderRow = creatingFolder && onCreatingFolderDone
    ? <PaperNewFolderRow onDone={onCreatingFolderDone} />
    : null

  if (!entries.length && !folders.length) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {newFolderRow}
        <p className="px-2 py-6 text-center text-[12px] text-ds-faint">
          {t('writePaperLibraryEmpty')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
      {newFolderRow}
      {sections.groups.map(([group, items]) => {
        const parts = group.split('/')
        const depth = parts.length - 1
        const ancestors = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
        if (ancestors.some((parent) => collapsed.has(parent))) return null
        const isCollapsed = collapsed.has(group)
        const hasChildFolder = sections.groups.some(([other]) => other.startsWith(`${group}/`))
        return (
          <div key={group} className="group/folder relative mt-0.5">
            <button
              type="button"
              onClick={() => toggle(group)}
              title={group}
              style={{ paddingLeft: 6 + depth * 14 }}
              className="flex h-7 w-full items-center gap-1 rounded-md px-1.5 pr-8 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <ChevronRight
                className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                strokeWidth={2}
              />
              <span className="min-w-0 flex-1 truncate">{parts[depth]}</span>
              <span className="shrink-0 text-[10.5px] text-ds-faint group-hover/folder:invisible">{items.length}</span>
            </button>
            <button
              type="button"
              onClick={() => importInto(group)}
              title={t('paperImportIntoFolder')}
              aria-label={t('paperImportIntoFolder')}
              className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded text-ds-faint transition hover:bg-ds-main hover:text-ds-ink group-hover/folder:flex"
            >
              <FolderInput className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            {!isCollapsed && !items.length && !hasChildFolder ? (
              <p style={{ paddingLeft: 24 + depth * 14 }} className="py-1 text-[11px] text-ds-faint">{t('paperFolderEmpty')}</p>
            ) : null}
            {!isCollapsed && items.length ? (
              <div style={{ paddingLeft: depth * 14 }}>
                {items.map((entry) => (
                  <PaperTreeRow
                    key={entry.unitDir}
                    entry={entry}
                    workspaceRoot={workspaceRoot}
                    onMenu={openMenu}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      {sections.top.map((entry) => (
        <PaperTreeRow
          key={entry.unitDir}
          entry={entry}
          workspaceRoot={workspaceRoot}
          onMenu={openMenu}
        />
      ))}
      {host}
    </div>
  )
}

/** Absolute-path check: is `path` inside `<root>/<unitDir>/`? */
export function pathInsidePaperUnit(
  path: string | null,
  workspaceRoot: string,
  unitDir: string
): boolean {
  if (!path || !workspaceRoot) return false
  const root = normalizePath(workspaceRoot)
  const normalized = normalizePath(path)
  return normalized.startsWith(`${root}/${unitDir}/`)
}
