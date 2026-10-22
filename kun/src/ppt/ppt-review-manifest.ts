import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { PptDesignGovernanceSnapshot } from './ppt-design-governance.js'
import {
  PPT_GEOMETRY_QA_RELATIVE_PATH,
  PptGeometryQaCounts,
  PptGeometryQaIssueV1
} from './ppt-geometry-qa-report.js'
import {
  PptDirectionBundleV1,
  PptDirectionState,
  PptWorkspaceRelativePath,
  pptDirectionCandidateFingerprint,
  pptDirectionPlanFingerprint,
  pptDirectionSlidesFingerprint,
  pptDirectionSummary,
  samePptDirectionPlan
} from './ppt-direction-workflow.js'

export const PPT_REVIEW_MANIFEST_VERSION = 3 as const
export const PPT_REVIEW_GOVERNED_MANIFEST_VERSION = 2 as const
export const PPT_REVIEW_LEGACY_MANIFEST_VERSION = 1 as const

const WorkspaceRelativePath = PptWorkspaceRelativePath

export const PptWorkflowPhase = z.enum([
  'planning',
  'awaiting_direction',
  'revising_directions',
  'generating_previews',
  'awaiting_review',
  'revising_previews',
  'retrying_failed',
  'building_deck',
  'validating_deck',
  'completed',
  'failed_recoverable',
  'cancelled',
  'direct_build'
])
export type PptWorkflowPhase = z.infer<typeof PptWorkflowPhase>

export const PptReviewSlideStatus = z.enum(['pending', 'generating', 'ready', 'failed', 'approved'])
export type PptReviewSlideStatus = z.infer<typeof PptReviewSlideStatus>

export const PptPreviewMode = z.enum(['image-first', 'editable'])
export type PptPreviewMode = z.infer<typeof PptPreviewMode>

export const PptStyleSpec = z.object({
  fingerprint: z.string().min(1),
  fonts: z.array(z.string().min(1)).default([]),
  colorTokens: z.record(z.string(), z.string()).default({}),
  typeScale: z.record(z.string(), z.number().positive()).default({}),
  spacingScale: z.array(z.number().nonnegative()).default([]),
  backgroundLanguage: z.string().default(''),
  imageTreatment: z.string().default(''),
  chartTreatment: z.string().default(''),
  anchorImagePath: WorkspaceRelativePath.optional()
}).strict()
export type PptStyleSpec = z.infer<typeof PptStyleSpec>

export const PptGeometryQaManifestProjection = z.object({
  reportPath: z.literal(PPT_GEOMETRY_QA_RELATIVE_PATH),
  attempt: z.number().int().min(0).max(2),
  counts: PptGeometryQaCounts
}).strict()
export type PptGeometryQaManifestProjection = z.infer<typeof PptGeometryQaManifestProjection>

/** Where an image used on a slide came from: user material, a generated supplement, or already in the project. */
const UnitInterval = z.number().min(0).max(1)

export const PptSlideAsset = z.object({
  path: WorkspaceRelativePath,
  origin: z.enum(['user', 'generated', 'project']),
  /** Image slot on the slide as fractions of the page size, for whiteboard overlays. */
  rect: z.object({ x: UnitInterval, y: UnitInterval, width: UnitInterval, height: UnitInterval }).strict()
    .refine((rect) => rect.x + rect.width <= 1.000_001 && rect.y + rect.height <= 1.000_001, {
      message: 'image slot must stay inside the slide'
    })
    .optional()
}).strict()
export type PptSlideAsset = z.infer<typeof PptSlideAsset>

export const PptReviewSlide = z.object({
  slideId: z.string().min(1),
  index: z.number().int().nonnegative(),
  title: z.string().min(1),
  pagePath: WorkspaceRelativePath.optional(),
  layoutSpecPath: WorkspaceRelativePath,
  previewPath: WorkspaceRelativePath.optional(),
  revision: z.number().int().nonnegative(),
  status: PptReviewSlideStatus,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().min(1).optional(),
  qaIssues: z.array(PptGeometryQaIssueV1).optional(),
  assets: z.array(PptSlideAsset).max(32).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  promptHash: z.string().min(1)
}).strict().superRefine((slide, ctx) => {
  slide.qaIssues?.forEach((issue, index) => {
    if (issue.slideIndex !== slide.index) {
      ctx.addIssue({ code: 'custom', path: ['qaIssues', index, 'slideIndex'], message: 'QA issue must belong to this slide' })
    }
  })
})
export type PptReviewSlide = z.infer<typeof PptReviewSlide>

