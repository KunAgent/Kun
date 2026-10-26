/**
 * Local element map for hover/selection inside an HTML design frame.
 *
 * The webview guest walks the page once and reports a compact table of
 * "meaningful" boxes. Hover then hit-tests that table in the renderer, so moving
 * the pointer costs no webview round trip. The guest only re-reports when the
 * page changed (mutation, resize, scroll, animation end).
 */
import { semanticNameOf } from './html-element-pick'

export const HTML_ELEMENT_MAP_MAX_BOXES = 4000
const MAX_TEXT = 28
const SAME_RECT_TOLERANCE = 2

export type HtmlElementBox = {
  id: number
  /** Nearest kept ancestor, or -1 for a root box. */
  parent: number
  depth: number
  x: number
  y: number
  w: number
  h: number
  tagName: string
  componentName?: string
  role?: string
  text: string
  /** Interactive or named component: wins over generic containers. */
  strong: boolean
  /** Page scaffolding (covers most of the viewport): only reachable by going up. */
  shell: boolean
  /** padding top/right/bottom/left in CSS px */
  pad: [number, number, number, number]
}

export type HtmlElementMap = {
  token: number
  viewportWidth: number
  viewportHeight: number
  boxes: HtmlElementBox[]
}

export type HtmlElementMapModifiers = {
  /** Ignore the shell filter and prefer the deepest box. */
  deep?: boolean
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeBox(raw: unknown, index: number): HtmlElementBox | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const w = num(obj.w)
  const h = num(obj.h)
  const tagName = typeof obj.tagName === 'string' ? obj.tagName.toLowerCase().slice(0, 48) : ''
  if (!tagName || w <= 0 || h <= 0) return null
  const pad = Array.isArray(obj.pad) ? obj.pad : []
  return {
    id: index,
    parent: Math.trunc(num(obj.parent, -1)),
    depth: Math.max(0, Math.trunc(num(obj.depth))),
    x: num(obj.x),
    y: num(obj.y),
    w,
    h,
    tagName,
    ...(typeof obj.componentName === 'string' && obj.componentName
      ? { componentName: obj.componentName.slice(0, 80) } : {}),
    ...(typeof obj.role === 'string' && obj.role ? { role: obj.role.slice(0, 40) } : {}),
    text: typeof obj.text === 'string' ? obj.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '',
    strong: obj.strong === true,
    shell: obj.shell === true,
    pad: [num(pad[0]), num(pad[1]), num(pad[2]), num(pad[3])]
  }
}

/**
 * Validate the guest payload. `null` means "no usable map"; `unchanged` means
 * the guest's page did not change since the previous report.
 */
export function normalizeHtmlElementMap(
  raw: unknown
): HtmlElementMap | 'unchanged' | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.ok !== true) return null
  if (obj.unchanged === true) return 'unchanged'
  if (!Array.isArray(obj.boxes)) return null
  const boxes: HtmlElementBox[] = []
  for (const entry of obj.boxes.slice(0, HTML_ELEMENT_MAP_MAX_BOXES)) {
    // Ids are positions in the guest array, so an invalid entry keeps its slot.
    boxes.push(normalizeBox(entry, boxes.length) ?? {
      id: boxes.length, parent: -1, depth: 0, x: 0, y: 0, w: 0, h: 0,
      tagName: 'div', text: '', strong: false, shell: false, pad: [0, 0, 0, 0]
    })
  }
  return {
    token: Math.trunc(num(obj.token)),
    viewportWidth: Math.max(0, num(obj.viewportWidth)),
    viewportHeight: Math.max(0, num(obj.viewportHeight)),
    boxes
  }
}

function contains(box: HtmlElementBox, x: number, y: number): boolean {
  return box.w > 0 && box.h > 0 && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
}

/**
 * The smallest meaningful box under the point: deepest wins, a smaller area
 * breaks ties, a later (painted-on-top) box breaks equal areas. Shell boxes are
 * only returned when nothing else is under the point.
 */
