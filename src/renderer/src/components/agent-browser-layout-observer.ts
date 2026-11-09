// A CSS UI-scale change does not necessarily resize the observed element's
// layout box. Watch the scale's roots as well as visual viewport movement.
export function observeBrowserLayout(element: HTMLElement, update: () => void): () => void {
  const resize = new ResizeObserver(update)
  resize.observe(element)
  window.addEventListener('resize', update)
  window.addEventListener('scroll', update, true)
  const mutation = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(update)
  if (typeof document !== 'undefined') {
    for (const root of [document.documentElement, document.body]) {
      if (root) mutation?.observe(root, { attributes: true, attributeFilter: ['class', 'style'] })
    }
  }
  return () => {
    resize.disconnect()
    mutation?.disconnect()
    window.removeEventListener('resize', update)
    window.removeEventListener('scroll', update, true)
  }
}
