import type {
  WriteWorkspaceGet,
  WriteWorkspaceSet,
  WriteWorkspaceState
} from './write-workspace-store-types'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import {
  WRITE_RIGHT_PANEL_KEY,
  collapseWriteRightPanelState,
  openWriteRightPanelState,
  parseStoredWriteRightPanelState,
  serializeWriteRightPanelState,
  toggleWriteRightPanelState,
  writeAssistantOpenFor,
  type WriteRightPanelState
} from './write-right-panel-state'
import { WRITE_ASSISTANT_OPEN_KEY } from './write-workspace-store-helpers'

type WriteRightPanelActions = Pick<
  WriteWorkspaceState,
  | 'setAssistantOpen'
  | 'openWriteRightPanel'
  | 'toggleWriteRightPanel'
  | 'setWriteRightPanelState'
>

export function readStoredWriteRightPanel(): WriteRightPanelState {
  return parseStoredWriteRightPanelState(
    readBrowserStorageItem(WRITE_RIGHT_PANEL_KEY),
    readBrowserStorageItem(WRITE_ASSISTANT_OPEN_KEY)
  )
}

/** State patch keeping the legacy `assistantOpen` projection in sync. */
export function writeRightPanelPatch(
  next: WriteRightPanelState
): Pick<WriteWorkspaceState, 'writeRightPanel' | 'assistantOpen'> {
  return { writeRightPanel: next, assistantOpen: writeAssistantOpenFor(next) }
}

export function persistWriteRightPanel(state: WriteRightPanelState): void {
  writeBrowserStorageItem(WRITE_RIGHT_PANEL_KEY, serializeWriteRightPanelState(state))
}

export function createWriteRightPanelActions({ set, get }: {
  set: WriteWorkspaceSet
  get: WriteWorkspaceGet
}): WriteRightPanelActions {
  const apply = (next: WriteRightPanelState): void => {
    persistWriteRightPanel(next)
    set(writeRightPanelPatch(next))
  }
  return {
    // `true` focuses the assistant tool; `false` collapses whichever tool is
    // visible, which is what every existing "close the panel" caller means.
    setAssistantOpen: (open) => {
      const current = get().writeRightPanel
      apply(open
        ? openWriteRightPanelState(current, 'assistant')
        : collapseWriteRightPanelState(current))
    },
    openWriteRightPanel: (id) => apply(openWriteRightPanelState(get().writeRightPanel, id)),
    toggleWriteRightPanel: (id) => apply(toggleWriteRightPanelState(get().writeRightPanel, id)),
    setWriteRightPanelState: (state) => apply(state)
  }
}
