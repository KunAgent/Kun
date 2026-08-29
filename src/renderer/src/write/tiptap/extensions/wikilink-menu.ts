import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { findWikilinkQuery, type WikilinkQuery } from '../../wikilink/wikilink-query'
import {
  WIKILINK_MENU_MAX_ROWS,
  WikilinkMenuView
} from '../../wikilink/wikilink-menu-view'
import {
  buildWikilinkInsertion,
  rankWikilinkTargets,
  type RankedWikilinkTarget,
  type WikilinkTarget
} from '../../wikilink/wikilink-targets'

/**
 * `[[` reference menu for the rich-text editor.
 *
 * Shares every non-visual part with the CodeMirror integration — query
 * detection, ranking, insertion text, and the menu DOM — so both editors behave
 * identically. Only position mapping differs, because ProseMirror addresses the
 * document by node positions rather than string offsets.
 */

export const wikilinkMenuKey = new PluginKey<readonly WikilinkTarget[]>('writeWikilinkMenu')

export type WikilinkMenuExtensionOptions = {
  workspaceRoot: () => string
  activePath: () => string
  onRequestTargets?: () => void
  emptyStateText?: (hasTargets: boolean) => string | null
  isReadOnly?: () => boolean
}

type RichWikilinkQuery = WikilinkQuery & {
  /** Document positions for the query range. */
  docFrom: number
  docTo: number
}

/**
 * Locates the open `[[` in the caret's text block.
 *
 * `textBetween` uses a single-character placeholder for inline leaf nodes, which
 * keeps string offsets and document positions one-to-one so the range can be
 * mapped back without walking the block again.
 */
export function findRichWikilinkQuery(state: EditorState): RichWikilinkQuery | null {
  const selection = state.selection
  if (!selection.empty) return null
  const $from = selection.$from
  if (!$from.parent.isTextblock) return null
  const blockStart = $from.start()
  // U+FFFC (object replacement) is ProseMirror's convention for a leaf node, so
  // an inline image or mention occupies one character and never shifts the
  // offsets the query is measured against. Written as an escape to keep the
  // source ASCII and the intent visible.
  const blockText = state.doc.textBetween($from.start(), $from.end(), '\n', '\ufffc')
  const found = findWikilinkQuery(blockText, $from.pos - blockStart)
  if (!found) return null
  return { ...found, docFrom: blockStart + found.from, docTo: blockStart + found.to }
}

class RichWikilinkMenu {
  private readonly menu: WikilinkMenuView
  private matches: RankedWikilinkTarget[] = []
  private selected = 0
  private query: RichWikilinkQuery | null = null
  private emptyText: string | null = null

  constructor(
    private readonly view: EditorView,
    private readonly options: WikilinkMenuExtensionOptions
  ) {
    this.menu = new WikilinkMenuView({
      // `dom` is the contenteditable; its offset parent is the editor wrapper,
      // which is what the shared CSS makes a positioned ancestor.
      parent: view.dom.parentElement ?? view.dom,
      onHover: (index) => {
        this.selected = index
        this.render()
      },
      onPick: (index) => {
        this.selected = index
        this.accept()
        this.view.focus()
      }
    })
    this.refresh()
  }

  get open(): boolean {
    return this.query !== null && (this.matches.length > 0 || this.emptyText !== null)
  }

  get hasRows(): boolean {
    return this.query !== null && this.matches.length > 0
  }

  get rows(): readonly RankedWikilinkTarget[] {
    return this.matches
  }

  get selectedIndex(): number {
    return this.selected
  }

  update(): void {
    this.refresh()
  }

  destroy(): void {
    this.menu.destroy()
  }

  move(delta: number): boolean {
    if (!this.hasRows) return false
    const count = this.matches.length
    this.selected = (this.selected + delta + count) % count
    this.render()
    return true
  }

