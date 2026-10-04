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
  const name = element => element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')
    ?.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || '').join(' ')
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
    controls: [...target.querySelectorAll('select,[data-gateway-client-select]')].filter(shown).map(control => {
      const bounds = rect(control)
      return { name: name(control), role: control.getAttribute('role')
        || (control.tagName === 'SELECT' ? 'combobox' : 'button'),
        disabled: control.disabled, bounds, fullyVisible: fullyVisible(bounds) }
    }),
    tabs: [...target.querySelectorAll('[role="tab"]')].map(tab => ({ id: tab.id,
      name: tab.textContent?.trim(), selected: tab.getAttribute('aria-selected') === 'true', bounds: rect(tab) })),
    scroll: scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : null }
}

export function readGatewayClientPicker() {
  const name = element => element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')
    ?.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || '').join(' ')
  const rect = element => {
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
    return { x, y, width, height, right, bottom }
  }
  const visible = element => {
    const style = getComputedStyle(element)
    return !element.closest('[hidden],[inert]') && element.getClientRects().length > 0
      && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
  }
  const viewport = { x: 0, y: 0, right: innerWidth, bottom: innerHeight }
  const within = (bounds, clip = viewport) => bounds.width > 0 && bounds.height > 0
    && bounds.x >= clip.x - 1 && bounds.y >= clip.y - 1
    && bounds.right <= clip.right + 1 && bounds.bottom <= clip.bottom + 1
  const icon = (element, clip) => {
    const mark = element.querySelector('[data-agent-icon]')
    if (!mark) return null
    const bounds = rect(mark), style = getComputedStyle(mark)
    const images = [...mark.querySelectorAll('img')].filter(visible)
    const mask = style.maskImage || style.webkitMaskImage || 'none'
    return { id: mark.getAttribute('data-agent-icon'), bounds, visible: visible(mark),
      fullyVisible: within(bounds, clip), mask,
      images: images.map(image => ({ complete: image.complete, naturalWidth: image.naturalWidth })),
      hasGraphic: mask !== 'none' || !!mark.querySelector('svg,path')
        || images.some(image => image.complete && image.naturalWidth > 0) }
  }
  const trigger = [...document.querySelectorAll('[data-gateway-client-select]')].find(visible)
  const menu = [...document.querySelectorAll('[data-gateway-client-listbox]')].find(visible)
  const menuBounds = menu ? rect(menu) : null
  const menuClip = menuBounds ? { x: Math.max(0, menuBounds.x), y: Math.max(0, menuBounds.y),
    right: Math.min(innerWidth, menuBounds.right), bottom: Math.min(innerHeight, menuBounds.bottom) } : viewport
  return { viewport, trigger: trigger ? { name: name(trigger), role: trigger.getAttribute('role'),
    text: trigger.textContent?.trim(), expanded: trigger.getAttribute('aria-expanded') === 'true',
    popup: trigger.getAttribute('aria-haspopup'), bounds: rect(trigger),
    fullyVisible: within(rect(trigger)), icon: icon(trigger, rect(trigger)) } : null,
  menu: menu ? { role: menu.getAttribute('role'), bounds: menuBounds,
    fullyVisible: within(menuBounds), options: [...menu.querySelectorAll('[data-gateway-client-option]')]
      .map(option => ({ id: option.getAttribute('data-gateway-client-option'),
        role: option.getAttribute('role'), text: option.textContent?.trim(),
        selected: option.getAttribute('aria-selected') === 'true', bounds: rect(option),
        visible: visible(option), fullyVisible: within(rect(option), menuClip),
        icon: icon(option, menuClip) })) } : null }
}

export async function verifyGatewayClientMaskAssets() {
  const assets = new Map()
  for (const mark of document.querySelectorAll('[data-gateway-client-select] [data-agent-icon],[data-gateway-client-listbox] [data-agent-icon]')) {
    const style = getComputedStyle(mark)
    if (mark.closest('[hidden],[inert]') || !mark.getClientRects().length
      || style.display === 'none' || style.visibility === 'hidden') continue
    const mask = style.maskImage || style.webkitMaskImage || 'none'
    if (mask === 'none') continue
    const matches = [...mask.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)/g)]
    if (!matches.length) throw new Error('Client mask must reference a decodable local asset')
    for (const match of matches) {
      const url = new URL(match[1] || match[2] || match[3], location.href)
      if (url.protocol !== 'data:' && url.origin !== location.origin) {
        throw new Error('Client logo verification cannot load external assets')
      }
      assets.set(url.href, mark.getAttribute('data-agent-icon'))
    }
  }
  return Promise.all([...assets].map(async ([url, id]) => {
    const image = new Image()
    image.src = url
    let timer
    try {
      await Promise.race([image.decode(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Client logo decode timed out: ${id}`)), 5000)
      })])
      if (!image.naturalWidth || !image.naturalHeight) throw new Error(`Client logo has no decoded pixels: ${id}`)
      return { id, url, width: image.naturalWidth, height: image.naturalHeight, decoded: true }
    } finally { clearTimeout(timer) }
  }))
}
