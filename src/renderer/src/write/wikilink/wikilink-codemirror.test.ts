// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  acceptWikilinkMenu,
  buildWikilinkMenuExtension,
  closeWikilinkMenu,
  moveWikilinkSelection,
  setWikilinkTargets,
  wikilinkMenuRows,
  wikilinkMenuSelectedIndex,
  wikilinkMenuVisible
} from './wikilink-codemirror'
import type { WikilinkTarget } from './wikilink-targets'

const VAULT = '/vault'
const OTHER = '/wp'

function target(relativePath: string, root = VAULT, name = 'vault'): WikilinkTarget {
  return {
    workspaceRoot: root,
    workspaceName: name,
    relativePath,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1)
  }
}

const TARGETS = [
  target('index.md'),
  target('notes/alpha.md'),
  target('notes/beta.md'),
  target('docs/spec.md', OTHER, 'wp')
]

let views: EditorView[] = []

/**
 * Mounts a real editor with the extension. jsdom has no layout, so
 * `coordsAtPos` returns null and the menu never paints; the exported row and
 * selection helpers are what make the behaviour observable.
 */
function mount(options: {
  doc?: string
  activePath?: string
  targets?: readonly WikilinkTarget[]
  onRequestTargets?: () => void
  emptyStateText?: (hasTargets: boolean) => string | null
} = {}): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc ?? '',
      extensions: [
        buildWikilinkMenuExtension({
          workspaceRoot: () => VAULT,
          activePath: () => options.activePath ?? 'notes/alpha.md',
          ...(options.onRequestTargets ? { onRequestTargets: options.onRequestTargets } : {}),
          ...(options.emptyStateText ? { emptyStateText: options.emptyStateText } : {})
        })
      ]
    })
  })
  views.push(view)
  view.dispatch({ effects: setWikilinkTargets.of(options.targets ?? TARGETS) })
  return view
}

/** Types text at the end of the document, the way a caret actually moves. */
function type(view: EditorView, text: string): void {
  const at = view.state.doc.length
  view.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length }
  })
}

afterEach(() => {
  for (const view of views) view.destroy()
  views = []
  document.body.replaceChildren()
})

/** Sends a real keydown through the editor so the keymap is exercised. */
function press(view: EditorView, key: string, code = key): boolean {
  return view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
  )
}