export function hitTestHtmlElementMap(
  map: HtmlElementMap,
  point: { x: number; y: number },
  options: HtmlElementMapModifiers = {}
): HtmlElementBox | null {
  let best: HtmlElementBox | null = null
  let bestShell: HtmlElementBox | null = null
  for (const box of map.boxes) {
    if (!contains(box, point.x, point.y)) continue
    if (box.shell && !options.deep) {
      if (!bestShell || box.depth >= bestShell.depth) bestShell = box
      continue
    }
    if (!best) { best = box; continue }
    if (box.depth > best.depth) { best = box; continue }
    if (box.depth === best.depth && box.w * box.h <= best.w * best.h) best = box
  }
  return best ?? bestShell
}

/** Every box under the point, innermost first (the right-click layer list). */
export function htmlElementMapLayersAt(
  map: HtmlElementMap,
  point: { x: number; y: number }
): HtmlElementBox[] {
  const inner = hitTestHtmlElementMap(map, point, { deep: true })
  return inner ? htmlElementMapChain(map, inner.id) : []
}

/** The box and its ancestors, innermost first. */
export function htmlElementMapChain(map: HtmlElementMap, id: number): HtmlElementBox[] {
  const chain: HtmlElementBox[] = []
  const seen = new Set<number>()
  let current: HtmlElementBox | undefined = map.boxes[id]
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    current = current.parent >= 0 ? map.boxes[current.parent] : undefined
  }
  return chain
}

export function htmlElementMapParent(map: HtmlElementMap, id: number): HtmlElementBox | null {
  const box = map.boxes[id]
  if (!box || box.parent < 0) return null
  return map.boxes[box.parent] ?? null
}

/** First child in document order, or null for a leaf. */
export function htmlElementMapFirstChild(map: HtmlElementMap, id: number): HtmlElementBox | null {
  return map.boxes.find((box) => box.parent === id) ?? null
}

/** Next/previous sibling under the same parent (wraps around). */
export function htmlElementMapSibling(
  map: HtmlElementMap,
  id: number,
  step: 1 | -1
): HtmlElementBox | null {
  const box = map.boxes[id]
  if (!box) return null
  const siblings = map.boxes.filter((entry) => entry.parent === box.parent)
  if (siblings.length < 2) return null
  const index = siblings.findIndex((entry) => entry.id === id)
  return siblings[(index + step + siblings.length) % siblings.length] ?? null
}

export function htmlElementBoxLabel(box: HtmlElementBox): string {
  const name = semanticNameOf(box)
  return box.text ? `${name} · ${box.text}` : name
}

/** Outer-to-inner names for the breadcrumb, shell scaffolding left out. */
export function htmlElementMapBreadcrumb(
  map: HtmlElementMap,
  id: number
): { id: number; label: string }[] {
  return htmlElementMapChain(map, id)
    .filter((box) => !box.shell)
    .reverse()
    .map((box) => ({ id: box.id, label: semanticNameOf(box) }))
}

export function htmlElementBoxSizeLabel(box: Pick<HtmlElementBox, 'w' | 'h'>): string {
  return `${Math.round(box.w)} × ${Math.round(box.h)}`
}

export type HtmlElementMeasureLine = {
  /** Axis-aligned segment in guest px. */
  x1: number
  y1: number
  x2: number
  y2: number
  value: number
}

type Rect = { x: number; y: number; w: number; h: number }

/**
 * Distance guides from the selected box to another one. Inside the target it
 * measures the four edge gaps; otherwise it measures the gap along each axis on
 * which the boxes are separated, drawn at the overlap's midpoint.
 */
