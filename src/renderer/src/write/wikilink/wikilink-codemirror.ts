import { Facet, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, type PluginValue, type ViewUpdate } from '@codemirror/view'
import { findWikilinkQuery, type WikilinkQuery } from './wikilink-query'
import {
  buildWikilinkInsertion,
  rankWikilinkTargets,
  type RankedWikilinkTarget,
  type WikilinkTarget
} from './wikilink-targets'
import { WIKILINK_MENU_MAX_ROWS, WikilinkMenuView } from './wikilink-menu-view'

/**
 * `[[` reference menu for the markdown editor.
 *
 * Written directly against `@codemirror/view` rather than pulling in
 * `@codemirror/autocomplete`: the package is not already a dependency, the
 * packaged-size gate makes adding one a real cost, and the behaviour needed here
 * (one trigger, a fixed target list, workspace-aware rows) is narrower than
 * that library's model.
 */

export const setWikilinkTargets = StateEffect.define<readonly WikilinkTarget[]>()

const wikilinkTargets = StateField.define<readonly WikilinkTarget[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setWikilinkTargets)) return effect.value
    }
    return value
  }
})

/**
 * Config lives in a facet so the view plugin can be defined at module scope.
 * That is what lets the menu commands below be plain exported functions that
 * any caller — the keymap, or a test — can run against a view.
 */
export const wikilinkMenuConfig = Facet.define<WikilinkMenuContext, WikilinkMenuContext | null>({
  combine: (values) => values[0] ?? null
})

export type WikilinkMenuContext = {
  /** Workspace root of the file being edited. */
  workspaceRoot: () => string
  /** Workspace-relative path of the file being edited. */
  activePath: () => string
  /** Called when the menu opens, so scanning can stay lazy. */
  onRequestTargets?: () => void
  /**
   * Message shown when the query matches nothing. Returning a string keeps the
   * menu visible with an explanation instead of vanishing, which is otherwise
   * indistinguishable from the feature being broken.
   */
  emptyStateText?: (hasTargets: boolean) => string | null
}

function activeQuery(view: EditorView): WikilinkQuery | null {
  const selection = view.state.selection.main
  if (!selection.empty) return null
  return findWikilinkQuery(view.state.doc.toString(), selection.head)
}

class WikilinkMenu implements PluginValue {
  private readonly menu: WikilinkMenuView
  private matches: RankedWikilinkTarget[] = []
  private selected = 0
  private query: WikilinkQuery | null = null
  private emptyText: string | null = null
  /** Last painted position, reused so a reopen is never unpositioned. */
  private placement: { left: number; top: number } = { left: 4, top: 4 }

