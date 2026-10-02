// Browser measurements, not screenshot inference. Chromium's accessibility tree
// supplies computed names; DOM measurements supply actual layout and focus state.
import { annotateSettingsControls } from './settings-ui-smoke-dom.mjs'
export const CONTROL_SELECTOR = 'button,input:not([type="hidden"]),select,textarea,a[href],summary,[role="switch"],[role="button"],[role="checkbox"],[role="tab"]'

export async function measureSettings(page, cdp) {
  await page.keyboard.press('Tab')
  await page.locator(CONTROL_SELECTOR).evaluateAll(annotateSettingsControls)
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const ids = new Map()
  const visit = node => {
    const attributes = node.attributes ?? []
    const offset = attributes.indexOf('data-settings-smoke-control')
    if (offset >= 0) ids.set(node.backendNodeId, attributes[offset + 1])
    for (const child of node.children ?? []) visit(child)
    for (const child of node.shadowRoots ?? []) visit(child)
  }
  visit(root)
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  const accessibility = {}
  for (const node of nodes) {
    const id = ids.get(node.backendDOMNodeId)
    if (id === undefined || node.ignored) continue
    accessibility[id] = { name: node.name?.value ?? '', role: node.role?.value ?? '' }
  }
  return page.evaluate(({ selector, accessibility }) => {
    const rect = element => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
      return { x, y, width, height, right, bottom }
    }
    const clipFor = element => {
      const clip = { x: 0, y: 0, right: innerWidth, bottom: innerHeight }
      let viewportFixedRoot = null
      for (let candidate = element; candidate; candidate = candidate.parentElement) {
        if (getComputedStyle(candidate).position !== 'fixed') continue
        let containingBlock = null
        for (let ancestor = candidate.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor)
          const transformed = [style.transform, style.perspective, style.filter, style.backdropFilter]
            .some(value => value && value !== 'none')
          if (transformed || /layout|paint|strict|content/.test(style.contain)
            || /^(inline-size|size)$/.test(style.containerType)
            || /transform|perspective|filter/.test(style.willChange)) {
            containingBlock = ancestor
            break
          }
        }
        if (!containingBlock) viewportFixedRoot = candidate
        break
      }
      if (viewportFixedRoot === element) return clip
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = rect(parent)
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          clip.x = Math.max(clip.x, bounds.x)
          clip.right = Math.min(clip.right, bounds.right)
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          clip.y = Math.max(clip.y, bounds.y)
          clip.bottom = Math.min(clip.bottom, bounds.bottom)
        }
        // A viewport-fixed subtree escapes unrelated ancestor scroll clips.
        // Fixed descendants of a transformed/contained card do not escape it.
        if (parent === viewportFixedRoot) break
      }
      return clip
    }
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== 'hidden').at(-1)
    const elements = [...document.querySelectorAll(selector)]
      .filter(element => element.getAttribute('data-settings-smoke-rendered') === 'true'
        && (!dialog || dialog.contains(element)))
    const original = elements.map(rect)
    const originalVisible = elements.map((element, index) => {
      const clip = clipFor(element), box = original[index]
      return { x: Math.max(box.x, clip.x), y: Math.max(box.y, clip.y),
        right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom) }
    })
    const appUiScale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ds-ui-scale')) || 1
    const occurrences = new Map()
    const semanticKeys = elements.map(element => {
      const row = element.closest('.ds-setting-row')
      const card = element.closest('.ds-settings-card,section,[role="dialog"]')
      const panel = element.closest('[role="tabpanel"]')
      const compact = text => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 180)
      const context = compact(row?.firstElementChild?.textContent)
        || compact(card?.querySelector('h2,h3,legend')?.textContent)
        || compact(element.closest('nav')?.getAttribute('aria-label'))
      // Do not use generated React IDs, numeric DOM indices, or newly supplied
      // accessible labels: those change when an unrelated control is inserted.
      const detail = compact(element.textContent) || compact(element.getAttribute('placeholder'))
        || compact(element.getAttribute('title'))
      const key = [panel?.getAttribute('aria-labelledby') ?? '', context,
        element.tagName.toLowerCase(), element.getAttribute('type') ?? '', detail].join('|')
      const ordinal = (occurrences.get(key) ?? 0) + 1
      occurrences.set(key, ordinal)
      return `${key}|occurrence:${ordinal}`
    })
    const controls = elements.map((element, index) => {
      const id = element.getAttribute('data-settings-smoke-control')
      const disabled = element.matches(':disabled,[aria-disabled="true"]')
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      const box = rect(element)
      const point = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      const clipping = clipFor(element)
      const inside = box.x >= clipping.x - 1 && box.right <= clipping.right + 1
        && box.y >= clipping.y - 1 && box.bottom <= clipping.bottom + 1
      if (!disabled) element.focus({ preventScroll: true })
      const style = getComputedStyle(element)
      const focused = !disabled && document.activeElement === element
      const focusStyle = { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor, boxShadow: style.boxShadow }
      const transparent = value => value === 'transparent' || /rgba\([^)]*,\s*0\)/.test(value)
      const ownIndicator = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        && !transparent(style.outlineColor)) || (style.boxShadow !== 'none'
        && !/^((rgba\(0, 0, 0, 0\)|rgb\(0 0 0 \/ 0\)) 0px 0px 0px 0px,?\s*)+$/.test(style.boxShadow))
      const parentStyle = element.parentElement ? getComputedStyle(element.parentElement) : null
      const parentIndicator = parentStyle?.boxShadow && parentStyle.boxShadow !== 'none'
        && !parentStyle.boxShadow.includes('rgba(0, 0, 0, 0) 0px 0px 0px 0px')
      const classes = element.getAttribute('class') ?? ''
      const size = element.getAttribute('data-settings-size')
        || classes.match(/ds-settings-button--(default|compact|inline-icon|icon)(?:\s|$)/)?.[1]
      const declaredTargetHeight = size ? ({ default: 36, compact: 32, icon: 36, 'inline-icon': 32 })[size] : null
      const hittable = !!point && (element === point || element.contains(point))
      const coveringLayers = []
      if (!hittable && point) for (let ancestor = point; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor)
        if (style.position !== 'sticky' && style.position !== 'fixed') continue
        coveringLayers.push({ tag: ancestor.tagName, className: ancestor.className,
          position: style.position, zIndex: style.zIndex, bounds: rect(ancestor) })
      }
      return { id, semanticKey: semanticKeys[index], tag: element.tagName.toLowerCase(), type: element.getAttribute('type'),
        ...accessibility[id], text: element.textContent?.trim().slice(0, 120),
        className: element.getAttribute('class'), disabled,
        settingsSize: element.getAttribute('data-settings-size'),
        busy: element.getAttribute('aria-busy') === 'true',
        destructive: /danger|red-/.test(element.getAttribute('class') ?? ''),
        original: original[index], originalVisible: originalVisible[index], reached: box, clipping, inside,
        appUiScale, normalizedHeight: box.height / appUiScale, declaredTargetHeight,
        hittable, hitTarget: !hittable && point ? { tag: point.tagName,
          className: point.getAttribute('class'), text: point.textContent?.trim().slice(0, 120),
          bounds: rect(point), coveringLayers } : null,
        tabIndex: element.tabIndex, focused, focusVisible: element.matches(':focus-visible'),
        focusIndicator: !!(ownIndicator || parentIndicator), focusStyle,
        typography: { fontSize: style.fontSize, fontWeight: style.fontWeight,
          lineHeight: style.lineHeight, padding: style.padding, borderRadius: style.borderRadius }
      }
    })
    const overlaps = []
    for (let i = 0; i < elements.length; i++) for (let j = i + 1; j < elements.length; j++) {
      if (elements[i].contains(elements[j]) || elements[j].contains(elements[i])) continue
      const a = originalVisible[i], b = originalVisible[j]
      if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1) overlaps.push([controls[i].semanticKey, controls[j].semanticKey].sort())
    }
    const scroller = document.querySelector('.ds-settings-scroller')
    const scrollerOverflow = scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false
    const horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 1
    document.activeElement?.blur?.()
    for (const element of document.querySelectorAll('.ds-settings-scroller,nav,[role="tablist"]')) {
      element.scrollTo?.({ top: 0, left: 0, behavior: 'instant' })
    }
    return { dpr: devicePixelRatio, appUiScale,
      viewport: { width: innerWidth, height: innerHeight },
      surfaceBounds: rect(document.querySelector('.ds-settings-surface')),
      fixtureRootBounds: rect(document.getElementById('root')),
      horizontalOverflow, scrollerOverflow, controls, overlaps }
  }, { selector: CONTROL_SELECTOR, accessibility })
}

