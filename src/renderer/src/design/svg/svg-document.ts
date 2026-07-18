/** Keep renderer admission aligned with the structured SVG tool's UTF-8 byte cap. */
export const MAX_SVG_SOURCE_BYTES = 1_000_000
/** @deprecated Use MAX_SVG_SOURCE_BYTES; retained for source compatibility. */
export const MAX_SVG_SOURCE_CHARS = MAX_SVG_SOURCE_BYTES
export const MAX_SVG_ELEMENTS = 5_000
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'metadata',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  'lineargradient', 'radialgradient', 'stop', 'pattern',
  'clippath', 'mask', 'marker', 'symbol', 'use', 'image',
  'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
  'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'fedistantlight',
  'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
  'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology',
  'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile',
  'feturbulence',
  'animate', 'animatetransform', 'animatemotion', 'mpath', 'set', 'style'
])

const ANIMATION_ELEMENTS = new Set(['animate', 'animatetransform', 'animatemotion', 'set'])
const VISUAL_ELEMENTS = new Set([
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'use', 'image'
])
const NON_VISUAL_CONTAINERS = new Set([
  'defs', 'symbol', 'clippath', 'mask', 'marker', 'pattern', 'filter'
])
const SAFE_ANIMATED_ATTRIBUTES = new Set([
  'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'width', 'height', 'opacity', 'fill', 'fill-opacity', 'stroke',
  'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'transform', 'd', 'points', 'pathlength', 'offset', 'stop-color', 'stop-opacity'
])

