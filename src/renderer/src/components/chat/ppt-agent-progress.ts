import type { ChatBlock } from '../../agent/types'

/**
 * Pure read model for the PPT agent card: which workflow step a `ppt_agent`
 * call is on and what its structured result says about directions, review
 * pages, image assets, and the exported deck. Everything comes from the
 * tool block itself (arguments while running, the result once settled).
 */

export const PPT_PROGRESS_STEPS = ['plan', 'direction', 'build', 'preview', 'review', 'export'] as const
export type PptProgressStepId = (typeof PPT_PROGRESS_STEPS)[number]
export type PptProgressStepState = 'done' | 'current' | 'waiting' | 'todo' | 'skipped' | 'error'

export type PptAgentResult = {
  workflowId?: string
  childId?: string
  phase?: string
  imageAssets?: 'enabled' | 'disabled' | 'unavailable'
  directions?: { count: number; recommendedName?: string }
  review?: {
    slides: number
    userImages: number
    generatedImages: number
    projectImages: number
    nativeSlides: number
    qa?: { errors: number; warnings: number }
  }
  deck?: { output: string; slides?: number; editableSlides?: number; validated: boolean }
}

export type PptAgentProgress = {
  action: string
  result?: PptAgentResult
  steps: Array<{ id: PptProgressStepId; state: PptProgressStepState }>
}

const ACTION_STEP: Readonly<Record<string, PptProgressStepId>> = {
  start: 'plan',
  select_direction: 'build',
  revise_directions: 'direction',
  revise_previews: 'build',
  retry_failed: 'build',
  approve_and_build: 'export'
}

// Only tools that belong to exactly one step move the stepper; file writes happen
// both for direction sample decks and for the main deck, so they say nothing.
const TOOL_STEP: Readonly<Record<string, PptProgressStepId>> = {
  ppt_read_guide: 'plan',
  ppt_submit_design_plan: 'plan',
  ppt_create_direction_bundle: 'direction',
  ppt_read_direction_selection: 'build',
  ppt_read_review_context: 'build',
  generate_image: 'build',
  ppt_generate_previews: 'preview',
  ppt_create_review_bundle: 'preview',
  ppt_export: 'export'
}

/** Tools a start run only calls when it skipped visual-direction selection. */
const NO_DIRECTION_TOOLS = new Set(['ppt_submit_design_plan', 'generate_image', 'ppt_generate_previews', 'ppt_create_review_bundle'])

const FAILED_PHASES = new Set(['failed_recoverable', 'source_unavailable', 'unavailable'])

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseJson(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    return record(JSON.parse(value))
  } catch {
    return undefined
  }
}

function readReview(bundle: Record<string, unknown> | undefined): PptAgentResult['review'] {
  const slides = Array.isArray(bundle?.slides) ? bundle.slides.map(record).filter(Boolean) as Array<Record<string, unknown>> : []
  if (slides.length === 0) return undefined
  const origins = new Map<string, string>()
  let nativeSlides = 0
  let qaChecked = false
  let errors = 0
  let warnings = 0
  for (const slide of slides) {
    const assets = Array.isArray(slide.assets) ? slide.assets.map(record).filter(Boolean) as Array<Record<string, unknown>> : []
    if (assets.length === 0) nativeSlides += 1
    for (const asset of assets) {
      const path = text(asset.path)
      const origin = text(asset.origin)
      if (path && origin) origins.set(path, origin)
    }
    if (Array.isArray(slide.qaIssues)) {
      qaChecked = true
      for (const issue of slide.qaIssues.map(record)) {
        if (issue?.severity === 'error') errors += 1
        if (issue?.severity === 'warning') warnings += 1
      }
    }
  }
  const count = (origin: string) => [...origins.values()].filter((value) => value === origin).length
  return {
    slides: slides.length,
    userImages: count('user'),
    generatedImages: count('generated'),
    projectImages: count('project'),
    nativeSlides,
    ...(qaChecked ? { qa: { errors, warnings } } : {})
  }
}

