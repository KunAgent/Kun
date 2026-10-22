import { WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import {
  DESIGN_CRAFT_LINES,
  DESIGN_DELIVERY_LINES,
  formatDesignContextLines,
  normalizeDesignTarget,
  type DesignContext
} from './design-context'
import { buildPrototypeHref, type ScreenManifestEntry } from './design-turn-prompt'
import { currentDesignArtifactVersion, type DesignArtifact, type DesignPrototypeLink } from './design-types'

/** A planned page in a multi-page (Stitch-style) generation run. */
export type DesignPagePlanEntry = {
  /** Short page name shown as the screen title on the canvas. */
  title: string
  /** Self-contained brief used to generate this page's HTML. */
  brief: string
  /** The user outcome this screen should support, not just the layout type. */
  userGoal?: string
  /** Concrete data/content examples the screen should render to avoid template output. */
  dataExamples?: string[]
  /** Important UI states this page should visibly cover. */
  states?: string[]
  /** The main action this screen should make available in the prototype flow. */
  primaryAction?: string
  /** Other planned screen titles this page should link to when relevant. */
  linksTo?: string[]
}

export const DESIGN_PAGES_MIN = 2
export const DESIGN_PAGES_MAX = 6

export type PlannedPrototypePage = {
  title: string
  artifactId: string
  relativePath: string
}

function normalizePlanTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

function planTitleTokens(title: string): string[] {
  return normalizePlanTitle(title)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
}

function fuzzyPlanTitleMatch(query: string, candidate: string): boolean {
  const queryTokens = planTitleTokens(query)
  const candidateTokens = planTitleTokens(candidate)
  if (queryTokens.length === 0 || candidateTokens.length === 0) return false
  return (
    queryTokens.every((token) => candidateTokens.includes(token)) ||
    candidateTokens.every((token) => queryTokens.includes(token))
  )
}

function plannedPageTitleMatch(
  title: string,
  plannedPages: readonly PlannedPrototypePage[],
  currentRelativePath: string
): { page?: PlannedPrototypePage; ambiguous: boolean } {
  const normalized = normalizePlanTitle(title)
  const exact = plannedPages.filter((page) =>
    page.relativePath !== currentRelativePath &&
    normalizePlanTitle(page.title) === normalized
  )
  if (exact.length === 1) return { page: exact[0], ambiguous: false }
  if (exact.length > 1) return { ambiguous: true }
  const fuzzy = plannedPages.filter((page) =>
    page.relativePath !== currentRelativePath &&
    fuzzyPlanTitleMatch(title, page.title)
  )
  if (fuzzy.length === 1) return { page: fuzzy[0], ambiguous: false }
  return { ambiguous: fuzzy.length > 1 }
}

export function buildPrototypeLinksForPage(
  entry: DesignPagePlanEntry,
  currentRelativePath: string,
  plannedPages: PlannedPrototypePage[]
): DesignPrototypeLink[] {
  const explicitLinksTo = entry.linksTo?.map((title) => title.trim()).filter(Boolean) ?? []
  const currentIndex = plannedPages.findIndex((page) => page.relativePath === currentRelativePath)
  const fallbackTarget =
    plannedPages.length > 1 && currentIndex >= 0
      ? plannedPages[(currentIndex + 1) % plannedPages.length]
      : undefined
  const linksTo = explicitLinksTo.length > 0
    ? explicitLinksTo
    : fallbackTarget
      ? [fallbackTarget.title]
      : []
  if (linksTo.length === 0) return []
  const links: DesignPrototypeLink[] = []
  const seen = new Set<string>()
  let hasAmbiguousExplicitTarget = false
  for (const title of linksTo) {
    const match = plannedPageTitleMatch(title, plannedPages, currentRelativePath)
    const target = match.page
    if (explicitLinksTo.length > 0 && match.ambiguous) hasAmbiguousExplicitTarget = true
    const key = target?.artifactId ?? normalizePlanTitle(title)
    if (seen.has(key)) continue
    seen.add(key)
    links.push({
      targetTitle: target?.title ?? title,
      ...(target ? { targetArtifactId: target.artifactId } : {}),
      ...(target ? { href: buildPrototypeHref(currentRelativePath, target.relativePath) } : {}),
      ...(target && entry.primaryAction && links.length === 0 ? { label: entry.primaryAction.trim() } : {})
    })
  }
  if (
    explicitLinksTo.length > 0 &&
    !hasAmbiguousExplicitTarget &&
    !links.some((link) => Boolean(link.targetArtifactId && link.href)) &&
    fallbackTarget &&
    !seen.has(fallbackTarget.artifactId)
  ) {
    links.push({
      targetTitle: fallbackTarget.title,
      targetArtifactId: fallbackTarget.artifactId,
      href: buildPrototypeHref(currentRelativePath, fallbackTarget.relativePath),
      ...(entry.primaryAction && !links.some((link) => link.label?.trim()) ? { label: entry.primaryAction.trim() } : {})
    })
  }
  return links
}

/**
 * Each design turn ends with the agent's one-paragraph summary of what it built
 * (the prompts ask for it). Pull that closing prose out of the assistant reply —
 * code/HTML fences dropped, last paragraph, length-capped — so it can be written
 * back to the artifact version. The sibling manifest then describes what a page
 * BECAME instead of echoing the user's raw prompt forever. Returns '' when there
 * is no usable prose (caller keeps the existing summary).
 */
export function extractAgentDesignSummary(assistantText: string): string {
  const withoutCode = (assistantText ?? '').replace(/```[\s\S]*?```/g, '').trim()
  if (!withoutCode) return ''
  const paragraphs = withoutCode
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
  if (paragraphs.length === 0) return ''
  const last = paragraphs[paragraphs.length - 1]
  return last.length > 280 ? `${last.slice(0, 277).trimEnd()}…` : last
}

/**
 * A screen whose only version is its initial placeholder: some turn is still
 * going to generate it, and its recorded summary is that turn's brief.
 */
export function isPlaceholderDesignArtifact(artifact: DesignArtifact): boolean {
  return artifact.previewStatus === 'pending' && artifact.versions.length <= 1
}

/**
 * Sibling-page manifest for the design turn prompt: every OTHER HTML page on the
 * project canvas, so a generated/iterated page can keep one cohesive design
 * system (the cohesion half of the Stitch-style multi-page model).
 */
export function buildHtmlSiblingManifest(
  artifacts: DesignArtifact[],
  excludeId: string | null,
  limit = 8
): ScreenManifestEntry[] {
  const siblings: ScreenManifestEntry[] = []
  for (const artifact of artifacts) {
    if (artifact.kind !== 'html' || artifact.id === excludeId) continue
    const planned = isPlaceholderDesignArtifact(artifact)
    const summary = planned ? '' : currentDesignArtifactVersion(artifact)?.summary?.trim()
    siblings.push({
      name: artifact.title,
      htmlPath: artifact.relativePath,
      ...(planned ? { planned: true } : {}),
      ...(artifact.node
        ? { width: artifact.node.width, height: artifact.node.height }
        : {}),
      ...(summary ? { summary } : {}),
      ...(artifact.role ? { role: artifact.role } : {})
    })
    if (siblings.length >= limit) break
  }
  return siblings
}

/**
 * Planning-turn prompt: ask the agent to decompose a one-line app brief into a
 * small set of distinct pages/screens. The agent replies with a single fenced
 * ```pages JSON array and writes NO files — the renderer parses the plan and
 * then generates each page on its own turn (so each page previews + stays
 * cohesive with its already-generated siblings).
 */
export function buildDesignPlanPrompt(options: {
  brief: string
  workspaceRoot: string
  designContext?: DesignContext
  existingPages?: ScreenManifestEntry[]
  maxPages?: number
}): string {
  const maxPages = Math.min(DESIGN_PAGES_MAX, Math.max(DESIGN_PAGES_MIN, options.maxPages ?? DESIGN_PAGES_MAX))
  const designTarget = normalizeDesignTarget(options.designContext?.designTarget)
  const targetLabel = designTarget === 'app' ? 'mobile app prototype' : 'web design'
  const lines = [
    `Kun is asking you to PLAN a multi-page ${targetLabel} — break the idea into the distinct pages/screens it needs.`,
    `Workspace: ${options.workspaceRoot}`,
    '',
    'How to respond:',
    '- Do NOT write or edit any file this turn, and do NOT produce HTML.',
    '- Think about the core user journey, then list the distinct screens it requires.',
    `- Reply with a short one-sentence plan, then EXACTLY ONE fenced \`\`\`pages code block containing a JSON array of ${DESIGN_PAGES_MIN}-${maxPages} pages.`,
    '- Each array item is an object: { "title": "<short screen name>", "brief": "<a self-contained one-paragraph description of this screen: its purpose, key sections, components, and states>", "userGoal": "<what the user is trying to accomplish>", "dataExamples": ["<realistic names, metrics, dates, prices, statuses, records>", ...], "states": ["<empty/loading/error/permission/offline/disabled/etc>", ...], "primaryAction": "<main CTA/action>", "linksTo": ["<other planned screen title>", ...] }.',
    designTarget === 'app'
      ? '- Each brief must include the screen goal, primary touch action, app navigation state, important states, and mobile behavior around a 390x844 phone frame; avoid generic "dashboard with cards" briefs.'
      : '- Each brief must include the page goal, primary action, core sections, important states, and mobile/desktop web behavior; avoid generic "dashboard with cards" briefs.',
    '- Fill dataExamples with concrete content the child page should visibly render, not vague categories. Prefer realistic domain nouns over template phrases.',
    '- Fill states with the 2-4 states that matter most for this page; each child page must show or clearly account for them in the UI.',
    '- Use linksTo to describe the clickable prototype flow: nav, cards, tabs, CTAs, or secondary actions that should move to another planned screen; child pages will turn those into `<a href>`, `data-href`, or `data-prototype-href` routes.',
    '- For multi-page plans, every page should have at least one outbound linksTo target that exactly matches another planned screen title, and the whole set should be browsable as a connected prototype rather than isolated screens.',
    '- Order pages by importance (primary screen first). Keep titles short (≤ 4 words), unique, and specific enough to be referenced from linksTo without ambiguity. Make each brief detailed enough to design that screen on its own.',
    '- Cover only genuinely distinct screens — do not pad the list. If the idea is truly a single screen, return one page.'
  ]
  if (options.existingPages && options.existingPages.length > 0) {
    lines.push(
      '',
      'Pages already on the canvas (do NOT duplicate these — only plan NEW screens that are missing):',
      ...options.existingPages.map((p) => `- "${p.name}"${p.summary ? ` — ${p.summary.slice(0, 120)}` : ''}`)
    )
  }
  const contextLines = formatDesignContextLines(options.designContext)
  if (contextLines.length > 0) lines.push('', ...contextLines)
  // A trimmed delivery + craft reminder so the planner already biases pages toward quality.
  lines.push('', ...DESIGN_DELIVERY_LINES.slice(0, 5), '', ...DESIGN_CRAFT_LINES.slice(0, 4))
  const brief = options.brief.trim()
  if (brief) lines.push('', designTarget === 'app' ? 'App idea:' : 'Web brief:', brief.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  lines.push(
    '',
    'Example response shape:',
    '```',
    'A help center needs a browsing surface, a conversation, and an empty state.',
    '```pages',
    '[',
    '  { "title": "Help Home", "brief": "Landing screen with a search bar, popular topics grid, and a prominent \'ask AI\' entry point...", "userGoal": "Find the fastest support path before filing a ticket", "dataExamples": ["Refund status", "API rate limit", "Invoice INV-2048", "12 min median response"], "states": ["empty search", "loading suggestions", "no results"], "primaryAction": "Ask AI", "linksTo": ["Chat"] },',
    '  { "title": "Chat", "brief": "Conversational help thread with the assistant: message bubbles, suggested replies, an input bar...", "userGoal": "Resolve one support question with source-backed guidance", "dataExamples": ["Order #88421", "3 suggested replies", "source cards"], "states": ["assistant thinking", "error retry", "disabled send"], "primaryAction": "Send message", "linksTo": ["Help Home"] }',
    ']',
    '```',
    '```'
  )
  return lines.join('\n')
}

/**
 * Extract the page plan from a planning-turn reply. Tolerant of how the agent
 * fences the block: prefers a ```pages block, falls back to ```json / any fenced
 * block, then to the first bare JSON array in the text. Returns [] when nothing
 * parses so the caller can degrade to a single-page generation.
 */
export function parsePagesPlan(text: string, opts?: { max?: number }): DesignPagePlanEntry[] {
  const max = Math.max(1, opts?.max ?? DESIGN_PAGES_MAX)
  const raw = extractJsonArrayString(text)
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const pages: DesignPagePlanEntry[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const briefRaw = typeof record.brief === 'string' ? record.brief.trim() : ''
    const brief = briefRaw || title
    const userGoal = typeof record.userGoal === 'string' ? record.userGoal.trim() : ''
    const dataExamples = stringArrayField(record.dataExamples ?? record.data ?? record.realData, 8)
    const states = stringArrayField(record.states ?? record.keyStates ?? record.uiStates, 6)
    const primaryAction = typeof record.primaryAction === 'string' ? record.primaryAction.trim() : ''
    const linksTo = Array.isArray(record.linksTo)
      ? record.linksTo
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 6)
      : []
    if (!title && !brief) continue
    const key = normalizePlanTitle(title || brief)
    if (seen.has(key)) continue
    seen.add(key)
    pages.push({
      title: title || brief.slice(0, 40),
      brief,
      ...(userGoal ? { userGoal } : {}),
      ...(dataExamples.length > 0 ? { dataExamples } : {}),
      ...(states.length > 0 ? { states } : {}),
      ...(primaryAction ? { primaryAction } : {}),
      ...(linksTo.length > 0 ? { linksTo } : {})
    })
    if (pages.length >= max) break
  }
  return pages
}

function stringArrayField(value: unknown, limit: number): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, limit)
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|;|\|/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, limit)
  }
  return []
}

/** Find the JSON-array source: ```pages / ```json / any fence, else a bare [ … ]. */
function extractJsonArrayString(text: string): string | null {
  const fenced =
    matchFence(text, 'pages') ?? matchFence(text, 'json') ?? matchFence(text, '')
  const candidate = fenced ?? text
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

function matchFence(text: string, lang: string): string | null {
  // ```lang\n…\n``` — lang may be empty to match a bare ``` fence.
  const re = new RegExp('```' + lang + '[^\\S\\n]*\\n([\\s\\S]*?)```', 'i')
  const m = re.exec(text)
  return m ? m[1] : null
}