export type SvgDiagnostic = {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export type SanitizedSvgDocument = {
  ok: true
  svg: string
  diagnostics: SvgDiagnostic[]
  animationCount: number
  visualElementCount: number
  durationMs: number
  loopsIndefinitely: boolean
  viewBox?: string
}

export type InvalidSvgDocument = {
  ok: false
  diagnostics: SvgDiagnostic[]
}

export type SvgDocumentResult = SanitizedSvgDocument | InvalidSvgDocument

export type SvgAnimationTiming = {
  endMs: number
  mayContinue: boolean
  cycleMs: number
}

function diagnostic(
  severity: SvgDiagnostic['severity'],
  code: string,
  message: string
): SvgDiagnostic {
  return { severity, code, message }
}

/** Parse the static subset of SVG/SMIL clock values used for timeline controls. */
function durationMs(value: string | null): number | null {
  const text = value?.trim().toLowerCase() ?? ''
  if (!text) return null
  const ms = /^([\d.]+)ms$/.exec(text)
  if (ms) {
    const value = Number(ms[1])
    return Number.isFinite(value) ? value : null
  }
  const seconds = /^([\d.]+)s$/.exec(text)
  if (seconds) {
    const value = Number(seconds[1]) * 1000
    return Number.isFinite(value) ? value : null
  }
  const minutes = /^([\d.]+)min$/.exec(text)
  if (minutes) {
    const value = Number(minutes[1]) * 60_000
    return Number.isFinite(value) ? value : null
  }
  const hours = /^([\d.]+)h$/.exec(text)
  if (hours) {
    const value = Number(hours[1]) * 3_600_000
    return Number.isFinite(value) ? value : null
  }
  const clock = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text)
  if (clock) {
    const value = (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000
    return Number.isFinite(value) ? value : null
  }
  const partialClock = /^(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(text)
  if (partialClock) {
    const value = (Number(partialClock[1]) * 60 + Number(partialClock[2])) * 1000
    return Number.isFinite(value) && Number(partialClock[2]) < 60 ? value : null
  }
  return null
}

export function svgAnimationTiming(attributes: {
  dur?: string | null
  begin?: string | null
  repeatCount?: string | null
  repeatDur?: string | null
}): SvgAnimationTiming {
  const durationText = attributes.dur?.trim().toLowerCase() ?? ''
  const simpleDuration = durationMs(durationText)
  const cycleMs = Math.max(0, simpleDuration ?? 0)
  const beginText = attributes.begin?.trim() ?? ''
  const beginEntries = beginText ? beginText.split(';').map((entry) => entry.trim()).filter(Boolean) : ['0s']
  const beginTimes = beginEntries.map((entry) => durationMs(entry))
  // Syncbase/event begins cannot be resolved without running the SVG. Never
  // hard-stop the whiteboard clock based on an invented one-second duration.
  const dynamicBegin = beginTimes.some((value) => value === null)
  if (durationText === 'indefinite' || dynamicBegin) return { endMs: 0, mayContinue: true, cycleMs }

  const repeatDurationText = attributes.repeatDur?.trim().toLowerCase() ?? ''
  const repeatDuration = repeatDurationText === 'indefinite' ? Infinity : durationMs(repeatDurationText)
  const repeatText = attributes.repeatCount?.trim().toLowerCase() ?? ''
  // repeatDur itself is a repetition request; SVG's common `dur="1s"
  // repeatDur="10s" form repeats for ten seconds even without repeatCount.
  const repeatCount = repeatText === 'indefinite'
    ? Infinity
    : repeatText
      ? Number(repeatText)
      : repeatDuration === null ? 1 : Infinity
  const simple = simpleDuration ?? 0
  const repeated = Number.isFinite(repeatCount) && repeatCount > 0 ? simple * repeatCount : Infinity
  const activeDuration = repeatDuration === null ? repeated : Math.min(repeated, repeatDuration)
  if (!Number.isFinite(activeDuration)) return { endMs: 0, mayContinue: true, cycleMs }
  const lastBegin = Math.max(0, ...beginTimes.map((value) => Math.max(0, value ?? 0)))
  return { endMs: lastBegin + activeDuration, mayContinue: false, cycleMs }
}

export function summarizeSvgAnimationTiming(timing: readonly SvgAnimationTiming[]): {
  durationMs: number
  loopsIndefinitely: boolean
} {
  const loopsIndefinitely = timing.some((item) => item.mayContinue)
  const maxDuration = timing.reduce((max, item) => Math.max(max, item.endMs), 0)
  // An indefinitely repeating SMIL element has no finite end time, but its
  // simple `dur` is still the useful representative cycle for scrubbing. Keep
  // the longest detected cycle instead of collapsing every loop to 1000 ms.
  const maxCycleDuration = timing.reduce((max, item) => Math.max(max, item.cycleMs), 0)
  return {
    durationMs: timing.length > 0 ? Math.max(1, maxDuration, maxCycleDuration || 1000) : 4000,
    loopsIndefinitely
  }
}

function animationTiming(element: Element): SvgAnimationTiming {
  return svgAnimationTiming({
    dur: element.getAttribute('dur'),
    begin: element.getAttribute('begin'),
    repeatCount: element.getAttribute('repeatCount'),
    repeatDur: element.getAttribute('repeatDur')
  })
}

export function validSvgRootNamespace(
  namespaceUri: string | null,
  prefix: string | null,
  declaredNamespace: string | null
): boolean {
  // srcDoc is subsequently parsed as HTML. Prefixed SVG element names (for
  // example <s:svg>) are not reliably promoted into SVG elements there, so the
  // renderer accepts only the standalone unprefixed form it can preserve.
  if (prefix) return false
  if (declaredNamespace && declaredNamespace !== SVG_NAMESPACE) return false
  if (namespaceUri === SVG_NAMESPACE) return true
  // A plain, unprefixed <svg> without xmlns is repairable by adding the
  // standalone namespace before serialization. A prefixed/wrong-namespace root
  // is not: changing its default xmlns attribute does not change namespaceURI.
  return namespaceUri === null && !prefix
}

export function isVisualSvgElement(tagName: string, ancestorTagNames: readonly string[]): boolean {
  return VISUAL_ELEMENTS.has(tagName.toLowerCase()) &&
    !ancestorTagNames.some((tag) => NON_VISUAL_CONTAINERS.has(tag.toLowerCase()))
}

function countVisualElements(root: Element): number {
  return Array.from(root.querySelectorAll('*')).filter((element) => {
    const ancestors: string[] = []
    let parent = element.parentElement
    while (parent && parent !== root) {
      ancestors.push(parent.localName)
      parent = parent.parentElement
    }
    return isVisualSvgElement(element.localName, ancestors) && !isExplicitlyHiddenSvgElement(element, root)
  }).length
}

function isExplicitlyHiddenSvgElement(element: Element, root: Element): boolean {
  let current: Element | null = element
  while (current) {
    const display = current.getAttribute('display')?.trim().toLowerCase()
    const visibility = current.getAttribute('visibility')?.trim().toLowerCase()
    const opacity = Number(current.getAttribute('opacity'))
    const style = current.getAttribute('style')?.replace(/\s+/g, '').toLowerCase() ?? ''
    if (
      display === 'none' ||
      visibility === 'hidden' ||
      visibility === 'collapse' ||
      (current.hasAttribute('opacity') && Number.isFinite(opacity) && opacity <= 0) ||
      /(?:^|;)display:none(?:;|$)|(?:^|;)visibility:(?:hidden|collapse)(?:;|$)|(?:^|;)opacity:(?:0(?:\.0+)?|0%)(?:;|$)/.test(style)
    ) return true
    if (current === root) break
    current = current.parentElement
  }
  return false
}

function validViewBox(value: string): boolean {
  const numbers = value.trim().split(/[\s,]+/).map(Number)
  return numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0
}

function localFragmentReference(value: string): boolean {
  const normalized = value.trim()
  return normalized.startsWith('#') && /^#[A-Za-z_][\w:.-]*$/.test(normalized)
}

function safeDataImage(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value.trim())
}

function hasUnsafeCss(value: string): boolean {
  if (/@import|javascript\s*:|(?:https?|file|ftp)\s*:|expression\s*\(|behavior\s*:|-moz-binding/i.test(value)) return true
  const urls = value.match(/url\(([^)]+)\)/gi) ?? []
  return urls.some((entry) => {
    const target = entry.slice(entry.indexOf('(') + 1, -1).trim().replace(/^['"]|['"]$/g, '')
    return !localFragmentReference(target) && !safeDataImage(target)
  })
}

function sanitizeElementAttributes(element: Element, diagnostics: SvgDiagnostic[]): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()
    const value = attribute.value
    if (name.startsWith('on')) {
      element.removeAttribute(attribute.name)
      diagnostics.push(diagnostic('warning', 'event-handler-removed', `Removed unsafe ${attribute.name} attribute.`))
      continue
    }
    if (name === 'href' || name === 'xlink:href' || name === 'src') {
      if (!localFragmentReference(value) && !safeDataImage(value)) {
        element.removeAttribute(attribute.name)
        diagnostics.push(diagnostic('warning', 'external-reference-removed', `Removed external reference from ${attribute.name}.`))
      }
      continue
    }
    if ((name === 'style' || value.includes('url(')) && hasUnsafeCss(value)) {
      element.removeAttribute(attribute.name)
      diagnostics.push(diagnostic('warning', 'unsafe-css-removed', `Removed unsafe CSS from ${attribute.name}.`))
    }
  }
  const tag = element.localName.toLowerCase()
  if (ANIMATION_ELEMENTS.has(tag)) {
    const attributeName = element.getAttribute('attributeName')?.trim().toLowerCase()
    if (attributeName && !SAFE_ANIMATED_ATTRIBUTES.has(attributeName)) {
      element.remove()
      diagnostics.push(diagnostic('warning', 'unsafe-animation-removed', `Removed animation of ${attributeName}.`))
    }
  }
  if (tag === 'style' && hasUnsafeCss(element.textContent ?? '')) {
    element.remove()
    diagnostics.push(diagnostic('warning', 'unsafe-style-block-removed', 'Removed a style block with external or executable CSS.'))
  }
}

export function parseAndSanitizeSvgDocument(raw: string): SvgDocumentResult {
  const diagnostics: SvgDiagnostic[] = []
  if (new TextEncoder().encode(raw).byteLength > MAX_SVG_SOURCE_BYTES) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'source-too-large', `SVG exceeds ${MAX_SVG_SOURCE_BYTES} bytes.`)]
    }
  }
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'dom-parser-unavailable', 'SVG parsing is unavailable in this renderer.')]
    }
  }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet\b/i.test(raw)) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'unsafe-xml-declaration', 'DOCTYPE, ENTITY, and xml-stylesheet declarations are not allowed in SVG artifacts.')]
    }
  }
  const document = new DOMParser().parseFromString(raw, 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement.localName.toLowerCase() !== 'svg') {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'invalid-svg', 'The file is not a valid standalone SVG document.')]
    }
  }
  const root = document.documentElement
  const namespace = root.getAttribute('xmlns')
  if (!validSvgRootNamespace(root.namespaceURI, root.prefix, namespace)) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'invalid-namespace', 'SVG root uses an invalid XML namespace.')]
    }
  }
  const all = Array.from(root.querySelectorAll('*'))
  if (all.length + 1 > MAX_SVG_ELEMENTS) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'too-many-elements', `SVG contains more than ${MAX_SVG_ELEMENTS} elements.`)]
    }
  }
  const elements = [root, ...all]
  if (elements.some((element) => element.prefix)) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'prefixed-svg-element', 'SVG artifact elements must not use XML namespace prefixes.')]
    }
  }
  for (const element of elements.reverse()) {
    const tag = element.localName.toLowerCase()
    if (!ALLOWED_ELEMENTS.has(tag)) {
      element.remove()
      diagnostics.push(diagnostic('warning', 'element-removed', `Removed unsupported <${tag}> element.`))
      continue
    }
    sanitizeElementAttributes(element, diagnostics)
  }
  if (!namespace) root.setAttribute('xmlns', SVG_NAMESPACE)
  const viewBox = root.getAttribute('viewBox')
  if (!viewBox) {
    diagnostics.push(diagnostic('warning', 'missing-viewbox', 'SVG should define a viewBox for responsive scaling.'))
  } else if (!validViewBox(viewBox)) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'invalid-viewbox', 'SVG viewBox must contain four finite numbers with positive width and height.')]
    }
  }
  if (!root.querySelector('title')) diagnostics.push(diagnostic('warning', 'missing-title', 'SVG has no accessible <title>.'))
  if (!root.querySelector('desc')) diagnostics.push(diagnostic('warning', 'missing-description', 'SVG has no accessible <desc>.'))

  const ids = new Set<string>()
  for (const element of [root, ...Array.from(root.querySelectorAll('[id]'))]) {
    const id = element.getAttribute('id')?.trim()
    if (!id) continue
    if (!/^[A-Za-z_][\w:.-]*$/.test(id)) {
      element.removeAttribute('id')
      diagnostics.push(diagnostic('warning', 'invalid-id-removed', `Removed invalid SVG id "${id}".`))
    } else if (ids.has(id)) {
      element.removeAttribute('id')
      diagnostics.push(diagnostic('warning', 'duplicate-id-removed', `Removed duplicate SVG id "${id}".`))
    } else {
      ids.add(id)
    }
  }

  const animations = Array.from(root.querySelectorAll('animate, animateTransform, animateMotion, set'))
  const visualElementCount = countVisualElements(root)
  const timing = animations.map(animationTiming)
  // `loopsIndefinitely` also includes event/syncbase starts whose end cannot
  // be computed statically. Keeping the clock monotonic is safer than freezing
  // a valid interactive animation after a guessed finite duration.
  const animationSummary = summarizeSvgAnimationTiming(timing)
  root.setAttribute('width', '100%')
  root.setAttribute('height', '100%')
  root.setAttribute('preserveAspectRatio', root.getAttribute('preserveAspectRatio') || 'xMidYMid meet')
  return {
    ok: true,
    svg: new XMLSerializer().serializeToString(root),
    diagnostics,
    animationCount: animations.length,
    visualElementCount,
    durationMs: animationSummary.durationMs,
    loopsIndefinitely: animationSummary.loopsIndefinitely,
    ...(viewBox ? { viewBox } : {})
  }
}

export function buildSvgPreviewDocument(svg: string, background: 'transparent' | 'light' | 'dark'): string {
  const backgroundCss = background === 'light'
    ? '#ffffff'
    : background === 'dark'
      ? '#111827'
      : 'repeating-conic-gradient(#e5e7eb 0 25%, #ffffff 0 50%) 0 / 20px 20px'
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none';"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:grid;place-items:center;background:${backgroundCss}}svg{display:block;max-width:100%;max-height:100%}</style></head><body>${svg}</body></html>`
}