export function measureHtmlElementBoxes(from: Rect, to: Rect): HtmlElementMeasureLine[] {
  const lines: HtmlElementMeasureLine[] = []
  const fromRight = from.x + from.w
  const fromBottom = from.y + from.h
  const toRight = to.x + to.w
  const toBottom = to.y + to.h
  const midY = (Math.max(from.y, to.y) + Math.min(fromBottom, toBottom)) / 2
  const midX = (Math.max(from.x, to.x) + Math.min(fromRight, toRight)) / 2
  const overlapsX = Math.min(fromRight, toRight) > Math.max(from.x, to.x)
  const overlapsY = Math.min(fromBottom, toBottom) > Math.max(from.y, to.y)
  const push = (x1: number, y1: number, x2: number, y2: number, value: number): void => {
    if (value >= 1) lines.push({ x1, y1, x2, y2, value: Math.round(value) })
  }
  if (overlapsX && overlapsY) {
    const cx = from.x + from.w / 2
    const cy = from.y + from.h / 2
    push(Math.min(from.x, to.x), cy, Math.max(from.x, to.x), cy, Math.abs(from.x - to.x))
    push(Math.min(fromRight, toRight), cy, Math.max(fromRight, toRight), cy, Math.abs(fromRight - toRight))
    push(cx, Math.min(from.y, to.y), cx, Math.max(from.y, to.y), Math.abs(from.y - to.y))
    push(cx, Math.min(fromBottom, toBottom), cx, Math.max(fromBottom, toBottom), Math.abs(fromBottom - toBottom))
    return lines
  }
  if (toRight <= from.x) push(toRight, midY, from.x, midY, from.x - toRight)
  else if (to.x >= fromRight) push(fromRight, midY, to.x, midY, to.x - fromRight)
  if (toBottom <= from.y) push(midX, toBottom, midX, from.y, from.y - toBottom)
  else if (to.y >= fromBottom) push(midX, fromBottom, midX, to.y, to.y - fromBottom)
  return lines
}

export function htmlElementBoxesSameRect(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) <= SAME_RECT_TOLERANCE && Math.abs(a.y - b.y) <= SAME_RECT_TOLERANCE &&
    Math.abs(a.w - b.w) <= SAME_RECT_TOLERANCE && Math.abs(a.h - b.h) <= SAME_RECT_TOLERANCE
}

const SERIALIZED_MAP_STATE = '__kunPickMap'