/** Parse a settled `ppt_agent` result; arguments-only details (no phase) return undefined. */
export function readPptAgentResult(detail: string | undefined): PptAgentResult | undefined {
  const output = parseJson(detail)
  const phase = text(output?.phase)
  if (!output || !phase) return undefined
  const directionBundle = record(output.directionBundle)
  const directions = Array.isArray(directionBundle?.directions)
    ? directionBundle.directions.map(record).filter(Boolean) as Array<Record<string, unknown>>
    : []
  const deck = record(output.deckArtifact)
  const imageAssets = output.imageAssets
  const review = readReview(record(output.reviewBundle))
  return {
    workflowId: text(output.workflowId),
    childId: text(output.childId),
    phase,
    ...(imageAssets === 'enabled' || imageAssets === 'disabled' || imageAssets === 'unavailable' ? { imageAssets } : {}),
    ...(directions.length > 0
      ? {
          directions: {
            count: directions.length,
            recommendedName: text(directions.find((direction) => direction.recommended === true)?.name)
          }
        }
      : {}),
    ...(review ? { review } : {}),
    ...(deck && text(deck.output)
      ? {
          deck: {
            output: text(deck.output)!,
            ...(typeof deck.slides === 'number' ? { slides: deck.slides } : {}),
            ...(typeof deck.editableSlides === 'number' ? { editableSlides: deck.editableSlides } : {}),
            validated: deck.validated === true
          }
        }
      : {})
  }
}

export function pptAgentAction(block: ChatBlock): string {
  if (block.kind !== 'tool') return 'start'
  return text(block.meta?.action) ?? text(parseJson(block.detail)?.action) ?? 'start'
}

/**
 * Whether an earlier `ppt_agent` call of the same workflow went through
 * visual-direction selection. Returned as a primitive so a store selector
 * stays referentially stable.
 */
export function pptWorkflowUsedDirections(blocks: readonly ChatBlock[], workflowId: string | undefined): boolean {
  if (!workflowId) return false
  return blocks.some((block) => {
    if (block.kind !== 'tool' || block.meta?.toolName !== 'ppt_agent') return false
    const action = pptAgentAction(block)
    const output = parseJson(block.detail)
    const sameWorkflow = text(output?.workflowId) === workflowId
    return sameWorkflow && (output?.phase === 'awaiting_direction' || action === 'select_direction' || action === 'revise_directions')
  })
}

/** True when a later `ppt_agent` call continued the same workflow, so this card's actions are stale. */
export function pptWorkflowHasLaterCall(blocks: readonly ChatBlock[], blockId: string, workflowId: string | undefined): boolean {
  if (!workflowId) return false
  const index = blocks.findIndex((block) => block.id === blockId)
  if (index < 0) return false
  // Follow-up arguments and every settled result carry the workflowId.
  return blocks.slice(index + 1).some((block) => block.kind === 'tool' &&
    block.meta?.toolName === 'ppt_agent' &&
    text(parseJson(block.detail)?.workflowId) === workflowId)
}

export function pptAgentProgress(input: {
  action: string
  result?: PptAgentResult
  running: boolean
  failed: boolean
  activityTool?: string
  usedDirections: boolean
}): PptAgentProgress {
  const { action, result } = input
  const phase = result?.phase
  const failed = input.failed || (phase !== undefined && FAILED_PHASES.has(phase))
  const directionUsed = input.usedDirections || phase === 'awaiting_direction' ||
    action === 'select_direction' || action === 'revise_directions' ||
    (action === 'start' && input.activityTool === 'ppt_create_direction_bundle')
  // Later calls learn about directions from earlier cards of the same workflow.
  const directionSkipped = !directionUsed && (
    action === 'start'
      ? (phase !== undefined && !failed) || NO_DIRECTION_TOOLS.has(input.activityTool ?? '')
      : true
  )
  const indexOf = (id: PptProgressStepId) => PPT_PROGRESS_STEPS.indexOf(id)
  let current: number
  let currentState: PptProgressStepState
  if (phase === 'completed') {
    current = PPT_PROGRESS_STEPS.length
    currentState = 'done'
  } else if (phase === 'awaiting_direction') {
    current = indexOf('direction')
    currentState = 'waiting'
  } else if (phase === 'awaiting_review') {
    current = indexOf('review')
    currentState = 'waiting'
  } else {
    const fromAction = indexOf(ACTION_STEP[action] ?? 'plan')
    const fromTool = input.activityTool && TOOL_STEP[input.activityTool] ? indexOf(TOOL_STEP[input.activityTool]) : -1
    current = Math.max(fromAction, fromTool)
    currentState = failed ? 'error' : input.running ? 'current' : 'todo'
  }
  return {
    action,
    ...(result ? { result } : {}),
    steps: PPT_PROGRESS_STEPS.map((id, index) => {
      if (id === 'direction' && directionSkipped && index !== current) return { id, state: 'skipped' as const }
      if (index < current) return { id, state: 'done' as const }
      if (index === current) return { id, state: currentState }
      return { id, state: 'todo' as const }
    })
  }
}
