import { useEffect, type ReactElement } from 'react'
import type { WritePaperViewId } from '../../write/write-workspace-store-types'
import { openPaperSpace } from '../../paper/paper-space'

/** Persisted Work tabs reopen the global destination, never the removed folder library. */
export function PaperViewSurface({ view }: { view: WritePaperViewId }): ReactElement | null {
  useEffect(() => { void openPaperSpace(view) }, [view])
  return null
}
