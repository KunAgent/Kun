import { useEffect, type ReactElement } from 'react'
import { startActivityFeed, stopActivityFeed } from '../../store/activity-store'
import { MissionControlView } from './MissionControlView'

/**
 * Popout entry: the standalone Mission Control board
 * rendered in the auxiliary window. It owns only the shared activity feed —
 * no chat session state, and OS notifications stay with the main window.
 */
export function MissionControlPopoutView(): ReactElement {
  useEffect(() => {
    startActivityFeed()
    return () => stopActivityFeed()
  }, [])
  return <MissionControlView />
}
