import { useMemo, useState, type ReactElement } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { normalizePath } from '../../../write/write-workspace-store-helpers'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperRowMenu } from '../library/use-paper-row-menu'
import { PaperTreeRow } from './PaperTreeRow'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

/**
 * Sidebar paper tree (U3): library entries grouped by `entry.group` into
 * collapsible sections, then paper rows — no raw file tree, so paper.md /
 * figures/ internals stay hidden. Flattened to a plain list when the library
 * has no groups.
 */
export function PaperTree(): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const entries = usePaperModeStore((s) => s.entries)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const { host, openMenu } = usePaperRowMenu()

  const sections = useMemo(() => {
    const groups = new Map<string, PaperLibraryEntry[]>()
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
  }, [entries])

  const toggle = (group: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  if (!entries.length) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        <p className="px-2 py-6 text-center text-[12px] text-ds-faint">
          {t('writePaperLibraryEmpty')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
      {sections.groups.map(([group, items]) => {
        const isCollapsed = collapsed.has(group)
        return (
          <div key={group} className="mt-0.5">
            <button
              type="button"
              onClick={() => toggle(group)}
              className="flex h-7 w-full items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <ChevronRight
                className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                strokeWidth={2}
              />
              <span className="min-w-0 flex-1 truncate">{group}</span>
              <span className="shrink-0 text-[10.5px] text-ds-faint">{items.length}</span>
            </button>
            {!isCollapsed
              ? items.map((entry) => (
                  <PaperTreeRow
                    key={entry.unitDir}
                    entry={entry}
                    workspaceRoot={workspaceRoot}
                    onMenu={openMenu}
                  />
                ))
              : null}
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
