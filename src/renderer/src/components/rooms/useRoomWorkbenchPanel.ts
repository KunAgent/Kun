import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoomContentReference } from '@shared/rooms-api'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  type RightPanelContributionId
} from '../../extensions/contribution-ids'
import { workspaceFileTargetKey } from '../../lib/workspace-file-target-key'
import { WORKSPACE_FILE_PREVIEW_EVENT, type WorkspaceFilePreviewDetail } from '../../lib/workspace-file-preview'
import {
  closeCodeRightTab,
  collapseCodeRightTabs,
  emptyCodeRightTabsState,
  openCodeRightTab,
  type CodeRightTabsState
} from '../workbench/code-right-tabs-state'

export const ROOM_COLLABORATION_TAB = BUILTIN_RIGHT_PANEL_IDS.subagents
/** The conversation info board: the Agent profile in a private chat, members in a group. */
export const CONVERSATION_INFO_TAB = BUILTIN_RIGHT_PANEL_IDS.conversationInfo

type RoomPanelState = {
  roomId: string | null
  tabs: CodeRightTabsState
  contentTarget: { reference: RoomContentReference; messageId?: string; key: number } | null
  fileTarget: WorkspaceFileTarget | null
  fileTargets: WorkspaceFileTarget[]
}

const empty = (roomId: string | null): RoomPanelState => ({
  roomId, tabs: emptyCodeRightTabsState(), contentTarget: null, fileTarget: null, fileTargets: []
})

/** Presentation state belongs to the selected room, never the last Code task. */
export function useRoomWorkbenchPanel(roomId: string | null) {
  const [stored, setStored] = useState(() => empty(roomId))
  const contentSerial = useRef(0)
  const currentRoom = useRef(roomId)
  currentRoom.current = roomId
  const owned = stored.roomId === roomId ? stored : empty(roomId)
  useEffect(() => {
    setStored((value) => value.roomId === roomId ? value : empty(roomId))
  }, [roomId])
  const update = useCallback((change: (value: RoomPanelState) => RoomPanelState) => {
    if (currentRoom.current !== roomId) return
    setStored((value) => change(value.roomId === roomId ? value : empty(roomId)))
  }, [roomId])
  const openTab = useCallback((id: RightPanelContributionId) => {
    update((value) => ({ ...value, tabs: openCodeRightTab(value.tabs, id) }))
  }, [update])
  const openCollaboration = useCallback(() => openTab(ROOM_COLLABORATION_TAB), [openTab])
  const previewContent = useCallback((reference: RoomContentReference, messageId?: string) => {
    const key = ++contentSerial.current
    update((value) => ({ ...value, contentTarget: { reference, messageId, key }, fileTarget: null,
      tabs: openCodeRightTab(value.tabs, BUILTIN_RIGHT_PANEL_IDS.file) }))
  }, [update])
  const previewFile = useCallback((target: WorkspaceFileTarget) => {
    if (!target.path) return
    update((value) => {
      const key = workspaceFileTargetKey(target)
      return { ...value, contentTarget: null, fileTarget: target,
        fileTargets: [...value.fileTargets.filter((item) => workspaceFileTargetKey(item) !== key), target],
        tabs: openCodeRightTab(value.tabs, BUILTIN_RIGHT_PANEL_IDS.file) }
    })
  }, [update])
  const closeFile = useCallback((target: WorkspaceFileTarget) => {
    update((value) => {
      const key = workspaceFileTargetKey(target)
      const fileTargets = value.fileTargets.filter((item) => workspaceFileTargetKey(item) !== key)
      const fileTarget = workspaceFileTargetKey(value.fileTarget) === key
        ? fileTargets.at(-1) ?? null : value.fileTarget
      return { ...value, fileTarget, fileTargets,
        tabs: fileTargets.length || value.contentTarget ? value.tabs : closeCodeRightTab(value.tabs, BUILTIN_RIGHT_PANEL_IDS.file) }
    })
  }, [update])
  const closeTab = useCallback((id: RightPanelContributionId) => {
    update((value) => ({ ...value, tabs: closeCodeRightTab(value.tabs, id),
      ...(id === BUILTIN_RIGHT_PANEL_IDS.file ? { contentTarget: null, fileTarget: null, fileTargets: [] } : {}) }))
  }, [update])
  const collapse = useCallback(() => update((value) => ({
    ...value, tabs: collapseCodeRightTabs(value.tabs)
  })), [update])
  useEffect(() => {
    if (!roomId) return
    const onPreview = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceFilePreviewDetail>).detail
      if (detail?.path) previewFile(detail)
    }
    window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
    return () => window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
  }, [roomId, previewFile])
  return { state: owned.tabs, contentTarget: owned.contentTarget, fileTarget: owned.fileTarget, fileTargets: owned.fileTargets,
    openTab, openCollaboration, previewContent, previewFile, closeFile, closeTab, collapse }
}

export type RoomWorkbenchPanel = ReturnType<typeof useRoomWorkbenchPanel>
