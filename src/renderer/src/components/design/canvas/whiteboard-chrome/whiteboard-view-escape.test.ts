import { describe, expect, it } from 'vitest'
import {
  excalidrawConsumesEscape,
  whiteboardEscapeAction,
  type ExcalidrawEscapeState
} from './whiteboard-view-escape'

const idle: ExcalidrawEscapeState = {
  activeTool: { type: 'selection' },
  selectedElementIds: {}
}

describe('whiteboard view escape', () => {
  it('lets Excalidraw keep Escape while it has something to cancel', () => {
    expect(excalidrawConsumesEscape(idle)).toBe(false)
    expect(excalidrawConsumesEscape({ ...idle, activeTool: { type: 'rectangle' } })).toBe(true)
    expect(excalidrawConsumesEscape({ ...idle, selectedElementIds: { a: true } })).toBe(true)
    expect(excalidrawConsumesEscape({ ...idle, selectedElementIds: { a: false } })).toBe(false)
    expect(excalidrawConsumesEscape({ ...idle, editingTextElement: {} })).toBe(true)
    expect(excalidrawConsumesEscape({ ...idle, openSidebar: { name: 'default' } })).toBe(true)
  })

  it('steps back one view only from an idle board', () => {
    const base = { editorBusy: false, targetEditable: false, menuOpen: false }
    expect(whiteboardEscapeAction({ ...base, view: 'docked' })).toBe('ignore')
    expect(whiteboardEscapeAction({ ...base, view: 'fullscreen' })).toBe('exit-fullscreen')
    expect(whiteboardEscapeAction({ ...base, view: 'focused' })).toBe('exit-focus')
    expect(whiteboardEscapeAction({ ...base, view: 'fullscreen', editorBusy: true })).toBe('swallow')
    expect(whiteboardEscapeAction({ ...base, view: 'focused', menuOpen: true })).toBe('swallow')
    expect(whiteboardEscapeAction({ ...base, view: 'focused', targetEditable: true })).toBe('swallow')
    expect(whiteboardEscapeAction({ ...base, view: 'docked', editorBusy: true })).toBe('ignore')
  })
})
