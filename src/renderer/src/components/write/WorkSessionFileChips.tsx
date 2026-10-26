import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWorkViewStore } from '../../write/work-view-store'
import { isWriteFileTab, writeEditorItemKey } from '../../write/write-editor-layout'
import { WorkFileTypeIcon } from './WorkFileTypeIcon'

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * The files this session works with, above the composer. A click peeks at the
 * file in a sheet inside the session; the lit chip closes it again.
 */
export function WorkSessionFileChips(): ReactElement | null {
  const { t } = useTranslation('common')
  const { layout, activateTab } = useWriteWorkspaceStore(useShallow((state) => ({
    layout: state.editorLayout,
    activateTab: state.activateTab
  })))
  const { peek, setPeek, showSession } = useWorkViewStore(useShallow((state) => ({
    peek: state.peek,
    setPeek: state.setPeek,
    showSession: state.showSession
  })))
  const focused = layout.groups.find((group) => group.id === layout.focusedGroupId) ?? layout.groups[0]
  const files: Array<{ key: string; path: string; groupId: typeof layout.focusedGroupId }> = []
  for (const group of layout.groups) {
    for (const item of group.tabs) {
      if (!isWriteFileTab(item)) continue
      const key = writeEditorItemKey(item)
      if (!files.some((file) => file.key === key)) files.push({ key, path: item.path, groupId: group.id })
    }
  }
  if (files.length === 0) return null
  return (
    <div className="work-session-files" data-work-session-files>
      <span className="work-session-files-label">{t('workSessionFiles')}</span>
      {files.map((file) => {
        const lit = peek && focused?.activePath === file.key
        return (
          <button key={file.key} type="button" className="work-session-file" aria-pressed={lit} title={file.path}
            onClick={() => {
              if (lit) {
                setPeek(false)
                return
              }
              activateTab(file.groupId, file.key)
              showSession()
              setPeek(true)
            }}>
            <WorkFileTypeIcon name={file.path} size={14} />
            <span>{basename(file.path)}</span>
          </button>
        )
      })}
    </div>
  )
}
