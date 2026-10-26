/**
 * Component-level picking inside an HTML design frame.
 *
 * The webview guest script only reports what the pointer hit and its bounded
 * ancestor chain. Deciding which node counts as "the component" happens here so
 * the semantics stay unit-testable without a DOM: a click on an icon inside a
 * button must resolve to the button, while a plain paragraph stays a paragraph.
 */

export const HTML_ELEMENT_PICK_MAX_CHAIN = 10
export const HTML_ELEMENT_PICK_MAX_TEXT = 300
export const HTML_ELEMENT_PICK_MAX_HTML = 1200
const MAX_ANCESTORS = 6
// Containers this large are page scaffolding, not a component the user meant.
const OVERSIZED_CONTAINER_RATIO = 0.9

export type HtmlElementPickRect = {
  left: number
  top: number
  width: number
  height: number
}

export type HtmlElementPickCandidate = {
  tagName: string
  selector: string
  selectorIsUnique: boolean
  rect: HtmlElementPickRect
  text: string
  html: string
  /** The element's own text can be rewritten without destroying child markup. */
  editableText: boolean
  componentName?: string
  sourceId?: string
  role?: string
  ariaLabel?: string
}

export type HtmlElementPickChain = {
  hitTagName: string
  viewportWidth: number
  viewportHeight: number
  chain: HtmlElementPickCandidate[]
}

export type HtmlElementPickSelection = {
  element: HtmlElementPickCandidate
  /** Outer-to-inner is derived when rendering the path; this list is inner-to-outer. */
  ancestors: HtmlElementPickCandidate[]
  hit: HtmlElementPickCandidate
}

const COMPONENT_TAGS = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
  'details'
])

const COMPONENT_ROLES = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'checkbox',
  'radio',
  'switch',
  'option',
  'combobox',
  'searchbox',
  'textbox'
])

const TAG_LABELS: Record<string, string> = {
  a: 'Link',
  button: 'Button',
  details: 'Disclosure',
  input: 'Input',
  label: 'Label',
  li: 'List item',
  p: 'Text',
  select: 'Select',
  span: 'Text',
  summary: 'Disclosure',
  textarea: 'Textarea'
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, maxLength) : undefined
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cleanRect(value: unknown): HtmlElementPickRect | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const left = cleanNumber(raw.left)
  const top = cleanNumber(raw.top)
  const width = cleanNumber(raw.width)
  const height = cleanNumber(raw.height)
  if (left === undefined || top === undefined || width === undefined || height === undefined) {
    return undefined
  }
  if (width < 0 || height < 0) return undefined
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height)
  }
}

function normalizeCandidate(raw: unknown): HtmlElementPickCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const tagName = cleanString(obj.tagName, 48)?.toLowerCase()
  const selector = typeof obj.selector === 'string' && obj.selector.length <= 2000
    ? obj.selector : undefined
  const rect = cleanRect(obj.rect)
  if (!tagName || !selector || !rect) return null
  return {
    tagName,
    selector,
    selectorIsUnique: obj.selectorIsUnique === true,
    rect,
    text: cleanString(obj.text, HTML_ELEMENT_PICK_MAX_TEXT) ?? '',
    html: typeof obj.html === 'string' ? obj.html.slice(0, HTML_ELEMENT_PICK_MAX_HTML) : '',
    editableText: obj.editableText === true,
    ...(cleanString(obj.componentName, 80) ? { componentName: cleanString(obj.componentName, 80) } : {}),
    ...(cleanString(obj.sourceId, 200) ? { sourceId: cleanString(obj.sourceId, 200) } : {}),
    ...(cleanString(obj.role, 40) ? { role: cleanString(obj.role, 40) } : {}),
    ...(cleanString(obj.ariaLabel, 120) ? { ariaLabel: cleanString(obj.ariaLabel, 120) } : {})
  }
}

/**
 * Validate the guest payload. Returns null when the webview could not resolve a
 * usable element, so callers show a "pick again" message instead of a ghost box.
 */
