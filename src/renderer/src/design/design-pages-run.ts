import { useChatStore } from '../store/chat-store'
import { collectAssistantTextForTurn } from '../store/chat-store-runtime-helpers'
import type { SendMessageOverrides } from '../store/chat-store-types'
import { formatDesignSystemMarkdown, type DesignContext } from './design-context'
import {
  DESIGN_SYSTEM_MD_PATH,
  buildDesignLogoPrompt,
  buildDesignSpecPrompt,
  buildDesignSpecStub,
  buildDesignSystemBoardPrompt,
  buildFoundationFollowLines,
  designSpecPath,
  findFoundationArtifact,
  type DesignFoundationRole,
  type DesignFoundationStep
} from './design-foundation'
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
  /**
   * When false, skip the design.md / design-system / logo foundation and just
   * plan + generate pages (the legacy flow). Defaults to true.
   */
  foundation?: boolean
  /** Localized chat-bubble labels (English fallbacks used when omitted). */
  labels?: {
    plan?: (brief: string) => string
    page?: (title: string, index: number, total: number) => string
    /** Progress-chip title for a foundation step. */
    foundationStep?: (step: DesignFoundationStep) => string
    /** Chat-bubble display for the spec turn. */
    specDisplay?: (brief: string) => string
    /** Chat-bubble display for the design-system turn. */
    systemDisplay?: () => string
    /** Chat-bubble display for the logo turn. */
    logoDisplay?: () => string
    /** Canvas card title for the design-system artifact. */
    systemTitle?: () => string
    /** Canvas card title for the logo artifact. */
    logoTitle?: () => string
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

/** Best-effort write of a plain workspace file (the design.md stub, DESIGN_SYSTEM.md baseline). */
async function writeWorkspaceTextFile(
  workspaceRoot: string,
  path: string,
  content: string
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof window.kunGui?.writeWorkspaceFile !== 'function') {
    return false
  }
  const res = await window.kunGui.writeWorkspaceFile({ path, workspaceRoot, content }).catch(() => null)
  return Boolean(res && res.ok)
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
 * Send one design turn and wait for it to settle. Returns a coarse status so the
 * caller can set a tailored error banner. Captures the agent's end-of-turn
 * summary onto the artifact version when an `artifactId` is given.
 */
async function runTurn(opts: {
  sendMessage: SendMessageFn
  prompt: string
  overrides: SendMessageOverrides
  signal: { cancelled: boolean }
  timeoutMs: number
  artifactId?: string
}): Promise<'complete' | 'cancelled' | 'timeout' | 'send-failed'> {
  const sent = await opts.sendMessage(opts.prompt, 'agent', opts.overrides)
  if (!sent) return 'send-failed'
  const result = await waitForTurnComplete(opts.signal, opts.timeoutMs)
  if (result !== 'complete') return result
  if (opts.artifactId) {
    const summary = extractAgentDesignSummary(assistantTextForLastTurn())
    if (summary) {
      useDesignWorkspaceStore.getState().setVersionSummary(opts.artifactId, `${opts.artifactId}-v1`, summary)
    }
  }
  return 'complete'
}

/** Create a foundation artifact card (HTML) and pre-create its preview file. */
async function createFoundationCard(opts: {
  docId: string
  workspaceRoot: string
  role: DesignFoundationRole
  title: string
}): Promise<{ id: string; relativePath: string } | null> {
  const id = createDesignArtifactId()
  const relativePath = `.kun-design/${opts.docId}/${id}/v1.html`
  const createdAt = new Date().toISOString()
  const index = useDesignWorkspaceStore.getState().artifacts.length
  useDesignWorkspaceStore.getState().upsertArtifact({
    id,
    kind: 'html',
    title: opts.title,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: '' }],
    previewStatus: 'pending',
    role: opts.role,
    node: defaultDesignArtifactNode(index)
  })
  useDesignWorkspaceStore.getState().setActiveArtifact(id)
  const prep = await prepareDesignPreviewFile(opts.workspaceRoot, relativePath)
  return prep.ok ? { id, relativePath } : null
}

/**
 * Stitch-style multi-page run with a foundation-first pipeline: first lay the
 * project `design.md`, a visual design-system style guide (+ DESIGN_SYSTEM.md
 * tokens) and a brand logo, THEN generate every page on its own turn — each one
 * following the established foundation and cohesive with its built siblings.
 */
