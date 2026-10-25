const getters = new WeakMap<Element, () => string>()

/**
 * The Word viewer mounts only the pages near the reader, so copying its DOM
 * would copy a few pages. It registers a getter for the whole document here;
 * the file panel's copy action reads it through the viewer's root element.
 */
export function registerDocxPreviewText(element: Element, getter: () => string): () => void {
  getters.set(element, getter)
  return () => {
    if (getters.get(element) === getter) getters.delete(element)
  }
}

export function registeredDocxPreviewText(element: Element | null): string | null {
  const getter = element ? getters.get(element) : undefined
  if (!getter) return null
  const text = getter()
  return text || null
}