  constructor(private readonly view: EditorView) {
    this.menu = new WikilinkMenuView({
      parent: view.dom,
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

  /** Whether the menu is on screen — rows, or an explanatory empty state. */
  get open(): boolean {
    return this.query !== null && (this.matches.length > 0 || this.emptyText !== null)
  }

  /** Only true when there is something to select; keys fall through otherwise. */
  get hasRows(): boolean {
    return this.query !== null && this.matches.length > 0
  }

  /** Visible rows, exposed for assertions where jsdom cannot lay out the DOM. */
  get rows(): readonly RankedWikilinkTarget[] {
    return this.matches
  }

  get selectedIndex(): number {
    return this.selected
  }

  private get context(): WikilinkMenuContext | null {
    return this.view.state.facet(wikilinkMenuConfig)
  }

  update(update: ViewUpdate): void {
    if (update.focusChanged && !update.view.hasFocus) {
      this.close()
      return
    }
    if (update.docChanged || update.selectionSet || update.focusChanged) this.refresh()
    else if (update.state.field(wikilinkTargets) !== update.startState.field(wikilinkTargets)) {
      this.refresh()
    }
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
    const context = this.context
    if (!this.hasRows || !this.query || !context) return false
    const target = this.matches[this.selected]
    if (!target) return false
    const insertion = buildWikilinkInsertion(target, {
      workspaceRoot: context.workspaceRoot(),
      activePath: context.activePath()
    })
    const { from, to, closed } = this.query
    const text = closed ? insertion : `${insertion}]]`
    this.view.dispatch({
      changes: { from, to, insert: text },
      // Land the caret after `]]` either way, so typing continues outside the
      // reference instead of inside it.
      selection: { anchor: from + insertion.length + 2 },
      scrollIntoView: true
    })
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
    const context = this.context
    // Deliberately not gated on `view.hasFocus`: an editor that is receiving
    // typed text is focused by definition, and reading focus here made the menu
    // fail silently whenever that check disagreed.
    const next = context ? activeQuery(this.view) : null
    const targets = this.view.state.field(wikilinkTargets)
    if (next) context?.onRequestTargets?.()
    const queryChanged = next?.query !== this.query?.query
    this.query = next
    this.matches = next && context
      ? rankWikilinkTargets(targets, next.query, {
          workspaceRoot: context.workspaceRoot(),
          activePath: context.activePath(),
          limit: WIKILINK_MENU_MAX_ROWS
        })
      : []
    this.emptyText = next && this.matches.length === 0
      ? context?.emptyStateText?.(targets.length > 0) ?? null
      : null
    if (queryChanged || this.selected >= this.matches.length) this.selected = 0
    this.render()
  }

  /**
   * Rows are rendered synchronously; the caret position is read in a measure
   * pass because `coordsAtPos` reads layout, which CodeMirror forbids during an
   * update — calling it from `update()` throws and disables the whole plugin.
   */
  private render(): void {
    if (!this.open || !this.query) {
      this.menu.hide()
      return
    }
    this.menu.render(this.matches, this.selected, this.emptyText)
    const anchorPos = this.query.from
    const rowCount = this.matches.length
    this.view.requestMeasure<{ left: number; top: number } | null>({
      read: (view) => {
        const caret = view.coordsAtPos(anchorPos)
        if (!caret) return null
        const container = view.dom.getBoundingClientRect()
        return WikilinkMenuView.placementFor(caret, container, rowCount)
      },
      write: (placement) => {
        // A null read means the caret is not laid out right now; the eager
        // placement inside the view already keeps the menu on screen.
        if (placement) this.menu.place(placement)
      }
    })
  }
}

const wikilinkMenuPlugin = ViewPlugin.define((view) => new WikilinkMenu(view))

function withMenu(run: (menu: WikilinkMenu) => boolean) {
  return (view: EditorView): boolean => {
    const menu = view.plugin(wikilinkMenuPlugin)
    return menu ? run(menu) : false
  }
}

export const moveWikilinkSelection = (delta: number) => withMenu((menu) => menu.move(delta))
export const acceptWikilinkMenu = withMenu((menu) => menu.accept())
export const closeWikilinkMenu = withMenu((menu) => menu.close())

/** Test/inspection helper: the rows the menu is currently offering. */
export function wikilinkMenuRows(view: EditorView): readonly RankedWikilinkTarget[] {
  const menu = view.plugin(wikilinkMenuPlugin)
  return menu?.hasRows ? menu.rows : []
}

/** Test/inspection helper: whether the menu is on screen in any form. */
export function wikilinkMenuVisible(view: EditorView): boolean {
  return view.plugin(wikilinkMenuPlugin)?.open ?? false
}

export function wikilinkMenuSelectedIndex(view: EditorView): number {
  return view.plugin(wikilinkMenuPlugin)?.selectedIndex ?? -1
}

export function buildWikilinkMenuExtension(context: WikilinkMenuContext): Extension {
  return [
    wikilinkTargets,
    wikilinkMenuConfig.of(context),
    wikilinkMenuPlugin,
    // Highest precedence: these keys must beat the editor's own list and
    // history bindings while the menu is open, and fall through when it is not.
    Prec.highest(
      keymap.of([
        { key: 'ArrowDown', run: moveWikilinkSelection(1) },
        { key: 'ArrowUp', run: moveWikilinkSelection(-1) },
        { key: 'Enter', run: acceptWikilinkMenu },
        { key: 'Tab', run: acceptWikilinkMenu },
        // Space accepts too. The trade-off is deliberate and visible: a space
        // can no longer be typed inside an open `[[` query.
        { key: 'Space', run: acceptWikilinkMenu },
        { key: 'Escape', run: closeWikilinkMenu }
      ])
    )
  ]
}
