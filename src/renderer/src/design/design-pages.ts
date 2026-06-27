import { WRITE_PROTOTYPE_DEFAULT_PROMPT, WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import { DESIGN_CRAFT_LINES, formatDesignContextLines, type DesignContext } from './design-context'
import type { ScreenManifestEntry } from './design-turn-prompt'
import type { DesignArtifact } from './design-types'

/** A planned page in a multi-page (Stitch-style) generation run. */
export type DesignPagePlanEntry = {
  /** Short page name shown as the screen title on the canvas. */
  title: string
  /** Self-contained brief used to generate this page's HTML. */
  brief: string
}

export const DESIGN_PAGES_MIN = 2
export const DESIGN_PAGES_MAX = 6

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
    const summary = artifact.versions[0]?.summary?.trim()
    siblings.push({
      name: artifact.title,
      htmlPath: artifact.relativePath,
      ...(artifact.node
        ? { width: artifact.node.width, height: artifact.node.height }
        : {}),
      ...(summary ? { summary } : {})
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
  const lines = [
    'Kun is asking you to PLAN a multi-page design — break an app idea into the distinct pages/screens it needs.',
    `Workspace: ${options.workspaceRoot}`,
    '',
    'How to respond:',
    '- Do NOT write or edit any file this turn, and do NOT produce HTML.',
    '- Think about the core user journey, then list the distinct screens it requires.',
    `- Reply with a short one-sentence plan, then EXACTLY ONE fenced \`\`\`pages code block containing a JSON array of ${DESIGN_PAGES_MIN}-${maxPages} pages.`,
    '- Each array item is an object: { "title": "<short screen name>", "brief": "<a self-contained one-paragraph description of this screen: its purpose, key sections, components, and states>" }.',
    '- Order pages by importance (primary screen first). Keep titles short (≤ 4 words). Make each brief detailed enough to design that screen on its own.',
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
  // A trimmed craft reminder so the planner already biases pages toward quality.
  lines.push('', ...DESIGN_CRAFT_LINES.slice(0, 4))
  const brief = options.brief.trim()
  if (brief) lines.push('', 'App idea:', brief.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  lines.push(
    '',
    'Example response shape:',
    '```',
    'A help center needs a browsing surface, a conversation, and an empty state.',
    '```pages',
    '[',
    '  { "title": "Help Home", "brief": "Landing screen with a search bar, popular topics grid, and a prominent \'ask AI\' entry point..." },',
    '  { "title": "Chat", "brief": "Conversational help thread with the assistant: message bubbles, suggested replies, an input bar..." }',
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
    if (!title && !brief) continue
    const key = (title || brief).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    pages.push({ title: title || brief.slice(0, 40), brief })
    if (pages.length >= max) break
  }
  return pages
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