export async function runDesignPages(deps: RunDesignPagesDeps): Promise<void> {
  if (activeRun) return
  const signal = { cancelled: false }
  activeRun = signal
  const store = useDesignWorkspaceStore.getState()
  store.setFileError(null)
  const withFoundation = deps.foundation !== false
  // Capture the active 设计稿 once so every generated artifact lands in the same one.
  const docId = store.ensureActiveDocument()

  const overrides = (display: string): SendMessageOverrides => ({
    displayText: display,
    ...(deps.model ? { model: deps.model } : {}),
    ...(deps.providerId ? { providerId: deps.providerId } : {}),
    ...(deps.reasoningEffort ? { reasoningEffort: deps.reasoningEffort } : {})
  })

  try {
    const foundationBuiltIds = new Set<string>()
    let designMdRef: string | undefined
    let designSystemRef: string | undefined

    // 1) Plan the pages. With foundation on, the same turn writes design.md.
    let plan: DesignPagePlanEntry[]
    if (withFoundation) {
      store.setPagesRun({
        phase: 'foundation',
        step: 'spec',
        total: 0,
        done: 0,
        title: deps.labels?.foundationStep?.('spec') ?? 'Design brief'
      })
      const designMdPath = designSpecPath(docId)
      await writeWorkspaceTextFile(deps.workspaceRoot, designMdPath, buildDesignSpecStub(deps.brief))
      const existingPages = buildHtmlSiblingManifest(store.artifacts, null)
      const specPrompt = buildDesignSpecPrompt({
        brief: deps.brief,
        workspaceRoot: deps.workspaceRoot,
        designMdPath,
        ...(deps.designContext ? { designContext: deps.designContext } : {}),
        ...(existingPages.length > 0 ? { existingPages } : {})
      })
      const specDisplay =
        deps.labels?.specDisplay?.(deps.brief) ??
        deps.labels?.plan?.(deps.brief) ??
        `Draft the design brief: ${deps.brief}`
      const status = await runTurn({
        sendMessage: deps.sendMessage,
        prompt: specPrompt,
        overrides: overrides(specDisplay),
        signal,
        timeoutMs: PLAN_TIMEOUT_MS
      })
      if (status === 'cancelled') return
      if (status === 'send-failed') {
        store.setFileError('Could not start the design-brief turn.')
        return
      }
      if (status === 'timeout') {
        store.setFileError('The design-brief step timed out.')
        return
      }
      await delay(300) // let the final assistant block settle before we read it
      plan = parsePagesPlan(assistantTextForLastTurn(), { max: DESIGN_PAGES_MAX })
      designMdRef = designMdPath
    } else {
      store.setPagesRun({ phase: 'planning', total: 0, done: 0, title: '' })
      const existingPages = buildHtmlSiblingManifest(store.artifacts, null)
      const planPrompt = buildDesignPlanPrompt({
        brief: deps.brief,
        workspaceRoot: deps.workspaceRoot,
        ...(deps.designContext ? { designContext: deps.designContext } : {}),
        ...(existingPages.length > 0 ? { existingPages } : {})
      })
      const planDisplay = deps.labels?.plan?.(deps.brief) ?? `Plan a multi-page design: ${deps.brief}`
      const status = await runTurn({
        sendMessage: deps.sendMessage,
        prompt: planPrompt,
        overrides: overrides(planDisplay),
        signal,
        timeoutMs: PLAN_TIMEOUT_MS
      })
      if (status === 'cancelled') return
      if (status === 'send-failed') {
        store.setFileError('Could not start the multi-page planning turn.')
        return
      }
      if (status === 'timeout') {
        store.setFileError('The page-planning step timed out.')
        return
      }
      await delay(300)
      plan = parsePagesPlan(assistantTextForLastTurn(), { max: DESIGN_PAGES_MAX })
    }
    if (plan.length === 0) {
      // The planner produced nothing parseable — degrade to a single page.
      plan = [{ title: deps.brief.slice(0, 40) || 'Design', brief: deps.brief }]
    }

    // 2) Foundation artifacts: a visual design-system style guide, then a logo.
    if (withFoundation) {
      if (signal.cancelled) return
      const existingSystem = findFoundationArtifact(
        useDesignWorkspaceStore.getState().artifacts,
        'design-system'
      )
      if (existingSystem) {
        foundationBuiltIds.add(existingSystem.id)
        designSystemRef = DESIGN_SYSTEM_MD_PATH
      } else {
        store.setPagesRun({
          phase: 'foundation',
          step: 'system',
          total: 0,
          done: 0,
          title: deps.labels?.foundationStep?.('system') ?? 'Design system'
        })
        const card = await createFoundationCard({
          docId,
          workspaceRoot: deps.workspaceRoot,
          role: 'design-system',
          title: deps.labels?.systemTitle?.() ?? 'Design system'
        })
        if (!card) {
          store.setFileError('Design preview setup failed for the design system.')
          return
        }
        // Baseline DESIGN_SYSTEM.md from the static context so the file always
        // exists; the agent enriches it with the real tokens it used.
        await writeWorkspaceTextFile(
          deps.workspaceRoot,
          DESIGN_SYSTEM_MD_PATH,
          formatDesignSystemMarkdown(deps.designContext)
        )
        const systemPrompt = buildDesignSystemBoardPrompt({
          brief: deps.brief,
          workspaceRoot: deps.workspaceRoot,
          artifactRelativePath: card.relativePath,
          designSystemMdPath: DESIGN_SYSTEM_MD_PATH,
          ...(designMdRef ? { designMdPath: designMdRef } : {}),
          ...(deps.designContext ? { designContext: deps.designContext } : {})
        })
        const status = await runTurn({
          sendMessage: deps.sendMessage,
          prompt: systemPrompt,
          overrides: overrides(deps.labels?.systemDisplay?.() ?? 'Design the visual system'),
          signal,
          timeoutMs: PAGE_TIMEOUT_MS,
          artifactId: card.id
        })
        if (status === 'cancelled') return
        if (status === 'send-failed') {
          store.setFileError('Could not start the design-system turn.')
          return
        }
        if (status === 'timeout') {
          store.setFileError('The design-system step timed out.')
          return
        }
        // Refresh the drift baseline against whatever the agent published.
        await useDesignWorkspaceStore.getState().refreshDesignSystemHash()
        foundationBuiltIds.add(card.id)
        designSystemRef = DESIGN_SYSTEM_MD_PATH
      }

      if (signal.cancelled) return
      const existingLogo = findFoundationArtifact(useDesignWorkspaceStore.getState().artifacts, 'logo')
      if (existingLogo) {
        foundationBuiltIds.add(existingLogo.id)
      } else {
        store.setPagesRun({
          phase: 'foundation',
          step: 'logo',
          total: 0,
          done: 0,
          title: deps.labels?.foundationStep?.('logo') ?? 'Logo'
        })
        const card = await createFoundationCard({
          docId,
          workspaceRoot: deps.workspaceRoot,
          role: 'logo',
          title: deps.labels?.logoTitle?.() ?? 'Logo'
        })
        if (!card) {
          store.setFileError('Design preview setup failed for the logo.')
          return
        }
        const logoPrompt = buildDesignLogoPrompt({
          brief: deps.brief,
          workspaceRoot: deps.workspaceRoot,
          artifactRelativePath: card.relativePath,
          ...(designMdRef ? { designMdPath: designMdRef } : {}),
          ...(designSystemRef ? { designSystemMdPath: designSystemRef } : {}),
          ...(deps.designContext ? { designContext: deps.designContext } : {})
        })
        const status = await runTurn({
          sendMessage: deps.sendMessage,
          prompt: logoPrompt,
          overrides: overrides(deps.labels?.logoDisplay?.() ?? 'Design the brand logo'),
          signal,
          timeoutMs: PAGE_TIMEOUT_MS,
          artifactId: card.id
        })
        if (status === 'cancelled') return
        if (status === 'send-failed') {
          store.setFileError('Could not start the logo turn.')
          return
        }
        if (status === 'timeout') {
          store.setFileError('The logo step timed out.')
          return
        }
        foundationBuiltIds.add(card.id)
      }
    }

    // 3) Create a skeleton card per page up front so they all appear immediately.
    // baseIndex already accounts for any foundation cards added above.
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

    // 4) Generate each page on its own turn, following the foundation and aware of
    // the full plan + already-built siblings (the design-system board + logo +
    // prior pages all read as siblings for cohesion).
    const foundationLines = buildFoundationFollowLines({
      ...(designMdRef ? { designMdPath: designMdRef } : {}),
      ...(designSystemRef ? { designSystemMdPath: designSystemRef } : {})
    })
    const foundationBlock = foundationLines.length > 0 ? `${foundationLines.join('\n')}\n\n` : ''
    const builtIds = new Set<string>(foundationBuiltIds)
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

      // Only already-built artifacts are readable; mention the rest as upcoming so
      // the agent designs cohesively without trying to read empty skeleton files.
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
        text: `${foundationBlock}${projectContext}${page.entry.brief}`,
        artifactRelativePath: page.relativePath,
        workspaceRoot: deps.workspaceRoot,
        ...(deps.generationPrompt ? { customPrompt: deps.generationPrompt } : {}),
        ...(deps.designContext ? { designContext: deps.designContext } : {}),
        ...(manifest.length > 0 ? { screenManifest: manifest } : {})
      })
      const pageDisplay =
        deps.labels?.page?.(page.entry.title, i + 1, created.length) ??
        `Design page ${i + 1}/${created.length}: ${page.entry.title}`
      const status = await runTurn({
        sendMessage: deps.sendMessage,
        prompt,
        overrides: overrides(pageDisplay),
        signal,
        timeoutMs: PAGE_TIMEOUT_MS,
        artifactId: page.id
      })
      if (status === 'cancelled') return
      if (status === 'send-failed') {
        store.setFileError(`Could not start generating "${page.entry.title}".`)
        return
      }
      if (status === 'timeout') {
        store.setFileError(`Generating "${page.entry.title}" timed out.`)
        return
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
