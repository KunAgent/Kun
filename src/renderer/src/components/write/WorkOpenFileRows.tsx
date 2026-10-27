import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWorkSlotsStore } from '../../write/work-slots-store'
import { useWorkViewStore } from '../../write/work-view-store'
import { isWriteFileTab, writeEditorItemKey } from '../../write/write-editor-layout'
import { WorkFileTypeIcon } from './WorkFileTypeIcon'

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** Open files lead the Recent list, in the same row shape as sessions. */
export function WorkOpenFileRows(): ReactElement | null {
  const { t } = useTranslation('common')
  const { layout, activateTab } = useWriteWorkspaceStore(useShallow((state) => ({
    layout: state.editorLayout,
    activateTab: state.activateTab
  })))
  const sessionMain = useWorkSlotsStore((state) => state.assistantMain)
  const showDocument = useWorkViewStore((state) => state.showDocument)
  const focused = layout.groups.find((group) => group.id === layout.focusedGroupId) ?? layout.groups[0]
  const rows: Array<{ key: string; path: string; groupId: typeof layout.focusedGroupId }> = []
  for (const group of layout.groups) {
    for (const item of group.tabs) {
      if (!isWriteFileTab(item)) continue
      const key = writeEditorItemKey(item)
      if (!rows.some((row) => row.key === key)) rows.push({ key, path: item.path, groupId: group.id })
    }
  }
  if (rows.length === 0) return null
  return (
    <>
      {rows.map((row) => {
        const current = !sessionMain && focused?.activePath === row.key
        return (
          <div key={row.key} className="work-session-item" data-work-open-file={row.path}>
            <button type="button" className="work-session-row" aria-current={current ? 'true' : undefined} title={row.path}
              onClick={() => {
                activateTab(row.groupId, row.key)
                showDocument()
              }}>
              <WorkFileTypeIcon name={row.path} size={16} className="work-open-file-icon" />
              <span className="work-session-title">{basename(row.path)}</span>
              <span className="work-session-time">{t('workSidebarOpenNow')}</span>
            </button>
          </div>
        )
      })}
    </>
  )
}