export const PptReviewManifestV1 = z.object({
  version: z.union([
    z.literal(PPT_REVIEW_LEGACY_MANIFEST_VERSION),
    z.literal(PPT_REVIEW_GOVERNED_MANIFEST_VERSION),
    z.literal(PPT_REVIEW_MANIFEST_VERSION)
  ]),
  workflowId: z.string().min(1),
  parentThreadId: z.string().min(1),
  childId: z.string().min(1),
  projectDir: WorkspaceRelativePath,
  previewMode: PptPreviewMode.optional(),
  phase: PptWorkflowPhase,
  deck: z.object({
    title: z.string().min(1),
    aspectRatio: z.literal('16:9'),
    slideCount: z.number().int().positive()
  }).strict(),
  styleSpec: PptStyleSpec,
  directions: PptDirectionState.optional(),
  governance: PptDesignGovernanceSnapshot.optional(),
  qa: PptGeometryQaManifestProjection.optional(),
  validatedExport: z.object({
    output: WorkspaceRelativePath,
    planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    slides: z.number().int().positive(),
    qa: PptGeometryQaManifestProjection.optional()
  }).strict().optional(),
  slides: z.array(PptReviewSlide).min(1),
  board: z.object({
    artifactId: z.string().min(1),
    lastAppliedRevision: z.number().int().nonnegative()
  }).strict().optional()
}).strict().superRefine((manifest, ctx) => {
  if (manifest.version === PPT_REVIEW_GOVERNED_MANIFEST_VERSION && !manifest.governance) {
    ctx.addIssue({ code: 'custom', path: ['governance'], message: 'version 2 manifests require design governance' })
  }
  if (manifest.version >= PPT_REVIEW_GOVERNED_MANIFEST_VERSION && !manifest.previewMode) {
    ctx.addIssue({ code: 'custom', path: ['previewMode'], message: 'governed manifests require a stable preview mode' })
  }
  if (manifest.version !== PPT_REVIEW_MANIFEST_VERSION && manifest.directions) {
    ctx.addIssue({ code: 'custom', path: ['directions'], message: 'visual directions require manifest version 3' })
  }
  if (manifest.version === PPT_REVIEW_MANIFEST_VERSION) {
    const directionPhase = manifest.phase === 'awaiting_direction' || manifest.phase === 'revising_directions'
    if (directionPhase && (!manifest.directions || manifest.governance)) {
      ctx.addIssue({
        code: 'custom',
        path: ['directions'],
        message: 'direction phases require candidates and must not claim design governance'
      })
    }
    if (directionPhase && (manifest.validatedExport || manifest.qa)) {
      ctx.addIssue({
        code: 'custom',
        path: ['validatedExport'],
        message: 'direction phases cannot claim export or geometry QA validation'
      })
    }
    if (!directionPhase && !manifest.governance) {
      ctx.addIssue({ code: 'custom', path: ['governance'], message: 'version 3 review phases require design governance' })
    }
    if (manifest.directions && manifest.governance) {
      const selected = manifest.directions.candidates.find((candidate) =>
        candidate.directionId === manifest.directions?.selectedDirectionId)
      if (!selected) {
        ctx.addIssue({
          code: 'custom',
          path: ['directions', 'selectedDirectionId'],
          message: 'governed version 3 directions require one validated selection'
        })
      } else if (!samePptDirectionPlan(selected.plan, manifest.governance.designPlan)) {
        ctx.addIssue({
          code: 'custom',
          path: ['directions', 'selectedDirectionId'],
          message: 'selected direction does not match the governed design plan'
        })
      }
    }
  }
  if (
    manifest.validatedExport &&
    manifest.governance &&
    manifest.validatedExport.planFingerprint !== manifest.governance.designPlan.fingerprint
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['validatedExport', 'planFingerprint'],
      message: 'validated export must use the current governed design plan'
    })
  }
  if (manifest.validatedExport?.qa && manifest.validatedExport.qa.counts.errors > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['validatedExport', 'qa', 'counts', 'errors'],
      message: 'validated export cannot contain geometry QA errors'
    })
  }
  if (manifest.validatedExport?.qa && manifest.qa &&
    JSON.stringify(manifest.validatedExport.qa) !== JSON.stringify(manifest.qa)) {
    ctx.addIssue({
      code: 'custom',
      path: ['validatedExport', 'qa'],
      message: 'validated export QA must match the current manifest QA projection'
    })
  }
  if (manifest.validatedExport?.qa && !manifest.qa) {
    ctx.addIssue({
      code: 'custom',
      path: ['validatedExport', 'qa'],
      message: 'validated export QA requires the current manifest QA projection'
    })
  }
  if (manifest.phase === 'completed' && manifest.qa && manifest.qa.counts.errors > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['qa', 'counts', 'errors'],
      message: 'completed PPT workflow cannot contain geometry QA errors'
    })
  }
  if (manifest.deck.slideCount !== manifest.slides.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['deck', 'slideCount'],
      message: 'slideCount must match the number of manifest slides'
    })
  }
  const slideIds = new Set<string>()
  const indexes = new Set<number>()
  for (const [position, slide] of manifest.slides.entries()) {
    if (slideIds.has(slide.slideId)) {
      ctx.addIssue({ code: 'custom', path: ['slides', position, 'slideId'], message: 'slideId must be unique' })
    }
    if (indexes.has(slide.index)) {
      ctx.addIssue({ code: 'custom', path: ['slides', position, 'index'], message: 'slide index must be unique' })
    }
    slideIds.add(slide.slideId)
    indexes.add(slide.index)
  }
  for (let index = 0; index < manifest.slides.length; index += 1) {
    if (!indexes.has(index)) {
      ctx.addIssue({ code: 'custom', path: ['slides'], message: 'slide indexes must be contiguous from zero' })
      break
    }
  }
  const projectedIssues = manifest.slides.flatMap((slide) => slide.qaIssues ?? [])
  if (!manifest.qa && projectedIssues.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['slides'], message: 'slide QA issues require a manifest QA projection' })
  }
  if (manifest.qa) {
    if (manifest.slides.some((slide) => slide.qaIssues === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['slides'], message: 'QA projection must replace issues for every slide' })
    }
    const projectedCounts = {
      errors: projectedIssues.filter((issue) => issue.severity === 'error').length,
      warnings: projectedIssues.filter((issue) => issue.severity === 'warning').length,
      unchecked: projectedIssues.filter((issue) => issue.severity === 'unchecked').length,
      total: projectedIssues.length
    }
    for (const key of ['errors', 'warnings', 'unchecked', 'total'] as const) {
      if (projectedCounts[key] !== manifest.qa.counts[key]) {
        ctx.addIssue({
          code: 'custom',
          path: ['qa', 'counts', key],
          message: `manifest QA count must match slide issues (${projectedCounts[key]})`
        })
      }
    }
  }
})
export type PptReviewManifestV1 = z.infer<typeof PptReviewManifestV1>

