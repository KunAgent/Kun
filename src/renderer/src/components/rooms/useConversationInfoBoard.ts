import { useCallback, useEffect, useRef } from 'react'
import { useRoomPresentationPreferences } from './room-presentation-preferences'
import { CONVERSATION_INFO_TAB, type RoomWorkbenchPanel } from './useRoomWorkbenchPanel'

/**
 * Keeps the info board open while the user moves between conversations.
 * Opening the board turns the preference on; closing its tab or collapsing
 * the panel while it is showing turns it off. A new panel scope starts empty,
 * so the board is reopened there only when the preference is on.
 */
export function useConversationInfoBoard(panel: RoomWorkbenchPanel, scope: string | null, ready: boolean) {
  const remembered = useRoomPresentationPreferences((state) => state.infoBoard)
  const setPreference = useRoomPresentationPreferences((state) => state.setPreference)
  const { expanded, activeId, tabs } = panel.state
  const active = expanded && activeId === CONVERSATION_INFO_TAB
  const listed = tabs.includes(CONVERSATION_INFO_TAB)
  const openTab = panel.openTab
  const previous = useRef<{ scope: string | null; active: boolean; listed: boolean } | null>(null)
  useEffect(() => {
    if (ready && remembered && !tabs.length) openTab(CONVERSATION_INFO_TAB)
    // Only a new scope (or the room becoming ready) reopens the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, ready])
  useEffect(() => {
    const before = previous.current
    previous.current = { scope, active, listed }
    if (!before || before.scope !== scope) return
    if (!before.active && active) setPreference({ infoBoard: true })
    else if ((before.listed && !listed) || (before.active && !expanded)) setPreference({ infoBoard: false })
  }, [scope, active, listed, expanded, setPreference])
  const open = useCallback(() => openTab(CONVERSATION_INFO_TAB), [openTab])
  const toggle = useCallback(() => {
    if (active) panel.collapse()
    else openTab(CONVERSATION_INFO_TAB)
  }, [active, openTab, panel])
  return { open, toggle, active }
}
