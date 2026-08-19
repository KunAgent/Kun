import type { RankedWikilinkTarget } from './wikilink-targets'

export type WikilinkMenuPlacement = { left: number; top: number }

export type WikilinkMenuViewOptions = {
  /** Element the menu is appended to; it must be a positioned ancestor. */
  parent: HTMLElement
  onPick: (index: number) => void
  onHover: (index: number) => void
}

export const WIKILINK_MENU_ROW_HEIGHT = 30
export const WIKILINK_MENU_MAX_ROWS = 12

/**
 * The `[[` menu's DOM, shared by the CodeMirror and ProseMirror integrations so
 * both editors present an identical menu from one implementation.
 *
 * Owns nothing but presentation: query parsing, ranking, and insertion live in
 * the sibling modules, and each editor plugin supplies its own placement.
 */
export class WikilinkMenuView {
  private readonly host: HTMLDivElement
  private placement: WikilinkMenuPlacement = { left: 4, top: 4 }

  constructor(private readonly options: WikilinkMenuViewOptions) {
    this.host = document.createElement('div')
    this.host.className = 'write-wikilink-menu'
    this.host.setAttribute('role', 'listbox')
    this.host.style.display = 'none'
    // Position eagerly: an absolutely positioned box with `auto` offsets falls
    // back to its static position, which both editors clip away.
    this.applyPlacement(this.placement)
    // Clicking a row must not blur the editor before the insertion runs.
    this.host.addEventListener('mousedown', (event) => event.preventDefault())
    options.parent.appendChild(this.host)
  }

  get element(): HTMLElement {
    return this.host
  }

  hide(): void {
    this.host.style.display = 'none'
    this.host.replaceChildren()
  }

  /** Renders rows, or a single explanatory line when there are none. */
  render(rows: readonly RankedWikilinkTarget[], selected: number, emptyText: string | null): void {
    if (rows.length === 0 && emptyText === null) {
      this.hide()
      return
    }
    this.host.style.display = 'block'
    this.applyPlacement(this.placement)
    this.host.replaceChildren(
      ...(rows.length > 0
        ? rows.map((row, index) => this.renderRow(row, index, selected))
        : [this.renderEmptyState(emptyText ?? '')])
    )
  }

  place(placement: WikilinkMenuPlacement): void {
    this.placement = placement
    this.applyPlacement(placement)
  }

  /**
   * Preferred position for a caret rectangle inside a container rectangle.
   *
   * `scroll` must be the container's scroll offset when the container is itself
   * scrollable: the caret rectangle is viewport-relative but `left`/`top` are
   * resolved against the padding box, so without it the menu drifts by exactly
   * how far the document is scrolled.
   */
  static placementFor(
    caret: { left: number; top: number; bottom: number },
    container: { left: number; top: number; height: number },
    rowCount: number,
    scroll: { left: number; top: number } = { left: 0, top: 0 }
  ): WikilinkMenuPlacement {
    const below = caret.bottom - container.top + 4
    const estimatedHeight =
      Math.min(rowCount, WIKILINK_MENU_MAX_ROWS) * WIKILINK_MENU_ROW_HEIGHT + 8
    // Prefer below the caret; flip above when the container bottom is close.
    const flip = below + estimatedHeight > container.height &&
      caret.top - container.top > estimatedHeight
    return {
      left: Math.max(4, caret.left - container.left + scroll.left),
      top: (flip ? caret.top - container.top - estimatedHeight - 4 : below) + scroll.top
    }
  }

  destroy(): void {
    this.host.remove()
  }

  private applyPlacement(placement: WikilinkMenuPlacement): void {
    this.host.style.left = `${placement.left}px`
    this.host.style.top = `${placement.top}px`
  }

  private renderEmptyState(text: string): HTMLElement {
    const row = document.createElement('div')
    row.className = 'write-wikilink-empty'
    row.textContent = text
    return row
  }

  private renderRow(
    match: RankedWikilinkTarget,
    index: number,
    selected: number
  ): HTMLElement {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = `write-wikilink-row${index === selected ? ' is-selected' : ''}`
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', String(index === selected))
    const name = document.createElement('span')
    name.className = 'write-wikilink-name'
    name.textContent = match.name
    const path = document.createElement('span')
    path.className = 'write-wikilink-path'
    // An external target is labelled by workspace, since its bare relative path
    // would look like it belongs to the file being edited.
    path.textContent = match.external
      ? `${match.workspaceName} · ${match.relativePath}`
      : match.relativePath
    row.append(name, path)
    if (match.external) {
      const badge = document.createElement('span')
      badge.className = 'write-wikilink-badge'
      badge.textContent = '↗'
      row.appendChild(badge)
    }
    row.addEventListener('mouseenter', () => this.options.onHover(index))
    row.addEventListener('click', () => this.options.onPick(index))
    return row
  }
}
