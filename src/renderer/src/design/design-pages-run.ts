import { useChatStore } from '../store/chat-store'
import { collectAssistantTextForTurn } from '../store/chat-store-runtime-helpers'
import type { SendMessageOverrides } from '../store/chat-store-types'
import type { DesignContext } from './design-context'
import {
  DESIGN_PAGES_MAX,
  buildDesignPlanPrompt,
  buildHtmlSiblingManifest,
  extractAgentDesignSummary,
  parsePagesPlan,
  type DesignPagePlanEntry
} from './design-pages'
import { prepareDesignPreviewFile } from './design-preview-file'
import { buildDesignTurnPrompt } from './design-turn-prompt'
import { createDesignArtifactId, defaultDesignArtifactNode } from './design-types'
import { useDesignWorkspaceStore } from './design-workspace-store'

type SendMessageFn = (
  text: string,
  mode?: string,
  overrides?: SendMessageOverrides
) => Promise<boolean>

export type RunDesignPagesDeps = {
  /** One-line app idea to decompose into pages. */
  brief: string
  workspaceRoot: string
  sendMessage: SendMessageFn
  model?: string
  providerId?: string
  reasoningEffort?: string
  generationPrompt?: string
  designContext?: DesignContext
  /** Localized chat-bubble labels (English fallbacks used when omitted). */
  labels?: {
    plan?: (brief: string) => string
    page?: (title: string, index: number, total: number) => string
  }
}

const PLAN_TIMEOUT_MS = 180_000
const PAGE_TIMEOUT_MS = 300_000

let activeRun: { cancelled: boolean } | null = null

/** True while a multi-page run is in flight (one at a time). */
export function isDesignPagesRunActive(): boolean {
  return activeRun !== null
}

