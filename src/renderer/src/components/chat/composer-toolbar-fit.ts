/**
 * The composer toolbar is always one row. When its controls do not fit, words
 * give way in a fixed order (composer-toolbar-layout.css defines what each
 * level hides) instead of the action group wrapping onto a second row:
 *   1 secondary chrome (context gauge, sub-agent picker, "· Work")
 *   2 Agent name        3 model name       4 reasoning level
 *   5 chevrons and gaps 6 compact action buttons
 *   7 last resort below ~250px: wrap, because clipping an action is worse
 * The level is measured, not guessed from the width, so a longer Agent name,
 * an extra badge or a missing voice button all land on the right level.
 */
export const COMPOSER_TOOLBAR_FIT_LEVELS = 7

/** A model name squeezed below this reads as noise; the next level hides it. */
const MIN_VISIBLE_NAME_PX = 72

/** Containers whose children must stay inside them (right-aligned groups overflow to the left, which scrollWidth cannot see). */
const CONTAINED_PARTS = [
  '.ds-composer-toolbar-start',
  '.ds-composer-toolbar-actions',
  '.ds-composer-model-trigger'
].join(',')

function applyLevel(toolbar: HTMLElement, level: number): void {
  for (let step = 1; step <= COMPOSER_TOOLBAR_FIT_LEVELS; step++) {
    toolbar.toggleAttribute(`data-fit-${step}`, step <= level)
  }
}

function isShown(element: Element): boolean {
  return element.getClientRects().length > 0
}

function escapes(parent: HTMLElement): boolean {
  const box = parent.getBoundingClientRect()
  for (const child of parent.children) {
    if (!isShown(child)) continue
    const rect = child.getBoundingClientRect()
    if (rect.left < box.left - 1 || rect.right > box.right + 1) return true
  }
  return false
}

function toolbarFits(toolbar: HTMLElement): boolean {
  if (escapes(toolbar)) return false
  for (const part of toolbar.querySelectorAll<HTMLElement>(CONTAINED_PARTS)) {
    if (isShown(part) && escapes(part)) return false
  }
  for (const name of toolbar.querySelectorAll<HTMLElement>('.ds-composer-model-trigger-model')) {
    if (isShown(name) && name.scrollWidth > name.clientWidth + 1 && name.clientWidth < MIN_VISIBLE_NAME_PX) return false
  }
  return true
}

/** Smallest level at which the toolbar fits; the last level when none does. */
export function fitComposerToolbar(toolbar: HTMLElement): number {
  if (toolbar.clientWidth === 0) return 0
  let level = 0
  for (; level < COMPOSER_TOOLBAR_FIT_LEVELS; level++) {
    applyLevel(toolbar, level)
    if (toolbarFits(toolbar)) break
  }
  applyLevel(toolbar, level)
  return level
}

/**
 * Ref callback for the toolbar element. Re-fits from level 0 whenever the
 * toolbar is resized or its controls change, so widening restores the words.
 * Stable identity: React attaches it once per element and runs the cleanup.
 */
export function composerToolbarFitRef(toolbar: HTMLElement | null): (() => void) | void {
  if (!toolbar) return
  const fit = (): void => { fitComposerToolbar(toolbar) }
  fit()
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
  resize?.observe(toolbar)
  const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(fit)
  mutations?.observe(toolbar, { childList: true, subtree: true, characterData: true })
  // Web fonts change text widths after the first measurement.
  let disposed = false
  void (typeof document === 'undefined' ? undefined : document.fonts?.ready)?.then(() => { if (!disposed) fit() })
  return () => {
    disposed = true
    resize?.disconnect()
    mutations?.disconnect()
  }
}
