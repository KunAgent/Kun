import { relative } from 'node:path'
import { z } from 'zod'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  PptDesignPlanInput,
  submitPptDesignPlan
} from '../../ppt/ppt-design-governance.js'
import {
  PptDirectionCandidate,
  PptDirectionState,
  pptDirectionCandidateFingerprint,
  pptDirectionPlanFingerprint,
  pptDirectionSlidesFingerprint
} from '../../ppt/ppt-direction-workflow.js'
import {
  PPT_REVIEW_MANIFEST_VERSION,
  createPptReviewManifest,
  pptReviewContentHash,
  pptReviewPromptHash,
  readPptReviewManifest,
  reviewManifestPath,
  toPptDirectionBundle,
  writePptReviewManifest
} from '../../ppt/ppt-review-manifest.js'
import { withToolBoundary } from './builtin-tool-utils.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import {
  designPlanInputSchema,
  requirePptDirectionGovernance,
  resolvePptProjectDir
} from './ppt-agent-governance-tools.js'
import {
  assertPptWorkflowBinding,
  integerArg,
  stringArg,
  type PptAgentLocalToolOptions
} from './ppt-agent-local-tools-support.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { pptDirectionPreviewIntegrityError } from './ppt-agent-direction-integrity.js'
import {
  PPT_DIRECTION_SAMPLE_DIR,
  renderPptDirectionSamples,
  type PptDirectionSamplePreview
} from './ppt-agent-direction-samples.js'

export const PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME = 'ppt_create_direction_bundle'
export const PPT_READ_DIRECTION_SELECTION_TOOL_NAME = 'ppt_read_direction_selection'

const DirectionInput = z.object({
  directionId: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(80),
  rationale: z.string().trim().min(8).max(500),
  recommended: z.boolean(),
  plan: PptDesignPlanInput,
  sampleProject: z.string().trim().min(1)
}).strict()

type ResolvedDirectionInput = z.infer<typeof DirectionInput> & { previews: PptDirectionSamplePreview[] }

const SlideInput = z.object({
  slideId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(8_000)
}).strict()

type ShouldAdvertise = (context: ToolHostContext) => boolean

export function buildPptAgentDirectionTools(
  options: PptAgentLocalToolOptions,
  shouldAdvertise: ShouldAdvertise
): LocalTool[] {
  return [
    createDirectionBundleTool(options, shouldAdvertise),
    createReadDirectionSelectionTool(options, shouldAdvertise)
  ]
}

