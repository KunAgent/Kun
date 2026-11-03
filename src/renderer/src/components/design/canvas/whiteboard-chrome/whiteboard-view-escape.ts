import type { WhiteboardViewMode } from './WhiteboardBoardHeader'

/** The subset of Excalidraw app state that decides whether Escape belongs to the editor. */
export type ExcalidrawEscapeState = {
  activeTool: { type: string }
  selectedElementIds: Readonly<Record<string, boolean>>
  editingTextElement?: unknown
  newElement?: unknown
  multiElement?: unknown
  openMenu?: unknown
  openPopup?: unknown
  openDialog?: unknown
  openSidebar?: unknown
}

/** True while Excalidraw itself will use Escape (deselect, cancel a tool, close its UI). */
export function excalidrawConsumesEscape(state: ExcalidrawEscapeState): boolean {
  return state.activeTool.type !== 'selection' ||
    Object.values(state.selectedElementIds).some(Boolean) ||
    Boolean(state.editingTextElement || state.newElement || state.multiElement) ||
    Boolean(state.openMenu || state.openPopup || state.openDialog || state.openSidebar)
}

export type WhiteboardEscapeAction = 'ignore' | 'swallow' | 'exit-fullscreen' | 'exit-focus'

/**
 * Escape leaves an enlarged whiteboard only when nothing on the board wants
 * the key. `swallow` keeps the stage-level focus handler from also exiting.
 * The board steps back itself because an editor may stop the key's
 * propagation before the stage listener sees it.
 */
export function whiteboardEscapeAction(options: {
  view: WhiteboardViewMode
  editorBusy: boolean
  targetEditable: boolean
  menuOpen: boolean
}): WhiteboardEscapeAction {
  if (options.view === 'docked') return 'ignore'
  if (options.editorBusy || options.targetEditable || options.menuOpen) return 'swallow'
  return options.view === 'fullscreen' ? 'exit-fullscreen' : 'exit-focus'
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