export function normalizeHtmlElementPickResult(raw: unknown): HtmlElementPickChain | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.chain)) return null
  const chain = obj.chain
    .slice(0, HTML_ELEMENT_PICK_MAX_CHAIN)
    .map((entry) => normalizeCandidate(entry))
    .filter((entry): entry is HtmlElementPickCandidate => Boolean(entry))
  if (chain.length === 0) return null
  const viewportWidth = cleanNumber(obj.viewportWidth)
  const viewportHeight = cleanNumber(obj.viewportHeight)
  return {
    hitTagName: cleanString(obj.hitTagName, 48)?.toLowerCase() ?? chain[0].tagName,
    viewportWidth: viewportWidth && viewportWidth > 0 ? viewportWidth : 0,
    viewportHeight: viewportHeight && viewportHeight > 0 ? viewportHeight : 0,
    chain
  }
}

export function htmlElementCandidateIsComponentLike(candidate: HtmlElementPickCandidate): boolean {
  if (candidate.componentName || candidate.sourceId) return true
  if (candidate.role && COMPONENT_ROLES.has(candidate.role.toLowerCase())) return true
  return COMPONENT_TAGS.has(candidate.tagName)
}

const LAYOUT_CONTAINER_TAGS = new Set(['div', 'section', 'main', 'article', 'form', 'body', 'html'])

function isOversizedContainer(candidate: HtmlElementPickCandidate, chain: HtmlElementPickChain): boolean {
  if (chain.viewportWidth <= 0 || chain.viewportHeight <= 0) return false
  if (!LAYOUT_CONTAINER_TAGS.has(candidate.tagName)) return false
  const area = candidate.rect.width * candidate.rect.height
  return area >= chain.viewportWidth * chain.viewportHeight * OVERSIZED_CONTAINER_RATIO
}

function isUsableAncestor(candidate: HtmlElementPickCandidate): boolean {
  if (candidate.tagName === 'html' || candidate.tagName === 'body') return false
  return candidate.rect.width >= 4 && candidate.rect.height >= 4
}

/**
 * Resolve the component root for a hit chain (index 0 = the pointer hit).
 * A click on `svg` inside `button` therefore selects the button.
 */
export function resolveHtmlElementPickSelection(
  chain: HtmlElementPickChain
): HtmlElementPickSelection | null {
  const hit = chain.chain[0]
  if (!hit) return null
  let elementIndex = 0
  for (let index = 0; index < chain.chain.length; index += 1) {
    const candidate = chain.chain[index]
    if (!htmlElementCandidateIsComponentLike(candidate)) continue
    if (isOversizedContainer(candidate, chain)) continue
    elementIndex = index
    break
  }
  const element = chain.chain[elementIndex]
  const ancestors = chain.chain
    .slice(elementIndex + 1)
    .filter((candidate) => isUsableAncestor(candidate) && !isOversizedContainer(candidate, chain))
    .slice(0, MAX_ANCESTORS)
  return { element, ancestors, hit }
}

/** Selection rooted at `chain[index]`, ancestors being the usable nodes above it. */
export function htmlElementSelectionFromChainIndex(
  chain: HtmlElementPickChain,
  index: number
): HtmlElementPickSelection | null {
  const element = chain.chain[index]
  if (!element) return null
  return {
    element,
    hit: chain.chain[0],
    ancestors: chain.chain
      .slice(index + 1)
      .filter((candidate) => isUsableAncestor(candidate) && !isOversizedContainer(candidate, chain))
      .slice(0, MAX_ANCESTORS)
  }
}

/** The clicked node differs from the resolved component: offer "select inner element". */
export function htmlElementSelectionCanDrillToHit(selection: HtmlElementPickSelection): boolean {
  return selection.hit.selector !== selection.element.selector
}

type SemanticSource = Pick<HtmlElementPickCandidate, 'tagName' | 'componentName' | 'role'>

/** Shared by pick candidates and element-map boxes so both label alike. */
export function semanticNameOf(candidate: SemanticSource): string {
  return semanticName(candidate)
}

