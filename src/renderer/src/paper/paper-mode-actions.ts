import { PAPER_MODE_MAX_LIBRARIES } from '@shared/app-settings-paper-mode'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperStore } from '../write/paper/paper-store'
import { paperConversationResourcePath } from './paper-conversation-scope'
import { paperModeView } from './paper-view'

/**
 * Keyboard/command-palette entry: papers are a global space, so shortcuts
 * navigate directly to the independent paper route without opening Work or
 * selecting a workspace first.
 */
export async function runPaperModeShortcut(command: 'library' | 'import'): Promise<void> {
  const { openPaperSpace } = await import('./paper-space')
  await openPaperSpace('library', command === 'import')
}

/**
 * The resource a Work send anchors a new session to: a paper unit for files
 * inside one (PDF and NOTES belong together), the research session's virtual
 * path on the Agent research page, '' for the library and discover pages, and
 * the file itself otherwise.
 */
export function writeConversationResourcePath(
  workspaceRoot: string | undefined,
  activeFilePath: string | null
): string {
  const state = useWriteWorkspaceStore.getState()
  return paperConversationResourcePath({
    workspaceRoot: workspaceRoot ?? state.workspaceRoot,
    activeFilePath,
    unitDirs: Object.keys(usePaperStore.getState().unitsByDir),
    entriesByDir: state.entriesByDir,
    view: paperModeView(state),
    researchSessionId: state.paperResearch.sessionId
  }) ?? ''
}

/**
 * The phone's paper home lists `write.paperMode.libraries`. A space that has
 * just received papers joins that list (best effort) so its papers are
 * readable there too; the desktop never reads the list for navigation.
 */
export async function rememberPaperSpace(spaceRoot: string): Promise<void> {
  const root = normalizePath(spaceRoot)
  const paperMode = useWriteWorkspaceStore.getState().paperMode
  if (!root || paperMode.libraries.some((item) => normalizePath(item) === root)) return
  if (paperMode.libraries.length >= PAPER_MODE_MAX_LIBRARIES) return
  try {
    await rendererRuntimeClient.setSettings({
      write: { paperMode: { libraries: [...paperMode.libraries, root] } }
    })
    useWriteWorkspaceStore.setState((state) => ({
      paperMode: { ...state.paperMode, libraries: [...state.paperMode.libraries, root] }
    }))
  } catch {
    // Only the phone's library list misses this space; the desktop is unaffected.
  }
}
