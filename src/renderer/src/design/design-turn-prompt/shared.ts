import { WRITE_PROTOTYPE_DEFAULT_PROMPT, WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import {
  DESIGN_CRAFT_LINES,
  DESIGN_DELIVERY_LINES,
  DESIGN_RESIZE_RESPONSIVE_LINES,
  defaultFrameSizeForDesignTarget,
  formatDesignContextLines,
  normalizeDesignTarget,
  type DesignContext
} from "../design-context"
import type { CanvasSnapshot } from "../canvas/canvas-snapshot"
import { snapshotToCompactJson } from "../canvas/canvas-snapshot"
import type { OpError } from "../canvas/shape-ops"
import { useDesignSystemStore } from "../canvas/design-system-store"
import type { DesignSystem, DesignToken } from "../canvas/design-system-types"
import { takeLastLintFindings } from "../canvas/design-lint"
import type { DerivedTokens } from "../design-token-extract"
import type { DesignContextLocation, DesignHtmlElementContext } from "../design-composer-context"
import { formatDesignHtmlQualityFindings, type DesignHtmlQualityFinding } from "../design-html-quality"

/**
 * Render the design tokens already extracted from the live design (palette +
 * type scale) as a concrete reuse contract. Cohesion across pages was relying on
 * the model reading sibling HTML; handing it the actual `#hex` accent and type
 * scale to match is far stronger and stops palettes drifting between iterations.
 */
export function formatDerivedTokenLines(tokens: DerivedTokens | undefined): string[] {
  if (!tokens) return []
  const colorParts: string[] = []
  if (tokens.palette.primary?.base) colorParts.push(`accent ${tokens.palette.primary.base}`)
  if (tokens.palette.secondary?.base) colorParts.push(`secondary ${tokens.palette.secondary.base}`)
  if (tokens.palette.neutral?.base) colorParts.push(`neutral ${tokens.palette.neutral.base}`)
  const typeParts = tokens.typeRows.slice(0, 4).map((r) => `${r.label} ${Math.round(r.px)}/${r.fontWeight}`)
  const fontFamily = tokens.typeRows.find((r) => r.fontFamily)?.fontFamily?.split(',')[0]?.trim()
  if (colorParts.length === 0 && typeParts.length === 0) return []
  const lines = ['Existing design tokens to REUSE exactly (keep this cohesive with the rest of the product):']
  if (colorParts.length > 0) lines.push(`- Palette: ${colorParts.join(', ')}`)
  if (typeParts.length > 0) {
    lines.push(`- Type scale: ${typeParts.join(', ')}${fontFamily ? ` — font ${fontFamily}` : ''}`)
  }
  lines.push('')
  return lines
}

export type DesignTurnTarget = 'html' | 'canvas' | 'screen' | 'svg'

export type DesignFrameContext = {
  name?: string
  width: number
  height: number
  sizeMode?: 'auto' | 'manual' | 'manual-width-auto-height'
}

export type DesignTurnOptions = {
  target: DesignTurnTarget
  mode: 'text' | 'image'
  /** Free-form description of the design to produce (text mode). */
  text?: string
  /** Workspace-relative path the agent must write the artifact to. */
  artifactRelativePath: string
  /** Workspace-relative per-artifact design notes file the agent may update. */
  designNotesPath?: string
  /** Prior version to iterate on; set = update that design instead of starting fresh. */
  basePath?: string
  /** HTML preview element selected by the user for this turn. */
  htmlElementContext?: DesignHtmlElementContext
  workspaceRoot: string
  /** User override prompt; empty = built-in default. */
  customPrompt?: string
  /** Annotation-flattened image used as the edit reference without replacing the visible source. */
  imageEditReferencePath?: string
  designContext?: DesignContext
  /** Canvas mode only: current snapshot of the shape document for AI reasoning. */
  canvasSnapshot?: CanvasSnapshot
  /**
   * Real canvas frame that hosts this HTML artifact. The generated page's
   * viewport must match this size, so iteration does not drift away from the
   * visible artboard.
   */
  frameContext?: DesignFrameContext
  /**
   * Sibling pages already on the project canvas. Passed so a generated/iterated
   * page stays visually consistent with the rest of the project (shared palette,
   * typography, spacing) — the cohesion half of the Stitch-style multi-page model.
   */
  screenManifest?: ScreenManifestEntry[]
  /**
   * Lightweight pointers to the design artifacts the user has selected on the
   * canvas/board (HTML page, SVG canvas, image). We pass each one's file path +
   * directory — NOT the inlined content — so the agent reads them on demand
   * instead of us bloating the turn with full HTML/JSON.
   */
  contextLocations?: DesignContextLocation[]
  /**
   * Errors from the PREVIOUS canvas turn's ops (bad shape id, schema-invalid op,
   * missing parent) so the agent can self-correct. Rendered near the top of the
   * canvas prompt; the apply hook stashes them and the next canvas turn takes them.
   */
  previousOpErrors?: OpError[]
  /**
   * Canvas mode only: one-shot feedback key for lint findings. Omitted in Design
   * mode; Code mode uses a per-thread key so critique findings do not leak
   * across sidebars or into the Design canvas.
   */
  canvasFeedbackKey?: string
  /**
   * Canvas prompt surface. Design mode owns HTML screen artifacts; Code mode is
   * a sidebar whiteboard where screen ops land as plain editable frames.
   */
  canvasSurface?: 'design' | 'code'
  /**
   * Canvas mode only: explicit design-system context. Code mode passes the
   * current thread's persisted design system here so it never falls back to
   * another canvas' global store state.
   */
  canvasDesignSystem?: DesignSystem
  /** Exact hash of the current valid root DESIGN.md; omitted for missing/invalid/conflicted sources. */
  projectDesignMdSourceHash?: string
  /**
   * Tokens extracted from the page being iterated (or the project's anchor page)
   * so an HTML/screen turn reuses the real palette/type scale instead of
   * re-inventing one and drifting from the rest of the product.
   */
  derivedTokens?: DerivedTokens
  /**
   * Static audit findings from the prior HTML version. These are injected only
   * into HTML/screen turns so the agent fixes quality issues during iteration.
   */
  qualityFindings?: DesignHtmlQualityFinding[]
}

/**
 * Render the "the user is pointing at these" block: a short list of selected
 * artifact paths + directories. The agent reads them on demand — we deliberately
 * do NOT inline HTML/JSON so the turn stays small.
 */
export function formatContextLocationLines(locations: DesignContextLocation[] | undefined): string[] {
  if (!locations || locations.length === 0) return []
  const seen = new Set<string>()
  const rows: string[] = []
  for (const loc of locations) {
    const path = loc.path.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    const title = loc.title.trim() || path
    rows.push(`- ${title} [${loc.kind}] → \`${path}\` (directory: \`${loc.directory}\`)`)
  }
  if (rows.length === 0) return []
  return [
    'Selected on the canvas (the user is pointing at these). Read the listed file(s) only if you need their current content — do not assume their contents, and do not inline them wholesale:',
    ...rows
  ]
}

/**
 * Turn prompt for the design agent: produce a single-file interactive HTML
 * artifact saved to the exact reserved path. Generalizes
 * `buildSddPrototypeTurnPrompt` (drops the SDD-requirement framing) while
 * keeping the single-file / incremental-write / <4000-char-per-tool-call
 * contract the webview embed + path polling rely on.
 *
 * Single target today; the P2 (`'graph'`) / P3 (`'penpot'`) phases add a
 * `switch (options.target)` branch here without touching the HTML path.
 */
export type ScreenManifestEntry = {
  name: string
  /** Canvas placement size in px; omitted for free-flow HTML pages. */
  width?: number
  height?: number
  htmlPath: string
  /** One-line brief of what the page is, so the agent can align without reading it. */
  summary?: string
  /** Sibling's actual accent color (hex), extracted from its render, for cohesion. */
  accent?: string
  /** Sibling's primary font family, extracted from its render, for cohesion. */
  fontFamily?: string
  /** Foundation role, so a page knows which sibling is the canonical style guide. */
  role?: 'design-system' | 'logo'
}

export function normalizePrototypePath(path: string): string {
  return path.trim().replaceAll('\\', '/').replace(/^\/+/, '')
}

export function buildPrototypeHref(fromHtmlPath: string | undefined, toHtmlPath: string): string {
  const target = normalizePrototypePath(toHtmlPath)
  const from = normalizePrototypePath(fromHtmlPath ?? '')
  if (!from || !target) return target
  const fromParts = from.split('/').filter(Boolean)
  const targetParts = target.split('/').filter(Boolean)
  fromParts.pop()
  let shared = 0
  while (
    shared < fromParts.length &&
    shared < targetParts.length &&
    fromParts[shared] === targetParts[shared]
  ) {
    shared += 1
  }
  const up = fromParts.slice(shared).map(() => '..')
  const down = targetParts.slice(shared)
  return [...up, ...down].join('/') || './'
}

export const PROTOTYPE_NAVIGATION_MARKUP_LINES = [
  'Prototype link markup contract:',
  '- Use `<a href="...">` for navigation items that are semantically links.',
  '- For button-like, card-like, form-submit, or tab-like controls that navigate to another screen, keep the right element and set `data-href="..."` / `data-prototype-href="..."` to the listed prototype href, or `data-prototype-target="Exact Screen Title"` when only the target page title is available; the prototype player intercepts those attributes.',
  '- If a scripted router is necessary, call `history.pushState(...)` / `history.replaceState(...)` or `location.assign` / `location.replace` / `location.href` / `location.hash` with a prototype href or exact screen title; the prototype player intercepts those too.',
  '- For Back / Previous controls that should return to the last prototype screen, call `history.back()` or `history.go(-1)`; the prototype player maps that to its own screen history.',
  '- Prefer native `<a>` / `<button>` elements. If a whole card/tab must be a non-native clickable region, add `role="button"` or `role="tab"`, `tabindex="0"`, and the same `data-prototype-*` target so click and keyboard activation both work in prototype mode.',
  '- Do not rely on text-only mentions, comments, or dead `href="#"` links for cross-screen navigation.'
]

export function formatDesignTargetFrameLines(ctx: DesignContext | undefined): string[] {
  const target = normalizeDesignTarget(ctx?.designTarget)
  const dims = defaultFrameSizeForDesignTarget(target)
  return target === 'app'
    ? [
        `Design target: App. Default screen frame is ${dims.width}x${dims.height} phone portrait unless the brief explicitly asks for tablet or desktop.`,
        '- Bias layout toward mobile app screens: touch-sized controls, app bars, tabs/bottom navigation, focused workflows, and prototype links between screens.'
      ]
    : [
        `Design target: Web. Default screen frame is ${dims.width}x${dims.height} desktop web unless the brief explicitly asks for mobile, tablet, or app.`,
        '- Bias layout toward responsive browser/web-page behavior with real navigation, sections, and breakpoints.'
      ]
}

export function formatCanvasTargetFrameLines(
  ctx: DesignContext | undefined,
  surface: 'design' | 'code'
): string[] {
  if (surface === 'design') return formatDesignTargetFrameLines(ctx)
  const target = normalizeDesignTarget(ctx?.designTarget)
  const dims = defaultFrameSizeForDesignTarget(target)
  return target === 'app'
    ? [
        `Design target: App. UI frame default is ${dims.width}x${dims.height} phone portrait for explicit UI mockups only.`,
        '- Code architecture, dependency, data-flow, and debugging diagrams are freeform whiteboard shapes; do not treat them as screen/page requests.'
      ]
    : [
        `Design target: Web. UI frame default is ${dims.width}x${dims.height} desktop web for explicit UI mockups only.`,
        '- Code architecture, dependency, data-flow, and debugging diagrams are freeform whiteboard shapes; do not treat them as screen/page requests.'
      ]
}

export function formatDesignTargetAssetLines(ctx: DesignContext | undefined): string[] {
  const target = normalizeDesignTarget(ctx?.designTarget)
  const dims = defaultFrameSizeForDesignTarget(target)
  return target === 'app'
    ? [
        `Design target: App. If this image is a UI or product mock, compose it for a ${dims.width}x${dims.height} phone-oriented app screen with touch-friendly chrome.`
      ]
    : [
        `Design target: Web. If this image is a UI or product mock, compose it for a ${dims.width}x${dims.height} responsive web page or browser surface.`
      ]
}

export type ParallelDesignPageJob = {
  artifactId: string
  title: string
  relativePath: string
  designMdPath: string
  brief: string
  screenManifest: ScreenManifestEntry[]
}

export type ParallelDesignPagesPromptOptions = {
  workspaceRoot: string
  jobs: ParallelDesignPageJob[]
  designContext?: DesignContext
  customPrompt?: string
  projectBrief?: string
}

/**
 * Render the "other pages in this project" block shared by the HTML and screen
 * turn prompts. Lets a generated/iterated page align with its siblings.
 */
export function formatScreenManifestLines(
  manifest: ScreenManifestEntry[] | undefined,
  currentHtmlPath?: string
): string[] {
  if (!manifest || manifest.length === 0) return []
  return [
    'Other pages already in this project (keep ONE cohesive design system across them — shared palette, typography, spacing, components, and prototype navigation):',
    ...manifest.map((s) => {
      const dims = typeof s.width === 'number' && typeof s.height === 'number'
        ? ` (${Math.round(s.width)}x${Math.round(s.height)})`
        : ''
      const tokenParts = [
        s.accent ? `accent ${s.accent}` : '',
        s.fontFamily ? `font ${s.fontFamily}` : ''
      ].filter(Boolean)
      const tokens = tokenParts.length > 0 ? ` [${tokenParts.join(', ')}]` : ''
      const roleTag =
        s.role === 'design-system'
          ? ' [design system — the canonical style guide; follow it]'
          : s.role === 'logo'
            ? ' [logo]'
            : ''
      const summary = s.summary?.trim() ? ` — ${s.summary.trim().slice(0, 160)}` : ''
      const prototypeHref = currentHtmlPath ? ` (prototype href: ${buildPrototypeHref(currentHtmlPath, s.htmlPath)})` : ''
      return `- "${s.name}"${dims}${tokens}${roleTag} → ${s.htmlPath}${prototypeHref}${summary}`
    }),
    'Prototype navigation: turn relevant nav items, cards, tabs, and primary/secondary actions into clickable routes using the listed prototype hrefs; keep same-page controls as buttons and avoid dead `#` links.',
    ...PROTOTYPE_NAVIGATION_MARKUP_LINES,
    'Read a relevant sibling page if you need to match its exact styling. Do NOT modify sibling files — only the reserved file for this turn.'
  ]
}

export type ScreenTurnOptions = DesignTurnOptions & {
  screenName: string
  screenWidth?: number
  screenHeight?: number
  screenSizeMode?: 'auto' | 'manual' | 'manual-width-auto-height'
  screenManifest: ScreenManifestEntry[]
}