/** Cancel the in-flight run after the current page finishes. */
export function cancelDesignPagesRun(): void {
  if (activeRun) activeRun.cancelled = true
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Resolve when the active chat turn finishes (currentTurnId non-null → null
 * edge, the same unambiguous completion signal the ShapeOps hook trusts). If a
 * turn never starts within the grace window the send is treated as settled.
 */
async function waitForTurnComplete(
  signal: { cancelled: boolean },
  timeoutMs: number
): Promise<'complete' | 'timeout' | 'cancelled'> {
  const startedAt = Date.now()
  let sawActive = false
  // Give the send a moment to register a turn before we start judging idleness.
  const graceMs = 9000
  for (;;) {
    if (signal.cancelled) return 'cancelled'
    const turnId = useChatStore.getState().currentTurnId
    if (turnId) sawActive = true
    else if (sawActive) return 'complete'
    else if (Date.now() - startedAt > graceMs) return 'complete'
    if (Date.now() - startedAt > timeoutMs) return 'timeout'
    await delay(220)
  }
}

/** Assistant text for the most recently completed turn (the last user block). */
function assistantTextForLastTurn(): string {
  const s = useChatStore.getState()
  let userId: string | null = null
  for (let i = s.blocks.length - 1; i >= 0; i -= 1) {
    if (s.blocks[i].kind === 'user') {
      userId = s.blocks[i].id
      break
    }
  }
  if (!userId) return s.liveAssistant.trim()
  return collectAssistantTextForTurn(s.blocks, userId, s.liveAssistant)
}

/**
 * Stitch-style multi-page run: plan the pages from one brief, drop a skeleton
 * card for each onto the project canvas, then generate every page on its own
 * turn — each aware of the whole project and its already-built siblings so the
 * set shares one cohesive design system.
 */
export async function runDesignPages(deps: RunDesignPagesDeps): Promise<void> {
  if (activeRun) return
  const signal = { cancelled: false }
  activeRun = signal
  const store = useDesignWorkspaceStore.getState()
  store.setFileError(null)
  store.setPagesRun({ phase: 'planning', total: 0, done: 0, title: '' })
  // Capture the active 设计稿 once so every generated page lands in the same one.
  const docId = store.ensureActiveDocument()

  const overrides = (display: string): SendMessageOverrides => ({
    displayText: display,
    ...(deps.model ? { model: deps.model } : {}),
    ...(deps.providerId ? { providerId: deps.providerId } : {}),
    ...(deps.reasoningEffort ? { reasoningEffort: deps.reasoningEffort } : {})
  })

  try {
    // 1) Plan turn — ask the agent which pages the app needs.
    const existingPages = buildHtmlSiblingManifest(store.artifacts, null)
    const planPrompt = buildDesignPlanPrompt({
      brief: deps.brief,
      workspaceRoot: deps.workspaceRoot,
      ...(deps.designContext ? { designContext: deps.designContext } : {}),
      ...(existingPages.length > 0 ? { existingPages } : {})
    })
    const planDisplay = deps.labels?.plan?.(deps.brief) ?? `Plan a multi-page design: ${deps.brief}`
    const planSent = await deps.sendMessage(planPrompt, 'agent', overrides(planDisplay))
    if (!planSent) {
      store.setFileError('Could not start the multi-page planning turn.')
      return
    }
    const planResult = await waitForTurnComplete(signal, PLAN_TIMEOUT_MS)
    if (planResult === 'cancelled') return
    if (planResult === 'timeout') {
      store.setFileError('The page-planning step timed out.')
      return
    }
    await delay(300) // let the final assistant block settle before we read it

    let plan: DesignPagePlanEntry[] = parsePagesPlan(assistantTextForLastTurn(), { max: DESIGN_PAGES_MAX })
    if (plan.length === 0) {
      // The planner produced nothing parseable — degrade to a single page.
      plan = [{ title: deps.brief.slice(0, 40) || 'Design', brief: deps.brief }]
    }

    // 2) Create a skeleton card per page up front so they all appear immediately.
    const baseIndex = useDesignWorkspaceStore.getState().artifacts.length
    const planTitles = plan.map((p) => `"${p.title}"`).join(', ')
    const created: { id: string; relativePath: string; entry: DesignPagePlanEntry }[] = []
    for (let i = 0; i < plan.length; i += 1) {
      if (signal.cancelled) return
      const entry = plan[i]
      const id = createDesignArtifactId()
      const relativePath = `.kun-design/${docId}/${id}/v1.html`
      const createdAt = new Date().toISOString()
      useDesignWorkspaceStore.getState().upsertArtifact({
        id,
        kind: 'html',
        title: entry.title,
        relativePath,
        createdAt,
        updatedAt: createdAt,
        versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: entry.brief }],
        previewStatus: 'pending',
        node: defaultDesignArtifactNode(baseIndex + i)
      })
      const prep = await prepareDesignPreviewFile(deps.workspaceRoot, relativePath)
      if (!prep.ok) {
        store.setFileError(`Design preview setup failed: ${prep.message}`)
        return
      }
      created.push({ id, relativePath, entry })
    }

    // 3) Generate each page on its own turn, aware of the full plan + built siblings.
    const builtIds = new Set<string>()
    for (let i = 0; i < created.length; i += 1) {
      if (signal.cancelled) return
      const page = created[i]
      useDesignWorkspaceStore.getState().setPagesRun({
        phase: 'generating',
        total: created.length,
        done: i,
        title: page.entry.title
      })
      useDesignWorkspaceStore.getState().setActiveArtifact(page.id)

      // Only already-built pages are readable; mention the rest as upcoming so the
      // agent designs cohesively without trying to read empty skeleton files.
      const readable = useDesignWorkspaceStore
        .getState()
        .artifacts.filter((a) => builtIds.has(a.id))
      const manifest = buildHtmlSiblingManifest(readable, page.id)
      const projectContext =
        created.length > 1
          ? `This is page ${i + 1} of ${created.length} in one app. All pages: ${planTitles}. Keep ONE cohesive design system across them; design ONLY this page now.\n\n`
          : ''
      const prompt = buildDesignTurnPrompt({
        target: 'html',
        mode: 'text',
        text: `${projectContext}${page.entry.brief}`,
        artifactRelativePath: page.relativePath,
        workspaceRoot: deps.workspaceRoot,
        ...(deps.generationPrompt ? { customPrompt: deps.generationPrompt } : {}),
        ...(deps.designContext ? { designContext: deps.designContext } : {}),
        ...(manifest.length > 0 ? { screenManifest: manifest } : {})
      })
      const pageDisplay =
        deps.labels?.page?.(page.entry.title, i + 1, created.length) ??
        `Design page ${i + 1}/${created.length}: ${page.entry.title}`
      const sent = await deps.sendMessage(prompt, 'agent', overrides(pageDisplay))
      if (!sent) {
        store.setFileError(`Could not start generating "${page.entry.title}".`)
        return
      }
      const pageResult = await waitForTurnComplete(signal, PAGE_TIMEOUT_MS)
      if (pageResult === 'cancelled') return
      if (pageResult === 'timeout') {
        store.setFileError(`Generating "${page.entry.title}" timed out.`)
        return
      }
      // Write the agent's actual end-of-turn summary back to this page's version so
      // the NEXT page's sibling manifest describes what was built, not the brief.
      const summary = extractAgentDesignSummary(assistantTextForLastTurn())
      if (summary) {
        useDesignWorkspaceStore.getState().setVersionSummary(page.id, `${page.id}-v1`, summary)
      }
      builtIds.add(page.id)
    }

    // Land on the primary (first) page so the canvas focuses something finished.
    if (created.length > 0) {
      useDesignWorkspaceStore.getState().setActiveArtifact(created[0].id)
    }
  } catch (error) {
    store.setFileError(error instanceof Error ? error.message : String(error))
  } finally {
    if (activeRun === signal) activeRun = null
    useDesignWorkspaceStore.getState().setPagesRun(null)
  }
}