function createDirectionBundleTool(
  options: PptAgentLocalToolOptions,
  shouldAdvertise: ShouldAdvertise
): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME,
    description: [
      'Persist exactly three governed visual directions before slide generation, or revise the host-selected direction set.',
      'Each direction uses the same audience, purpose, narrative, page count, and slide plan; only the visual system may differ.',
      `Each direction points at its own 3-page editable sample PPTD under <projectDir>/${PPT_DIRECTION_SAMPLE_DIR}/<name>/ (pages in order: cover, representative content, most complex data/process page).`,
      'The host renders the samples itself; no image generation is needed.'
    ].join(' '),
    toolKind: 'file_change',
    policy: 'auto',
    sideEffect: 'unknown',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise,
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        parentThreadId: { type: 'string' },
        projectDir: { type: 'string' },
        deckTitle: { type: 'string', minLength: 1 },
        pageCount: { type: 'integer', minimum: 1, maximum: 50 },
        slides: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              slideId: { type: 'string' },
              title: { type: 'string', minLength: 1 },
              prompt: { type: 'string', minLength: 1 }
            },
            required: ['title', 'prompt'],
            additionalProperties: false
          }
        },
        directions: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              directionId: { type: 'string' },
              name: { type: 'string', minLength: 1 },
              rationale: { type: 'string', minLength: 8 },
              recommended: { type: 'boolean' },
              plan: designPlanInputSchema(),
              sampleProject: {
                type: 'string',
                minLength: 1,
                description: `Workspace-relative folder under <projectDir>/${PPT_DIRECTION_SAMPLE_DIR}/ holding this direction's 3-page sample .pptd.`
              }
            },
            required: ['name', 'rationale', 'recommended', 'plan', 'sampleProject'],
            additionalProperties: false
          }
        }
      },
      required: ['workflowId', 'parentThreadId', 'projectDir', 'deckTitle', 'pageCount', 'slides', 'directions'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      if (options.enabled?.() === false) return disabledResult()
      const scope = assertPptWorkflowBinding({ context, actions: ['start', 'revise_directions', 'retry_failed'] })
      const workflowId = stringArg(args.workflowId)
      const parentThreadId = stringArg(args.parentThreadId)
      const projectArg = stringArg(args.projectDir)
      const deckTitle = stringArg(args.deckTitle)
      const pageCount = integerArg(args.pageCount, 1, 50, 0)
      const slides = z.array(SlideInput).safeParse(args.slides)
      const inputs = z.array(DirectionInput).safeParse(args.directions)
      if (!workflowId || !parentThreadId || !projectArg || !deckTitle || pageCount === 0 || !slides.success || !inputs.success) {
        return errorResult('workflowId, parentThreadId, projectDir, deckTitle, pageCount, valid slides, and valid directions are required')
      }
      assertPptWorkflowBinding({ context, workflowId, parentThreadId, projectDir: projectArg })
      if (slides.data.length !== pageCount) return errorResult(`slide plan must contain all ${pageCount} pages`)
      const project = await resolvePptProjectDir(projectArg, context)
      const governance = await requirePptDirectionGovernance({
        options,
        context,
        workspaceRoot: project.workspaceRoot,
        projectDir: project.projectDir,
        workflowId
      })
      const sourceRequest = governance.state.directionSourceRequest ??
        await options.resolveSourceRequest?.(context) ?? context.approvalIntent
      if (typeof sourceRequest !== 'string' || !sourceRequest.trim()) {
        return errorResult('host-owned source request is unavailable; direction plans cannot be verified')
      }
      for (const direction of inputs.data) {
        submitPptDesignPlan({ state: governance.state, plan: direction.plan, sourceRequest, policy: governance.policy })
        if (direction.plan.pageStrategy.pageCount !== pageCount) {
          return errorResult(`direction ${direction.name} does not match pageCount ${pageCount}`)
        }
      }
      const resolvedInputs: ResolvedDirectionInput[] = []
      for (const { sampleProject, ...direction } of inputs.data) {
        resolvedInputs.push({
          ...direction,
          ...await renderPptDirectionSamples({
            sampleProject,
            directionName: direction.name,
            workspaceRoot: project.workspaceRoot,
            projectDir: project.projectDir,
            context
          })
        })
      }
      return withFileMutationQueue(reviewManifestPath(project.projectDir), async () => {
        const existing = await readPptReviewManifest(project.projectDir)
        const revisesExistingDirections = scope.action === 'revise_directions' ||
          (scope.action === 'retry_failed' && existing !== undefined)
        if (revisesExistingDirections) {
          const authorityError = directionAuthorityError(existing, scope)
          if (authorityError) return errorResult(authorityError)
          const previewError = existing
            ? await pptDirectionPreviewIntegrityError(existing, context)
            : ''
          if (previewError) return errorResult(previewError)
          if (slides.data.some((slide, index) =>
            slide.slideId !== existing?.slides[index]?.slideId ||
            slide.title !== existing?.slides[index]?.title ||
            !existing || (existing.slides[index]?.contentHash
              ? pptReviewContentHash(slide.prompt) !== existing.slides[index]?.contentHash
              : pptReviewPromptHash(existing.styleSpec, slide.prompt) !== existing.slides[index]?.promptHash))) {
            return errorResult('direction revision must preserve the stable slide ids, titles, and content')
          }
        }
        const directionAction = revisesExistingDirections ? 'revise_directions' : 'start'
        const candidates = mergeDirectionCandidates({
          action: directionAction,
          workflowId,
          existing,
          inputs: resolvedInputs,
          targetIds: scope.directionContext?.directions.map((direction) => direction.directionId) ?? []
        })
        const directions = PptDirectionState.parse({
          gate: governance.state.directionGate,
          candidates
        })
        const manifest = existing
          ? {
              ...existing,
              phase: 'awaiting_direction' as const,
              directions,
              governance: undefined,
              validatedExport: undefined
            }
          : createPptReviewManifest({
              workflowId,
              parentThreadId,
              childId: context.threadId,
              projectDir: relative(project.workspaceRoot, project.projectDir).replaceAll('\\', '/') || '.',
              previewMode: scope.previewMode,
              phase: 'awaiting_direction',
              deckTitle,
              styleSpec: {
                fingerprint: 'visual-direction-pending',
                fonts: [], colorTokens: {}, typeScale: {}, spacingScale: [],
                backgroundLanguage: 'visual direction pending',
                imageTreatment: 'visual direction pending',
                chartTreatment: 'native editable content after direction approval'
              },
              directions,
              slides: slides.data.map((slide) => ({ title: slide.title, prompt: slide.prompt }))
            })
        if (manifest.version !== PPT_REVIEW_MANIFEST_VERSION || manifest.deck.slideCount !== pageCount) {
          return errorResult('direction revision does not match the persisted version-3 slide plan')
        }
        if (manifest.workflowId !== workflowId || manifest.childId !== context.threadId || manifest.parentThreadId !== parentThreadId) {
          return errorResult('direction revision must resume the original workflow, child, and parent')
        }
        await writePptReviewManifest(project.projectDir, manifest)
        const manifestPath = relative(project.workspaceRoot, reviewManifestPath(project.projectDir)).replaceAll('\\', '/')
        return { output: { directionBundle: toPptDirectionBundle(manifest, manifestPath), manifestPath } }
      })
    })
  })
}