function semanticName(candidate: SemanticSource): string {
  if (candidate.componentName) return candidate.componentName
  const role = candidate.role?.toLowerCase()
  if (role && COMPONENT_ROLES.has(role)) {
    if (role === 'button') return 'Button'
    if (role === 'link') return 'Link'
    return role.charAt(0).toUpperCase() + role.slice(1)
  }
  if (candidate.tagName === 'input') return 'Input'
  const tagLabel = TAG_LABELS[candidate.tagName]
  if (tagLabel) return tagLabel
  return candidate.tagName.charAt(0).toUpperCase() + candidate.tagName.slice(1)
}

function shortText(candidate: HtmlElementPickCandidate): string {
  if (candidate.ariaLabel) return candidate.ariaLabel
  return candidate.text
}

/** Human label such as `Button · 接管`, used by the pick bar and composer chip. */
export function htmlElementCandidateLabel(candidate: HtmlElementPickCandidate): string {
  const name = semanticName(candidate)
  const text = shortText(candidate)
  return text ? `${name} · ${text.slice(0, 28)}` : name
}

/**
 * Short location path, e.g. `Page / Card / Button`. Ancestors arrive inner-to-
 * outer, so they are reversed and long chains collapse in the middle.
 */
export function htmlElementPickPathLabels(selection: HtmlElementPickSelection): string[] {
  const upward = [selection.element, ...selection.ancestors].map((candidate) => semanticName(candidate))
  const outward = upward.reverse()
  if (outward.length <= 3) return outward
  return [outward[0], '…', ...outward.slice(-2)]
}

export function buildSerializerSource(): string {
  // Runs inside the webview guest. Keep it dependency-free and defensive: any
  // throw becomes a null result so the host shows "pick again".
  return `
  const SENSITIVE = 'input[type="password"],input[type="hidden"],[data-kun-sensitive]';
  const escapeCss = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  };
  const isUnique = (selector) => {
    try { return Boolean(selector) && document.querySelectorAll(selector).length === 1 } catch { return false }
  };
  const structuralSelector = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      if (current === document.body) { parts.unshift('body'); break }
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + index + ')');
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const selectorFor = (element) => {
    const sourceId = element.getAttribute('data-kun-source-id');
    if (sourceId) {
      const selector = '[data-kun-source-id="' + escapeCss(sourceId) + '"]';
      if (isUnique(selector)) return { selector, unique: true };
    }
    if (element.id) {
      const selector = '#' + escapeCss(element.id);
      if (isUnique(selector)) return { selector, unique: true };
    }
    const selector = structuralSelector(element);
    return { selector, unique: isUnique(selector) };
  };
  const textFor = (element) => (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
  const serialize = (element) => {
    const rect = element.getBoundingClientRect();
    const selectorInfo = selectorFor(element);
    const clone = element.cloneNode(true);
    clone.querySelectorAll(SENSITIVE + ',script,style,[hidden]').forEach((node) => node.remove());
    [clone, ...clone.querySelectorAll('input,textarea,select,option')].forEach((node) => {
      node.removeAttribute('value');
      if (['TEXTAREA', 'SELECT', 'OPTION'].includes(node.tagName)) node.textContent = '';
      node.removeAttribute('checked');
      node.removeAttribute('selected');
    });
    const text = textFor(clone);
    return {
      tagName: element.tagName.toLowerCase(),
      selector: selectorInfo.selector,
      selectorIsUnique: selectorInfo.unique,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      text,
      html: clone.outerHTML.slice(0, 1200),
      editableText: element.children.length === 0 && text.length > 0 && !element.matches('input,textarea,select,option'),
      componentName: element.getAttribute('data-kun-component') || element.getAttribute('data-component') || '',
      sourceId: element.getAttribute('data-kun-source-id') || '',
      role: element.getAttribute('role') || '',
      ariaLabel: element.getAttribute('aria-label') || ''
    };
  };
  const chainFrom = (element) => {
    const chain = [];
    let current = element;
    let guard = 0;
    while (current && current.nodeType === 1 && guard < 10) {
      if (current === document.body || current === document.documentElement) break;
      chain.push(serialize(current));
      current = current.parentElement;
      guard += 1;
    }
    return chain;
  };
  `
}