export function geometryProblems(measurement) {
  const problems = []
  if (measurement.horizontalOverflow) problems.push('document horizontal overflow')
  if (measurement.scrollerOverflow) problems.push('settings content horizontal overflow')
  for (const control of measurement.controls) {
    const label = control.semanticKey
    if (!control.name?.trim()) problems.push(`${label}: missing accessible name`)
    if (!control.inside) problems.push(`${label}: clipped after scrolling into view`)
    if (!control.disabled && !control.hittable) problems.push(`${label}: center is covered`)
    if (!control.disabled && !control.focused) problems.push(`${label}: cannot focus`)
    if (!control.disabled && control.focusVisible && !control.focusIndicator) {
      problems.push(`${label}: no measured keyboard focus indicator`)
    }
    if (control.tag === 'button' && control.reached.height < 24) {
      problems.push(`${label}: button height below 24 CSS px`)
    }
    if (control.declaredTargetHeight && control.normalizedHeight < control.declaredTargetHeight - 1) {
      problems.push(`${label}: button smaller than declared normalized design target`)
    }
  }
  for (const pair of measurement.overlaps) problems.push(`controls overlap: ${pair.join(', ')}`)
  return problems
}

export function newGeometryProblems(previousProblems, currentProblems) {
  const previous = new Map()
  for (const { key, problem } of previousProblems) {
    const signature = JSON.stringify([key, problem])
    previous.set(signature, (previous.get(signature) ?? 0) + 1)
  }
  return currentProblems.filter(({ key, problem }) => {
    const signature = JSON.stringify([key, problem]), remaining = previous.get(signature) ?? 0
    if (!remaining) return true
    previous.set(signature, remaining - 1)
    return false
  })
}

export function worsenedTargetSizes(previousLayouts, currentLayouts) {
  const previous = new Map(previousLayouts.map(layout => [layout.key, layout]))
  const findings = []
  for (const layout of currentLayouts) {
    const old = previous.get(layout.key)
    if (!old) continue
    const controls = new Map(old.controls.map(control => [control.semanticKey, control]))
    for (const control of layout.controls) {
      const before = controls.get(control.semanticKey)
      if (!before || control.tag !== 'button' || control.reached.height >= 24
        || control.reached.height >= before.reached.height - 1) continue
      findings.push({ key: layout.key, problem: `${control.semanticKey}: undersized target became smaller`,
        previousHeight: before.reached.height, currentHeight: control.reached.height })
    }
  }
  return findings
}

// The final polish closes these measured baseline defects, so they are hard
// requirements even when the old UI had the same issue. Other inherited
// findings remain in the complete baseline comparison and evidence report.
export function requiredPolishProblems(layouts) {
  return layouts.flatMap(layout => geometryProblems(layout)
    .filter(problem => /horizontal overflow|clipped after scrolling|button height below 24/.test(problem))
    .map(problem => ({ key: layout.key, problem })))
}