  accept(): boolean {
    if (!this.hasRows || !this.query) return false
    const target = this.matches[this.selected]
    if (!target) return false
    const insertion = buildWikilinkInsertion(target, {
      workspaceRoot: this.options.workspaceRoot(),
      activePath: this.options.activePath()
    })
    const { docFrom, docTo, closed } = this.query
    const text = closed ? insertion : `${insertion}]]`
    const transaction = this.view.state.tr.insertText(text, docFrom, docTo)
    // The whole `[[...]]` gets the wikilink mark so serialization writes the
    // brackets bare; `docFrom` sits just after the opener the user typed.
    const markType = this.view.state.schema.marks.wikilink
    if (markType && docFrom >= 2) {
      transaction
        .addMark(docFrom - 2, docFrom + insertion.length + 2, markType.create())
        .removeStoredMark(markType)
    }
    // Land the caret after `]]` either way, so typing continues outside the
    // reference instead of inside it.
    const caret = Math.min(docFrom + insertion.length + 2, transaction.doc.content.size)
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(caret)))
    this.view.dispatch(transaction)
    this.close()
    return true
  }

  close(): boolean {
    if (this.query === null) return false
    this.query = null
    this.matches = []
    this.emptyText = null
    this.selected = 0
    this.render()
    return true
  }

  private refresh(): void {
    const readOnly = this.options.isReadOnly?.() ?? false
    const next = readOnly ? null : findRichWikilinkQuery(this.view.state)
    const targets = wikilinkMenuKey.getState(this.view.state) ?? []
    if (next) this.options.onRequestTargets?.()
    const queryChanged = next?.query !== this.query?.query
    this.query = next
    this.matches = next
      ? rankWikilinkTargets(targets, next.query, {
          workspaceRoot: this.options.workspaceRoot(),
          activePath: this.options.activePath(),
          limit: WIKILINK_MENU_MAX_ROWS
        })
      : []
    this.emptyText = next && this.matches.length === 0
      ? this.options.emptyStateText?.(targets.length > 0) ?? null
      : null
    if (queryChanged || this.selected >= this.matches.length) this.selected = 0
    this.render()
  }

  private render(): void {
    if (!this.open || !this.query) {
      this.menu.hide()
      return
    }
    this.menu.render(this.matches, this.selected, this.emptyText)
    const parent = this.menu.element.parentElement
    if (!parent) return
    // This runs inside a plugin view update, so a layout read that throws would
    // take the whole transaction — and typing — down with it. The menu already
    // has an eager placement, so a failed measurement is survivable.
    try {
      const caret = this.view.coordsAtPos(this.query.docFrom)
      if (!caret) return
      this.menu.place(
        WikilinkMenuView.placementFor(
          caret,
          parent.getBoundingClientRect(),
          this.matches.length,
          // `.write-rich-host` scrolls, so the offset has to be folded in.
          { left: parent.scrollLeft, top: parent.scrollTop }
        )
      )
    } catch {
      /* keep the current placement */
    }
  }
}

const menuInstances = new WeakMap<EditorView, RichWikilinkMenu>()

function withMenu(run: (menu: RichWikilinkMenu) => boolean) {
  return (view: EditorView): boolean => {
    const menu = menuInstances.get(view)
    return menu ? run(menu) : false
  }
}

export const richWikilinkMenuRows = (view: EditorView): readonly RankedWikilinkTarget[] => {
  const menu = menuInstances.get(view)
  return menu?.hasRows ? menu.rows : []
}

export const richWikilinkMenuVisible = (view: EditorView): boolean =>
  menuInstances.get(view)?.open ?? false

export const richWikilinkMenuSelectedIndex = (view: EditorView): number =>
  menuInstances.get(view)?.selectedIndex ?? -1

export const acceptRichWikilinkMenu = withMenu((menu) => menu.accept())
export const closeRichWikilinkMenu = withMenu((menu) => menu.close())
export const moveRichWikilinkSelection = (delta: number) =>
  withMenu((menu) => menu.move(delta))

export const WriteRichWikilinkMenu = Extension.create<WikilinkMenuExtensionOptions>({
  name: 'writeRichWikilinkMenu',

  addOptions() {
    return {
      workspaceRoot: () => '',
      activePath: () => ''
    }
  },

  addKeyboardShortcuts() {
    // Bound here rather than in plugin props so these beat the list and history
    // handlers StarterKit installs, matching the CodeMirror precedence.
    const run = (command: (view: EditorView) => boolean) => (): boolean =>
      command(this.editor.view)
    return {
      ArrowDown: run(moveRichWikilinkSelection(1)),
      ArrowUp: run(moveRichWikilinkSelection(-1)),
      Enter: run(acceptRichWikilinkMenu),
      Tab: run(acceptRichWikilinkMenu),
      // Space accepts too. The trade-off is deliberate and visible: a space can
      // no longer be typed inside an open `[[` query.
      Space: run(acceptRichWikilinkMenu),
      ' ': run(acceptRichWikilinkMenu),
      Escape: run(closeRichWikilinkMenu)
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<readonly WikilinkTarget[]>({
        key: wikilinkMenuKey,
        state: {
          init: () => [],
          apply: (transaction, value) => transaction.getMeta(wikilinkMenuKey) ?? value
        },
        view: (view) => {
          const menu = new RichWikilinkMenu(view, options)
          menuInstances.set(view, menu)
          return {
            update: () => menu.update(),
            destroy: () => {
              menuInstances.delete(view)
              menu.destroy()
            }
          }
        }
      })
    ]
  }
})

/** Pushes a freshly scanned target list into a running rich editor. */
export function setRichWikilinkTargets(
  view: EditorView,
  targets: readonly WikilinkTarget[]
): void {
  view.dispatch(view.state.tr.setMeta(wikilinkMenuKey, targets))
}