function createReadDirectionSelectionTool(
  options: PptAgentLocalToolOptions,
  shouldAdvertise: ShouldAdvertise
): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_READ_DIRECTION_SELECTION_TOOL_NAME,
    description: 'Read the persisted, host-validated direction selection. Never infer a direction id from prose.',
    toolKind: 'file_change',
    policy: 'auto',
    sideEffect: 'unknown',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise,
    inputSchema: {
      type: 'object',
      properties: { workflowId: { type: 'string' }, projectDir: { type: 'string' } },
      required: ['workflowId', 'projectDir'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      if (options.enabled?.() === false) return disabledResult()
      const scope = assertPptWorkflowBinding({ context, actions: ['select_direction', 'revise_directions'] })
      const workflowId = stringArg(args.workflowId)
      const projectArg = stringArg(args.projectDir)
      if (!workflowId || !projectArg) return errorResult('workflowId and projectDir are required')
      assertPptWorkflowBinding({ context, workflowId, projectDir: projectArg })
      const project = await resolvePptProjectDir(projectArg, context)
      return withFileMutationQueue(reviewManifestPath(project.projectDir), async () => {
        const manifest = await readPptReviewManifest(project.projectDir)
        const recoverablePromotion = scope.action === 'select_direction' &&
          manifest?.phase === 'planning' && manifest.governance !== undefined &&
          manifest.directions?.selectedDirectionId !== undefined
        if (
          !manifest || manifest.version !== PPT_REVIEW_MANIFEST_VERSION ||
          manifest.workflowId !== workflowId || manifest.childId !== context.threadId ||
          manifest.parentThreadId !== scope.parentThreadId ||
          manifest.projectDir !== scope.projectDir ||
          manifest.previewMode !== scope.previewMode ||
          (manifest.phase !== 'awaiting_direction' && manifest.phase !== 'revising_directions' && !recoverablePromotion) ||
          (scope.action === 'revise_directions' && manifest.phase === 'planning') ||
          !manifest.directions
        ) return errorResult('the active workflow has no persisted direction selection state')
        const authorityError = directionAuthorityError(manifest, scope)
        if (authorityError) return errorResult(authorityError)
        const previewError = await pptDirectionPreviewIntegrityError(manifest, context)
        if (previewError) return errorResult(previewError)
        const requested = scope.directionContext?.directions ?? []
        if (requested.length > 1) return errorResult('select at most one visual direction')
        const requestedCandidate = requested.length === 1
          ? manifest.directions.candidates.find((candidate) =>
              candidate.directionId === requested[0].directionId && candidate.revision === requested[0].revision)
          : undefined
        if (requested.length === 1 && !requestedCandidate) {
          return errorResult('selected direction is unknown or stale')
        }
        if (scope.action === 'revise_directions') {
          const targets = requestedCandidate ? [requestedCandidate] : manifest.directions.candidates
          if (manifest.phase !== 'revising_directions') {
            await writePptReviewManifest(project.projectDir, { ...manifest, phase: 'revising_directions' })
          }
          return {
            output: {
              workflowId,
              targetMode: requestedCandidate ? 'selected' : 'all',
              directions: targets.map((candidate) => ({
                directionId: candidate.directionId,
                revision: candidate.revision,
                recommended: candidate.recommended,
                plan: candidate.plan,
                ...(candidate.sampleProject ? { sampleProject: candidate.sampleProject } : {})
              })),
              slides: manifest.slides.map((slide) => ({
                slideId: slide.slideId, index: slide.index, title: slide.title
              }))
            }
          }
        }
        const persistedSelection = recoverablePromotion
          ? manifest.directions.candidates.find((candidate) =>
              candidate.directionId === manifest.directions?.selectedDirectionId)
          : undefined
        if (recoverablePromotion && requestedCandidate && requestedCandidate.directionId !== persistedSelection?.directionId) {
          return errorResult('the selected visual direction is already governed and cannot be changed')
        }
        const selected = persistedSelection ?? requestedCandidate ??
          manifest.directions.candidates.find((candidate) => candidate.recommended)
        if (!selected) return errorResult('persisted recommended direction is unavailable')
        if (scope.action === 'select_direction' && manifest.phase !== 'planning') {
          const next = {
            ...manifest,
            directions: { ...manifest.directions, selectedDirectionId: selected.directionId }
          }
          await writePptReviewManifest(project.projectDir, next)
        }
        return {
          output: {
            workflowId,
            directionId: selected.directionId,
            revision: selected.revision,
            recommendedFallback: requested.length === 0,
            plan: selected.plan,
            ...(selected.sampleProject ? { sampleProject: selected.sampleProject } : {}),
            slides: manifest.slides.map((slide) => ({ slideId: slide.slideId, index: slide.index, title: slide.title }))
          }
        }
      })
    })
  })
}