export const PptReviewBundleV1 = z.object({
  workflowId: z.string().min(1),
  childId: z.string().min(1),
  manifestPath: WorkspaceRelativePath,
  previewMode: PptPreviewMode.optional(),
  deckTitle: z.string().min(1),
  styleFingerprint: z.string().min(1),
  designGovernance: z.object({
    policyVersion: z.string().min(1),
    policyHash: z.string().regex(/^[a-f0-9]{64}$/),
    category: z.string().min(1),
    categoryGuide: z.string().min(1),
    planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    planRevision: z.number().int().positive()
  }).strict().optional(),
  phase: PptWorkflowPhase,
  slides: z.array(z.object({
    slideId: z.string().min(1),
    index: z.number().int().nonnegative(),
    title: z.string().min(1),
    previewPath: WorkspaceRelativePath.optional(),
    revision: z.number().int().nonnegative(),
    status: z.enum(['ready', 'failed']),
    error: z.string().min(1).optional(),
    qaIssues: z.array(PptGeometryQaIssueV1).optional(),
    assets: z.array(PptSlideAsset).max(32).optional()
  }).strict()).min(1)
}).strict().superRefine((bundle, ctx) => {
  const slideIds = new Set<string>()
  const indexes = new Set<number>()
  for (const [position, slide] of bundle.slides.entries()) {
    if (slideIds.has(slide.slideId)) {
      ctx.addIssue({ code: 'custom', path: ['slides', position, 'slideId'], message: 'slideId must be unique' })
    }
    slideIds.add(slide.slideId)
    if (indexes.has(slide.index)) {
      ctx.addIssue({ code: 'custom', path: ['slides', position, 'index'], message: 'slide index must be unique' })
    }
    indexes.add(slide.index)
    if (slide.status === 'ready' && !slide.previewPath) {
      ctx.addIssue({ code: 'custom', path: ['slides', position, 'previewPath'], message: 'ready slides require previewPath' })
    }
    slide.qaIssues?.forEach((issue, issueIndex) => {
      if (issue.slideIndex !== slide.index) {
        ctx.addIssue({
          code: 'custom',
          path: ['slides', position, 'qaIssues', issueIndex, 'slideIndex'],
          message: 'QA issue must belong to this slide'
        })
      }
    })
  }
  for (let index = 0; index < bundle.slides.length; index += 1) {
    if (!indexes.has(index)) {
      ctx.addIssue({ code: 'custom', path: ['slides'], message: 'slide indexes must be contiguous from zero' })
      break
    }
  }
})
export type PptReviewBundleV1 = z.infer<typeof PptReviewBundleV1>

