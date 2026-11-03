import { useEffect, type ReactElement } from 'react'
import type { WriteEditorGroupId, WritePaperViewId } from '../../write/write-workspace-store-types'
import { useWorkAssistantSwapped } from '../../write/work-conversation-stage'
import { useWorkViewStore } from '../../write/work-view-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { writePaperViewTabKey } from '../../write/write-editor-layout'
import { useChatStore } from '../../store/chat-store'
import { openPaperSpace } from '../../paper/paper-space'

/** Move a legacy virtual tab to the global library once it is actually visible. */
export function PaperViewSurface({ view, groupId }: { view: WritePaperViewId; groupId: WriteEditorGroupId }): ReactElement | null {
  const swapped = useWorkAssistantSwapped()
  const split = useWorkViewStore((state) => state.split)
  const peek = useWorkViewStore((state) => state.peek)
  const workspaceRoot = useWriteWorkspaceStore((state) => state.workspaceRoot)
  const visible = !swapped || split || peek
  useEffect(() => {
    if (!visible) return
    void openPaperSpace(view).then((opened) => {
      const write = useWriteWorkspaceStore.getState()
      if (opened && useChatStore.getState().route === 'papers' && write.workspaceRoot === workspaceRoot) {
        void write.closeTab(groupId, writePaperViewTabKey(view))
      }
    })
  }, [view, groupId, visible, workspaceRoot])
  return null
}
