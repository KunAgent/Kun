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

export function scrollSettingsDetail({ kind, controlId, readOnly = false }) {
  const shown = element => !element.closest('[hidden],[inert],[aria-hidden="true"]')
    && element.getClientRects().length > 0
  const target = kind === 'general-switch'
    ? document.querySelector(`[data-settings-smoke-control="${controlId}"]`)
    : kind === 'gateway-connection-controls'
      ? [...document.querySelectorAll('[data-gateway-connection-controls]')].find(shown)
      : [...document.querySelectorAll('[role="tab"][id^="model-routes-settings-tab-"]')]
        .find(shown)?.closest('[role="tablist"]')
  if (!target) return null
  // A readiness sample must read the settled position, never restart scrolling.
  if (!readOnly) target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  const rect = element => {
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
    return { x, y, width, height, right, bottom }
  }
  const bounds = rect(target)
  const scroller = target.closest('.ds-settings-scroller')
  const viewport = { x: 0, y: 0, right: innerWidth, bottom: innerHeight }
  const scrollport = scroller ? rect(scroller) : viewport
  const clip = { x: Math.max(0, scrollport.x), y: Math.max(0, scrollport.y),
    right: Math.min(innerWidth, scrollport.right), bottom: Math.min(innerHeight, scrollport.bottom) }
  const fullyVisible = bounds => bounds.x >= clip.x - 1 && bounds.y >= clip.y - 1
    && bounds.right <= clip.right + 1 && bounds.bottom <= clip.bottom + 1
  return { kind, targetId: target.id, targetRole: target.getAttribute('role'), bounds,
    name: target.getAttribute('aria-label'), viewport, clip,
    fullyVisible: fullyVisible(bounds),
    controls: [...target.querySelectorAll('select')].filter(shown).map(control => {
      const bounds = rect(control)
      return { name: control.getAttribute('aria-label'), role: 'combobox',
        disabled: control.disabled, bounds, fullyVisible: fullyVisible(bounds) }
    }),
    tabs: [...target.querySelectorAll('[role="tab"]')].map(tab => ({ id: tab.id,
      name: tab.textContent?.trim(), selected: tab.getAttribute('aria-selected') === 'true', bounds: rect(tab) })),
    scroll: scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : null }
}