export type PptReviewContextV1 = {
  workflowId: string
  slides: Array<{
    slideId: string
    revision: number
    feedback?: string
    annotations?: string[]
    imagePath?: string
  }>
}

export function reviewDirectory(projectAbsolutePath: string): string {
  return resolve(projectAbsolutePath, '.kun-ppt-review')
}

export function reviewManifestPath(projectAbsolutePath: string): string {
  return resolve(reviewDirectory(projectAbsolutePath), 'manifest.json')
}

export function createPptReviewManifest(input: {
  workflowId?: string
  parentThreadId: string
  childId: string
  projectDir: string
  previewMode?: PptPreviewMode
  phase?: PptWorkflowPhase
  deckTitle: string
  styleSpec: Omit<PptStyleSpec, 'fingerprint'> & { fingerprint?: string }
  governance?: PptDesignGovernanceSnapshot
  directions?: PptDirectionState
  slides: Array<{ slideId?: string; title: string; layoutSpecPath?: string; prompt: string }>
}): PptReviewManifestV1 {
  const workflowId = input.workflowId?.trim() || `ppt_${randomUUID()}`
  const styleSpec = PptStyleSpec.parse({
    ...input.styleSpec,
    fingerprint: input.styleSpec.fingerprint?.trim() || fingerprint(input.styleSpec)
  })
  return PptReviewManifestV1.parse({
    version: input.governance || input.directions
      ? PPT_REVIEW_MANIFEST_VERSION
      : PPT_REVIEW_LEGACY_MANIFEST_VERSION,
    workflowId,
    parentThreadId: input.parentThreadId,
    childId: input.childId,
    projectDir: input.projectDir,
    ...(input.governance ? { previewMode: input.previewMode ?? 'editable' } : input.previewMode ? { previewMode: input.previewMode } : {}),
    phase: input.phase ?? 'planning',
    deck: { title: input.deckTitle, aspectRatio: '16:9', slideCount: input.slides.length },
    styleSpec,
    ...(input.directions ? { directions: input.directions } : {}),
    ...(input.governance ? { governance: input.governance } : {}),
    slides: input.slides.map((slide, index) => ({
      slideId: slide.slideId?.trim() || `${workflowId}-slide-${index + 1}`,
      index,
      title: slide.title,
      layoutSpecPath: slide.layoutSpecPath?.trim() || `.kun-ppt-review/layouts/slide-${index + 1}.json`,
      revision: 0,
      status: 'pending',
      attempts: 0,
      contentHash: pptReviewContentHash(slide.prompt),
      promptHash: pptReviewPromptHash(styleSpec, slide.prompt)
    }))
  })
}