describe('wikilink menu extension', () => {
  it('stays closed until the brackets are typed', () => {
    const view = mount()
    type(view, 'see ')
    expect(wikilinkMenuRows(view)).toEqual([])
  })

  it('opens on `[[` and offers every other file', () => {
    const view = mount()
    type(view, '[[')
    const rows = wikilinkMenuRows(view)
    expect(rows.map((row) => row.relativePath))
      .toEqual(['index.md', 'notes/beta.md', 'docs/spec.md'])
  })

  it('narrows as the query is typed', () => {
    const view = mount()
    type(view, '[[bet')
    expect(wikilinkMenuRows(view).map((row) => row.relativePath)).toEqual(['notes/beta.md'])
  })

  it('offers files from other workspaces, flagged as external', () => {
    const view = mount()
    type(view, '[[spec')
    const rows = wikilinkMenuRows(view)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.external).toBe(true)
    expect(rows[0]!.workspaceName).toBe('wp')
  })

  it('offers no rows when the query matches nothing', () => {
    const view = mount()
    type(view, '[[zzzz')
    expect(wikilinkMenuRows(view)).toEqual([])
  })

  it('is positioned as soon as it opens', () => {
    // Regression: the position was only applied in the measure pass, so a menu
    // whose caret could not be measured rendered at its static position —
    // after the scroller, clipped away by `.cm-editor`, and invisible.
    const view = mount()
    type(view, '[[')
    const host = view.dom.querySelector<HTMLElement>('.write-wikilink-menu')
    expect(host?.style.display).toBe('block')
    expect(host?.style.left).not.toBe('')
    expect(host?.style.top).not.toBe('')
    expect(host?.childElementCount).toBeGreaterThan(0)
  })

  it('renders one row element per match', () => {
    const view = mount()
    type(view, '[[')
    const rows = view.dom.querySelectorAll('.write-wikilink-row')
    expect(rows).toHaveLength(wikilinkMenuRows(view).length)
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('hides the host again once closed', () => {
    const view = mount()
    type(view, '[[')
    closeWikilinkMenu(view)
    const host = view.dom.querySelector<HTMLElement>('.write-wikilink-menu')
    expect(host?.style.display).toBe('none')
    expect(host?.childElementCount).toBe(0)
  })

  it('stays visible with an explanation when nothing matches', () => {
    // A menu that simply vanishes is indistinguishable from a broken feature.
    const view = mount({ emptyStateText: () => 'No markdown file matches' })
    type(view, '[[zzzz')
    expect(wikilinkMenuVisible(view)).toBe(true)
    expect(view.dom.querySelector('.write-wikilink-empty')?.textContent)
      .toBe('No markdown file matches')
  })

  it('distinguishes an unscanned list from a genuine no-match', () => {
    const seen: boolean[] = []
    const view = mount({
      targets: [],
      emptyStateText: (hasTargets) => {
        seen.push(hasTargets)
        return hasTargets ? 'no match' : 'scanning'
      }
    })
    type(view, '[[a')
    expect(seen.at(-1)).toBe(false)
    view.dispatch({ effects: setWikilinkTargets.of(TARGETS) })
    type(view, 'zzz')
    expect(seen.at(-1)).toBe(true)
  })

  it('leaves Enter alone when there is nothing to accept', () => {
    // Otherwise the menu would eat newlines while showing an empty state.
    const view = mount({ emptyStateText: () => 'nothing' })
    type(view, '[[zzzz')
    expect(acceptWikilinkMenu(view)).toBe(false)
    expect(moveWikilinkSelection(1)(view)).toBe(false)
  })

  it('opens without any focus bookkeeping', () => {
    // Regression: gating on `view.hasFocus` made the menu silently never open.
    const view = mount()
    expect(view.hasFocus).toBe(false)
    type(view, '[[')
    expect(wikilinkMenuRows(view).length).toBeGreaterThan(0)
  })

  it('closes when the editor loses focus', () => {
    const view = mount()
    type(view, '[[')
    expect(closeWikilinkMenu(view)).toBe(true)
  })

  it('requests a scan the first time it opens with no targets', () => {
    const onRequestTargets = vi.fn()
    const view = mount({ targets: [], onRequestTargets })
    type(view, '[[')
    expect(onRequestTargets).toHaveBeenCalled()
  })

  it('inserts a relative link and closes the brackets', () => {
    const view = mount()
    type(view, 'see [[bet')
    expect(acceptWikilinkMenu(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('see [[beta]]')
    // The caret lands after `]]` so typing continues outside the reference.
    expect(view.state.selection.main.head).toBe('see [[beta]]'.length)
    expect(wikilinkMenuRows(view)).toEqual([])
  })

  it('walks up out of a subdirectory', () => {
    const view = mount({ activePath: 'notes/alpha.md' })
    type(view, '[[ind')
    acceptWikilinkMenu(view)
    expect(view.state.doc.toString()).toBe('[[../index]]')
  })

  it('reaches across workspaces', () => {
    const view = mount({ activePath: 'index.md' })
    type(view, '[[spec')
    acceptWikilinkMenu(view)
    expect(view.state.doc.toString()).toBe('[[../wp/docs/spec]]')
  })

  it('does not double the closing brackets when they already exist', () => {
    const view = mount()
    view.dispatch({
      changes: { from: 0, insert: '[[bet]]' },
      selection: { anchor: 5 }
    })
    expect(acceptWikilinkMenu(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('[[beta]]')
  })

  it('moves the selection and wraps at both ends', () => {
    const view = mount()
    type(view, '[[')
    expect(wikilinkMenuSelectedIndex(view)).toBe(0)
    moveWikilinkSelection(1)(view)
    expect(wikilinkMenuSelectedIndex(view)).toBe(1)
    moveWikilinkSelection(-1)(view)
    moveWikilinkSelection(-1)(view)
    expect(wikilinkMenuSelectedIndex(view)).toBe(2)
    moveWikilinkSelection(1)(view)
    expect(wikilinkMenuSelectedIndex(view)).toBe(0)
  })

  it('accepts whichever row is selected', () => {
    const view = mount()
    type(view, '[[')
    moveWikilinkSelection(1)(view)
    acceptWikilinkMenu(view)
    expect(view.state.doc.toString()).toBe('[[beta]]')
  })

  it('resets the selection when the query changes', () => {
    const view = mount()
    type(view, '[[')
    moveWikilinkSelection(1)(view)
    expect(wikilinkMenuSelectedIndex(view)).toBe(1)
    type(view, 'n')
    expect(wikilinkMenuSelectedIndex(view)).toBe(0)
  })

  it('accepts on Enter through the keymap', () => {
    const view = mount()
    type(view, '[[bet')
    const notPrevented = press(view, 'Enter')
    expect(notPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('[[beta]]')
  })

  it('accepts on Tab through the keymap', () => {
    const view = mount()
    type(view, '[[bet')
    press(view, 'Tab')
    expect(view.state.doc.toString()).toBe('[[beta]]')
  })

  it('accepts on Space through the keymap', () => {
    const view = mount()
    type(view, '[[bet')
    press(view, ' ', 'Space')
    expect(view.state.doc.toString()).toBe('[[beta]]')
  })

  it('moves the selection with the arrow keys through the keymap', () => {
    const view = mount()
    type(view, '[[')
    press(view, 'ArrowDown')
    expect(wikilinkMenuSelectedIndex(view)).toBe(1)
    press(view, 'ArrowUp')
    expect(wikilinkMenuSelectedIndex(view)).toBe(0)
  })

  it('lets Space through when the menu is closed', () => {
    const view = mount()
    type(view, 'word')
    // Not prevented, so the editor still receives the space.
    expect(press(view, ' ', 'Space')).toBe(true)
  })

  it('inserts on a row click', () => {
    const view = mount()
    type(view, '[[bet')
    const row = view.dom.querySelector<HTMLElement>('.write-wikilink-row')
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(view.state.doc.toString()).toBe('[[beta]]')
  })

  it('clicking a later row inserts that row', () => {
    const view = mount()
    type(view, '[[')
    const rows = view.dom.querySelectorAll<HTMLElement>('.write-wikilink-row')
    rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(view.state.doc.toString()).toBe('[[beta]]')
  })

  it('hovering a row moves the selection to it', () => {
    const view = mount()
    type(view, '[[')
    const rows = view.dom.querySelectorAll<HTMLElement>('.write-wikilink-row')
    rows[2]?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    expect(wikilinkMenuSelectedIndex(view)).toBe(2)
  })

  it('excludes the edited file and resolves paths when activePath is absolute', () => {
    // The Write store carries absolute paths, which is what the app passes in.
    const view = mount({ activePath: '/vault/notes/alpha.md' })
    type(view, '[[')
    expect(wikilinkMenuRows(view).map((row) => row.relativePath))
      .not.toContain('notes/alpha.md')
    type(view, 'ind')
    acceptWikilinkMenu(view)
    expect(view.state.doc.toString()).toBe('[[../index]]')
  })

  it('closes on demand and reports whether it was open', () => {
    const view = mount()
    type(view, '[[')
    expect(closeWikilinkMenu(view)).toBe(true)
    expect(wikilinkMenuRows(view)).toEqual([])
    expect(closeWikilinkMenu(view)).toBe(false)
  })

  it('reopens after being closed once the query changes', () => {
    const view = mount()
    type(view, '[[')
    closeWikilinkMenu(view)
    type(view, 'bet')
    expect(wikilinkMenuRows(view).map((row) => row.relativePath)).toEqual(['notes/beta.md'])
  })

  it('does nothing when accept or move run with the menu closed', () => {
    const view = mount()
    type(view, 'plain')
    expect(acceptWikilinkMenu(view)).toBe(false)
    expect(moveWikilinkSelection(1)(view)).toBe(false)
    expect(view.state.doc.toString()).toBe('plain')
  })

  it('picks up targets that arrive after the menu opened', () => {
    const view = mount({ targets: [] })
    type(view, '[[bet')
    expect(wikilinkMenuRows(view)).toEqual([])
    view.dispatch({ effects: setWikilinkTargets.of(TARGETS) })
    expect(wikilinkMenuRows(view).map((row) => row.relativePath)).toEqual(['notes/beta.md'])
  })

  it('closes when the selection becomes a range', () => {
    const view = mount()
    type(view, '[[bet')
    view.dispatch({ selection: { anchor: 2, head: 5 } })
    expect(wikilinkMenuRows(view)).toEqual([])
  })
})
