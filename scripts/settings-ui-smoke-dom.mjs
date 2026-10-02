// These self-contained callbacks are serialized into the real renderer by
// Playwright. Keep them free of module-scope dependencies.
export function annotateSettingsControls(elements) {
  for (const [index, element] of elements.entries()) {
    let closedDisclosure = false
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName !== 'DETAILS' || ancestor.open) continue
      const summary = [...ancestor.children].find(child => child.tagName === 'SUMMARY')
      if (!summary?.contains(element)) { closedDisclosure = true; break }
    }
    const style = element.ownerDocument.defaultView.getComputedStyle(element)
    const shown = !closedDisclosure && !element.closest('[hidden],[inert],[aria-hidden="true"]')
      && style.display !== 'none' && style.visibility !== 'hidden'
      && element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0
    element.setAttribute('data-settings-smoke-control', String(index))
    element.setAttribute('data-settings-smoke-rendered', String(shown))
  }
}

export function annotateSettingsTabs(elements) {
  // Hidden panels retain their DOM. Remove old tokens before reusing indexes,
  // otherwise a visible tab can collide with a hidden tab from the last panel.
  const document = elements[0]?.ownerDocument
  for (const element of document?.querySelectorAll('[data-settings-smoke-tab]') ?? []) {
    element.removeAttribute('data-settings-smoke-tab')
  }
  const occurrences = new Map()
  return elements.map((element, index) => {
    const name = element.textContent?.trim() ?? ''
    const group = element.closest('[role="tablist"]')?.getAttribute('aria-label') ?? ''
    const base = element.id || `${group}::${name}`
    const count = (occurrences.get(base) ?? 0) + 1
    occurrences.set(base, count)
    element.setAttribute('data-settings-smoke-tab', String(index))
    return { id: element.id, name, key: `${base}::${count}`, token: String(index),
      selected: element.getAttribute('aria-selected') === 'true' }
  })
}