export function buildHtmlElementPickScript(point: { x: number; y: number }): string {
  const x = Number.isFinite(point.x) ? Math.max(0, Math.round(point.x)) : 0
  const y = Number.isFinite(point.y) ? Math.max(0, Math.round(point.y)) : 0
  return `(() => {
  try {
    ${buildSerializerSource()}
    const hit = document.elementFromPoint(${x}, ${y});
    if (!hit || hit === document.documentElement || hit === document.body) {
      return { ok: false, reason: 'empty' };
    }
    if (hit.closest(SENSITIVE)) return { ok: false, reason: 'sensitive' };
    const chain = chainFrom(hit);
    if (!chain.length) return { ok: false, reason: 'empty' };
    return {
      ok: true,
      hitTagName: hit.tagName.toLowerCase(),
      viewportWidth: Math.round(window.innerWidth),
      viewportHeight: Math.round(window.innerHeight),
      chain
    };
  } catch (error) {
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
})()`
}

/**
 * Pick the element a map box stands for. The guest keeps the elements of its
 * last report, so a token mismatch means the page changed since the hover and
 * the caller falls back to a point pick.
 */
export function buildHtmlElementBoxPickScript(boxId: number, token: number): string {
  const id = Math.max(0, Math.trunc(boxId))
  return `(() => {
  try {
    ${buildSerializerSource()}
    const state = window.__kunPickMap;
    if (!state || state.token !== ${Math.trunc(token)}) return { ok: false, reason: 'stale' };
    const element = state.els[${id}];
    if (!element || !element.isConnected) return { ok: false, reason: 'stale' };
    if (element.closest(SENSITIVE)) return { ok: false, reason: 'sensitive' };
    return {
      ok: true,
      hitTagName: element.tagName.toLowerCase(),
      viewportWidth: Math.round(window.innerWidth),
      viewportHeight: Math.round(window.innerHeight),
      chain: [serialize(element), ...chainFrom(element.parentElement).slice(0, 9)]
    };
  } catch (error) {
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
})()`
}

/**
 * Re-resolve a previously captured selector after a preview reload. Returns the
 * matched element as chain[0]; the host compares identity and marks the
 * selection stale when the element is gone.
 */
export function buildHtmlElementResolveScript(selector: string): string {
  const literal = JSON.stringify(selector)
  return `(() => {
  try {
    ${buildSerializerSource()}
    const matches = document.querySelectorAll(${literal});
    if (matches.length !== 1) return { ok: false, reason: 'ambiguous' };
    const element = matches[0];
    if (!element || element === document.documentElement || element === document.body) {
      return { ok: false, reason: 'missing' };
    }
    if (element.closest(SENSITIVE)) return { ok: false, reason: 'sensitive' };
    return {
      ok: true,
      hitTagName: element.tagName.toLowerCase(),
      viewportWidth: Math.round(window.innerWidth),
      viewportHeight: Math.round(window.innerHeight),
      chain: [serialize(element), ...chainFrom(element.parentElement).slice(0, 9)]
    };
  } catch (error) {
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
})()`
}

/** The reloaded element still answers to the captured identity. */
export function htmlElementPickResolvedStillMatches(
  previous: HtmlElementPickCandidate,
  resolved: HtmlElementPickChain
): boolean {
  if (!resolved.chain.length) return false
  const next = resolved.chain[0]
  if (!next) return false
  if (next.tagName !== previous.tagName) return false
  if (next.selector !== previous.selector) return false
  if (!next.selectorIsUnique) return false
  if (next.sourceId !== previous.sourceId) return false
  // A structural path can resolve to a different sibling after a reload.
  // Require unchanged content when there is no unique id-based anchor.
  if (!previous.selector.startsWith('#') && !previous.selector.startsWith('[data-kun-source-id=')) {
    if (next.html !== previous.html || next.text !== previous.text) return false
  }
  return next.rect.width > 0 && next.rect.height > 0
}