export function toPptDirectionBundle(
  manifest: PptReviewManifestV1,
  manifestPath: string
): PptDirectionBundleV1 {
  if (manifest.version !== PPT_REVIEW_MANIFEST_VERSION || !manifest.previewMode || !manifest.directions) {
    throw new Error('PPT review manifest has no governed visual directions')
  }
  const recommended = manifest.directions.candidates.find((candidate) => candidate.recommended)
  return PptDirectionBundleV1.parse({
    schemaVersion: 1,
    workflowId: manifest.workflowId,
    childId: manifest.childId,
    manifestPath,
    previewMode: manifest.previewMode,
    deckTitle: manifest.deck.title,
    phase: 'awaiting_direction',
    recommendedDirectionId: recommended?.directionId,
    slidesFingerprint: pptDirectionSlidesFingerprint(manifest.slides),
    slides: manifest.slides.map((slide) => ({
      slideId: slide.slideId,
      index: slide.index,
      title: slide.title,
      promptHash: slide.contentHash ?? slide.promptHash
    })),
    directions: manifest.directions.candidates.map((candidate) => ({
      directionId: candidate.directionId,
      name: candidate.name,
      rationale: candidate.rationale,
      revision: candidate.revision,
      recommended: candidate.recommended,
      planFingerprint: pptDirectionPlanFingerprint(candidate.plan),
      candidateFingerprint: pptDirectionCandidateFingerprint(candidate),
      ...pptDirectionSummary(candidate.plan),
      previews: candidate.previews
    }))
  })
}

export async function readPptReviewManifest(projectAbsolutePath: string): Promise<PptReviewManifestV1 | undefined> {
  try {
    return PptReviewManifestV1.parse(JSON.parse(await readFile(reviewManifestPath(projectAbsolutePath), 'utf8')))
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

export async function writePptReviewManifest(
  projectAbsolutePath: string,
  manifest: PptReviewManifestV1
): Promise<void> {
  const destination = reviewManifestPath(projectAbsolutePath)
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(PptReviewManifestV1.parse(manifest), null, 2)}\n`, 'utf8')
  await rename(temporary, destination)
}

export function toPptReviewBundle(
  manifest: PptReviewManifestV1,
  manifestPath: string
): PptReviewBundleV1 {
  return PptReviewBundleV1.parse({
    workflowId: manifest.workflowId,
    childId: manifest.childId,
    manifestPath,
    ...(manifest.previewMode ? { previewMode: manifest.previewMode } : {}),
    deckTitle: manifest.deck.title,
    styleFingerprint: manifest.styleSpec.fingerprint,
    ...(manifest.governance
      ? {
          designGovernance: {
            policyVersion: manifest.governance.policy.version,
            policyHash: manifest.governance.policy.sha256,
            category: manifest.governance.category,
            categoryGuide: manifest.governance.categoryGuide,
            planFingerprint: manifest.governance.designPlan.fingerprint,
            planRevision: manifest.governance.planRevision
          }
        }
      : {}),
    phase: manifest.phase,
    slides: manifest.slides.map((slide) => ({
      slideId: slide.slideId,
      index: slide.index,
      title: slide.title,
      ...(slide.previewPath ? { previewPath: slide.previewPath } : {}),
      revision: slide.revision,
      status: slide.status === 'failed' ? 'failed' : 'ready',
      ...(slide.lastError ? { error: slide.lastError } : {}),
      ...(slide.qaIssues ? { qaIssues: slide.qaIssues } : {}),
      ...(slide.assets?.length ? { assets: slide.assets } : {})
    }))
  })
}

export function assertWorkspaceRelativePath(path: string, workspaceRoot: string): string {
  if (!PptWorkspaceRelativePath.safeParse(path).success) throw new Error('path must be workspace-relative')
  const absolute = resolve(workspaceRoot, path)
  const outside = relative(workspaceRoot, absolute)
  if (outside.startsWith('..') || isAbsolute(outside)) throw new Error('path escapes the active workspace')
  return absolute
}

export function pptReviewPromptHash(styleSpec: PptStyleSpec, prompt: string): string {
  return fingerprint({ styleSpec, prompt })
}

export function pptReviewContentHash(prompt: string): string {
  return fingerprint({ prompt })
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}
