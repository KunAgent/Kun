import type { ReactElement } from 'react'
import type { WritePaperViewId } from '../../write/write-workspace-store-types'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { PaperDiscoverView, type PaperDiscoverSource } from './PaperDiscoverView'
import { PaperLibraryView } from './PaperLibraryView'
import { PaperSearchView } from './discover/PaperSearchView'

const DISCOVER_SOURCES: Record<string, PaperDiscoverSource> = {
  'discover:arxiv': 'arxiv',
  'discover:feeds': 'feeds',
  'discover:venue': 'venue'
}

/**
 * Content host for `kind: 'paper-view'` editor tabs (U4): renders the paper
 * library or one discover source inside the editor group. `library` is the
 * pinned first tab; each discover source is its own closable tab.
 */
export function PaperViewSurface({ view }: { view: WritePaperViewId }): ReactElement {
  const submit = usePaperModeStore((s) => s.composerBridge?.submit)
  if (view === 'discover:search') return <PaperSearchView />
  const source = DISCOVER_SOURCES[view]
  if (source) return <PaperDiscoverView source={source} />
  return <PaperLibraryView onSubmitPrompt={submit ?? undefined} />
}