/** Runs in the guest. `onlyIfDirty` makes an unchanged page answer in a few bytes. */
export function buildHtmlElementMapScript(onlyIfDirty: boolean): string {
  return `(() => {
  try {
    const KEY = ${JSON.stringify(SERIALIZED_MAP_STATE)};
    let state = window[KEY];
    if (!state) {
      state = { dirty: true, token: 0, els: [] };
      window[KEY] = state;
      const mark = () => { state.dirty = true };
      try { new MutationObserver(mark).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }) } catch {}
      try { new ResizeObserver(mark).observe(document.documentElement) } catch {}
      window.addEventListener('scroll', mark, true);
      window.addEventListener('resize', mark);
      ['transitionend', 'animationend', 'load'].forEach((name) => window.addEventListener(name, mark, true));
    }
    if (${onlyIfDirty ? 'true' : 'false'} && !state.dirty) return { ok: true, unchanged: true, token: state.token };
    const MAX = ${HTML_ELEMENT_MAP_MAX_BOXES};
    const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'BR', 'WBR', 'TITLE']);
    const MEDIA = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'PICTURE', 'INPUT', 'TEXTAREA', 'SELECT', 'IFRAME']);
    const INTERACTIVE = new Set(['BUTTON', 'A', 'SELECT', 'TEXTAREA', 'INPUT', 'SUMMARY', 'LABEL']);
    const ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'option', 'combobox', 'searchbox', 'textbox']);
    const SENSITIVE = 'input[type="password"],input[type="hidden"],[data-kun-sensitive]';
    const vw = Math.round(window.innerWidth), vh = Math.round(window.innerHeight);
    const px = (value) => Math.max(0, Math.round(parseFloat(value) || 0));
    const boxes = [];
    const els = [];
    const stack = [{ el: document.body, parent: -1, depth: 0, collapsed: false }];
    while (stack.length && boxes.length < MAX) {
      const { el, parent, depth, collapsed } = stack.pop();
      if (!el || el.nodeType !== 1 || SKIP.has(el.tagName.toUpperCase())) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.opacity === '0') continue;
      if (el.matches(SENSITIVE)) continue;
      let nextParent = parent, nextDepth = depth, nextCollapsed = collapsed;
      if (el !== document.body && !collapsed && cs.visibility !== 'hidden' && cs.display !== 'contents') {
        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const componentName = el.getAttribute('data-kun-component') || el.getAttribute('data-component') || '';
        const sourceId = el.getAttribute('data-kun-source-id') || '';
        const interactive = INTERACTIVE.has(el.tagName.toUpperCase()) || ROLES.has(role);
        const strong = interactive || Boolean(componentName || sourceId);
        let ownText = '';
        for (const node of el.childNodes) if (node.nodeType === 3) ownText += node.nodeValue;
        ownText = ownText.replace(/\\s+/g, ' ').trim();
        const visual = (cs.backgroundColor && !/rgba\\(.*,\\s*0\\)|transparent/.test(cs.backgroundColor)) ||
          (cs.backgroundImage && cs.backgroundImage !== 'none') ||
          (cs.boxShadow && cs.boxShadow !== 'none') ||
          (px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') ||
          (px(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none') ||
          (px(cs.borderLeftWidth) > 0 && cs.borderLeftStyle !== 'none');
        const meaningful = strong || MEDIA.has(el.tagName.toUpperCase()) || Boolean(ownText) || visual;
        if (meaningful && rect.width >= 6 && rect.height >= 6) {
          boxes.push({
            parent, depth: depth + 1,
            x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height),
            tagName: tag, componentName, role, strong, ownText: Boolean(ownText),
            text: (el.getAttribute('aria-label') || ownText || el.getAttribute('alt') || '').slice(0, 60),
            shell: !strong && ['div', 'section', 'main', 'article', 'form'].includes(tag) &&
              rect.width * rect.height >= vw * vh * 0.9,
            pad: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)]
          });
          els.push(el);
          nextParent = boxes.length - 1;
          nextDepth = depth + 1;
          // A button's inner spans/icons belong to the button.
          if (el.tagName === 'BUTTON' || role === 'button' || MEDIA.has(el.tagName.toUpperCase())) nextCollapsed = true;
        }
      }
      const children = el.children;
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push({ el: children[i], parent: nextParent, depth: nextDepth, collapsed: nextCollapsed });
      }
    }
    // Drop wrappers that are the same rect as a kept child and add nothing of their own.
    const drop = new Array(boxes.length).fill(false);
    boxes.forEach((box, index) => {
      const p = box.parent >= 0 ? boxes[box.parent] : null;
      if (!p || p.strong || p.ownText || p.shell) return;
      const same = Math.abs(p.x - box.x) <= ${SAME_RECT_TOLERANCE} && Math.abs(p.y - box.y) <= ${SAME_RECT_TOLERANCE} &&
        Math.abs(p.w - box.w) <= ${SAME_RECT_TOLERANCE} && Math.abs(p.h - box.h) <= ${SAME_RECT_TOLERANCE};
      if (same) drop[box.parent] = true;
    });
    const remap = new Array(boxes.length).fill(-1);
    const outBoxes = [];
    const outEls = [];
    const liveParent = (index) => {
      let p = boxes[index].parent;
      while (p >= 0 && drop[p]) p = boxes[p].parent;
      return p;
    };
    boxes.forEach((box, index) => {
      if (drop[index]) return;
      remap[index] = outBoxes.length;
      const parent = liveParent(index);
      outBoxes.push({ ...box, parent: parent >= 0 ? remap[parent] : -1 });
      outEls.push(els[index]);
    });
    state.els = outEls;
    state.dirty = false;
    state.token += 1;
    return { ok: true, token: state.token, viewportWidth: vw, viewportHeight: vh, boxes: outBoxes };
  } catch (error) {
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
})()`
}