function directionAuthorityError(
  manifest: Awaited<ReturnType<typeof readPptReviewManifest>>,
  scope: ToolHostContext['pptWorkflowScope']
): string {
  if (!manifest?.directions || !scope?.directionContext) return 'host-owned direction authority is unavailable'
  const { authority, slidesFingerprint } = scope.directionContext
  const authorityIds = new Set(authority.map((candidate) => candidate.directionId))
  if (
    manifest.workflowId !== scope.workflowId ||
    manifest.childId !== scope.directionContext.childId ||
    manifest.parentThreadId !== scope.parentThreadId ||
    manifest.projectDir !== scope.projectDir ||
    manifest.previewMode !== scope.previewMode ||
    authority.length !== 3 ||
    authorityIds.size !== authority.length ||
    manifest.directions.candidates.length !== authority.length ||
    slidesFingerprint !== pptDirectionSlidesFingerprint(manifest.slides)
  ) return 'persisted direction state does not match host-owned authority'
  for (const candidate of manifest.directions.candidates) {
    const trusted = authority.find((item) => item.directionId === candidate.directionId)
    if (
      !trusted || trusted.revision !== candidate.revision ||
      trusted.recommended !== candidate.recommended ||
      trusted.planFingerprint !== pptDirectionPlanFingerprint(candidate.plan) ||
      trusted.candidateFingerprint !== pptDirectionCandidateFingerprint(candidate)
    ) return 'persisted direction state does not match host-owned authority'
  }
  return ''
}

function mergeDirectionCandidates(input: {
  action: 'start' | 'revise_directions'
  workflowId: string
  existing: Awaited<ReturnType<typeof readPptReviewManifest>>
  inputs: ResolvedDirectionInput[]
  targetIds: string[]
}): PptDirectionCandidate[] {
  if (input.action === 'start') {
    if (input.existing) throw new Error('a new direction workflow cannot replace an existing review manifest')
    if (input.inputs.length !== 3 || input.inputs.some((candidate) => candidate.directionId)) {
      throw new Error('initial direction generation requires exactly three candidates without directionId')
    }
    return input.inputs.map((candidate, index) => PptDirectionCandidate.parse({
      ...candidate,
      directionId: `${input.workflowId}-direction-${index + 1}`,
      revision: 1
    }))
  }
  if (!input.existing?.directions ||
    (input.existing.phase !== 'awaiting_direction' && input.existing.phase !== 'revising_directions')) {
    throw new Error('direction revision requires an existing awaiting-direction manifest')
  }
  const targetIds = input.targetIds.length === 1
    ? input.targetIds
    : input.existing.directions.candidates.map((candidate) => candidate.directionId)
  if (input.inputs.length !== targetIds.length) {
    throw new Error(`direction revision requires ${targetIds.length} candidate update(s)`)
  }
  const updates = new Map(input.inputs.map((candidate) => [candidate.directionId, candidate]))
  if (
    updates.size !== input.inputs.length ||
    updates.size !== targetIds.length ||
    updates.has(undefined) ||
    [...updates.keys()].some((id) => !id || !targetIds.includes(id)) ||
    targetIds.some((id) => !updates.has(id))
  ) {
    throw new Error('direction revisions must use the persisted target directionId values')
  }
  return input.existing.directions.candidates.map((candidate) => {
    const update = updates.get(candidate.directionId)
    return update
      ? PptDirectionCandidate.parse({
          ...update,
          directionId: candidate.directionId,
          revision: candidate.revision + 1,
          ...(targetIds.length === 1 ? { recommended: candidate.recommended } : {})
        })
      : candidate
  })
}

function disabledResult(): { output: { error: string }; isError: true } {
  return { output: { error: 'PPT Agent is disabled in Lab settings' }, isError: true }
}

function errorResult(error: string): { output: { error: string }; isError: true } {
  return { output: { error }, isError: true }
}
