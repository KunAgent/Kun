import { createHash } from 'node:crypto'
import { isAbsolute, win32 } from 'node:path'
import { z } from 'zod'
import { PptDesignPlanInput, type PptDesignPlanInput as PptDesignPlanValue } from './ppt-design-governance.js'

export const PptWorkspaceRelativePath = z.string().min(1).refine(isPortableWorkspaceRelativePath, {
  message: 'path must be workspace-relative and must not escape the workspace'
})

export const PptDirectionGateReason = z.enum([
  'existing-presentation',
  'explicit-skip',
  'work-document',
  'design-reference',
  'complete-visual-system',
  'underspecified-new-deck'
])
export type PptDirectionGateReason = z.infer<typeof PptDirectionGateReason>

export const PptDirectionGateDecision = z.object({
  required: z.boolean(),
  reason: PptDirectionGateReason,
  basis: z.string().trim().min(1).max(240),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict().superRefine((gate, ctx) => {
  if (gate.required !== (gate.reason === 'underspecified-new-deck')) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'gate reason does not match required state' })
  }
})
export type PptDirectionGateDecision = z.infer<typeof PptDirectionGateDecision>

export const PptDirectionPreviewRole = z.enum(['cover', 'representative', 'complex'])

export const PptDirectionCandidate = z.object({
  directionId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(80),
  rationale: z.string().trim().min(8).max(500),
  revision: z.number().int().positive(),
  recommended: z.boolean(),
  plan: PptDesignPlanInput,
  /** Editable 3-page sample deck the previews were rendered from (absent on legacy generated-image directions). */
  sampleProject: PptWorkspaceRelativePath.optional(),
  previews: z.array(z.object({
    role: PptDirectionPreviewRole,
    imagePath: PptWorkspaceRelativePath,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }).strict()).length(3).superRefine((previews, ctx) => {
    const roles = new Set(previews.map((preview) => preview.role))
    for (const role of PptDirectionPreviewRole.options) {
      if (!roles.has(role)) ctx.addIssue({ code: 'custom', message: `missing ${role} preview` })
    }
    previews.forEach((preview, index) => {
      const ratioError = Math.abs(preview.width / preview.height - 16 / 9) / (16 / 9)
      if (ratioError > 0.01) {
        ctx.addIssue({ code: 'custom', path: [index], message: 'direction preview must use a 16:9 aspect ratio' })
      }
    })
  })
}).strict()
export type PptDirectionCandidate = z.infer<typeof PptDirectionCandidate>

export const PptDirectionState = z.object({
  gate: PptDirectionGateDecision,
  selectedDirectionId: z.string().trim().min(1).max(120).optional(),
  candidates: z.array(PptDirectionCandidate).length(3)
}).strict().superRefine((state, ctx) => {
  if (!state.gate.required) {
    ctx.addIssue({ code: 'custom', path: ['gate'], message: 'persisted direction candidates require a direction gate' })
  }
  const ids = new Set<string>()
  const visualFingerprints = new Set<string>()
  const contentFingerprints = new Set<string>()
  const visualDimensions: string[][] = []
  const previewPaths = new Set<string>()
  const previewHashes = new Set<string>()
  let recommendations = 0
  for (const [index, candidate] of state.candidates.entries()) {
    if (ids.has(candidate.directionId)) {
      ctx.addIssue({ code: 'custom', path: ['candidates', index, 'directionId'], message: 'directionId must be unique' })
    }
    ids.add(candidate.directionId)
    if (candidate.recommended) recommendations += 1
    const visual = pptDirectionVisualFingerprint(candidate.plan)
    if (visualFingerprints.has(visual)) {
      ctx.addIssue({ code: 'custom', path: ['candidates', index, 'plan'], message: 'candidate visual systems must be distinct' })
    }
    visualFingerprints.add(visual)
    visualDimensions.push(pptDirectionVisualDimensions(candidate.plan))
    contentFingerprints.add(pptDirectionContentFingerprint(candidate.plan))
    for (const [previewIndex, preview] of candidate.previews.entries()) {
      if (previewPaths.has(preview.imagePath)) {
        ctx.addIssue({
          code: 'custom',
          path: ['candidates', index, 'previews', previewIndex, 'imagePath'],
          message: 'each direction preview must be a distinct rendered sample page'
        })
      }
      previewPaths.add(preview.imagePath)
      if (previewHashes.has(preview.sha256)) {
        ctx.addIssue({
          code: 'custom',
          path: ['candidates', index, 'previews', previewIndex, 'sha256'],
          message: 'each direction preview must have distinct image content'
        })
      }
      previewHashes.add(preview.sha256)
    }
  }
  if (recommendations !== 1) {
    ctx.addIssue({ code: 'custom', path: ['candidates'], message: 'exactly one direction must be recommended' })
  }
  if (contentFingerprints.size !== 1) {
    ctx.addIssue({ code: 'custom', path: ['candidates'], message: 'direction candidates must share audience, purpose, and page strategy' })
  }
  for (let left = 0; left < visualDimensions.length; left += 1) {
    for (let right = left + 1; right < visualDimensions.length; right += 1) {
      const differences = visualDimensions[left].filter((value, index) => value !== visualDimensions[right][index]).length
      if (differences < 3) {
        ctx.addIssue({
          code: 'custom',
          path: ['candidates', right, 'plan'],
          message: 'direction candidates must differ across at least three visual-system dimensions'
        })
      }
    }
  }
  if (state.selectedDirectionId && !ids.has(state.selectedDirectionId)) {
    ctx.addIssue({ code: 'custom', path: ['selectedDirectionId'], message: 'selected direction must name a persisted candidate' })
  }
})
export type PptDirectionState = z.infer<typeof PptDirectionState>

export const PptDirectionBundleV1 = z.object({
  schemaVersion: z.literal(1),
  workflowId: z.string().min(1),
  childId: z.string().min(1),
  manifestPath: PptWorkspaceRelativePath,
  previewMode: z.enum(['image-first', 'editable']),
  deckTitle: z.string().min(1),
  phase: z.literal('awaiting_direction'),
  recommendedDirectionId: z.string().min(1),
  slidesFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  slides: z.array(z.object({
    slideId: z.string().min(1),
    index: z.number().int().nonnegative(),
    title: z.string().min(1),
    promptHash: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict()).min(1),
  directions: z.array(z.object({
    directionId: z.string().min(1),
    name: z.string().min(1),
    rationale: z.string().min(1),
    revision: z.number().int().positive(),
    recommended: z.boolean(),
    planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    candidateFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    fonts: z.array(z.string().min(1)).min(2),
    colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(4),
    layout: z.string().min(1),
    background: z.string().min(1),
    imagery: z.string().min(1),
    previews: z.array(z.object({
      role: PptDirectionPreviewRole,
      imagePath: PptWorkspaceRelativePath,
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      width: z.number().int().positive(),
      height: z.number().int().positive()
    }).strict()).length(3)
  }).strict()).length(3)
}).strict().superRefine((bundle, ctx) => {
  const slideIndexes = new Set(bundle.slides.map((slide) => slide.index))
  const slideIds = new Set<string>()
  for (const [index, slide] of bundle.slides.entries()) {
    if (slideIds.has(slide.slideId)) {
      ctx.addIssue({ code: 'custom', path: ['slides', index, 'slideId'], message: 'slideId must be unique' })
    }
    slideIds.add(slide.slideId)
  }
  for (let index = 0; index < bundle.slides.length; index += 1) {
    if (!slideIndexes.has(index)) ctx.addIssue({ code: 'custom', path: ['slides'], message: 'slide indexes must be contiguous from zero' })
  }
  if (bundle.slidesFingerprint !== pptDirectionSlidesFingerprint(bundle.slides)) {
    ctx.addIssue({ code: 'custom', path: ['slidesFingerprint'], message: 'slide fingerprint does not match the persisted slide plan' })
  }
  const recommended = bundle.directions.filter((direction) => direction.recommended)
  if (recommended.length !== 1 || recommended[0].directionId !== bundle.recommendedDirectionId) {
    ctx.addIssue({ code: 'custom', path: ['recommendedDirectionId'], message: 'recommended direction identity is invalid' })
  }
  const directionIds = new Set<string>()
  for (const [index, direction] of bundle.directions.entries()) {
    if (directionIds.has(direction.directionId)) {
      ctx.addIssue({ code: 'custom', path: ['directions', index, 'directionId'], message: 'directionId must be unique' })
    }
    directionIds.add(direction.directionId)
    const roles = new Set(direction.previews.map((preview) => preview.role))
    if (roles.size !== 3) {
      ctx.addIssue({ code: 'custom', path: ['directions', index, 'previews'], message: 'all preview roles are required' })
    }
  }
})
export type PptDirectionBundleV1 = z.infer<typeof PptDirectionBundleV1>

export function classifyPptDirectionGate(input: {
  prompt: string
  fileReferences?: ReadonlyArray<{ name: string; relativePath: string }>
  attachmentIds?: readonly string[]
  agentSurface?: 'code' | 'write' | 'design'
}): PptDirectionGateDecision {
  const prompt = input.prompt.trim()
  const sourceHash = fingerprint({
    prompt,
    fileReferences: (input.fileReferences ?? []).map((file) => ({
      name: file.name,
      relativePath: file.relativePath
    })),
    attachmentIds: [...(input.attachmentIds ?? [])]
  })
  const files = (input.fileReferences ?? []).map((file) => `${file.name} ${file.relativePath}`).join(' ')
  const combined = `${prompt}\n${files}`
  const workMarkdownSource = input.agentSurface === 'write' && /\.(?:md|markdown)\b/i.test(files)
  const workDocumentDeckRequest = workMarkdownSource && (
    /\b(?:presentation|deck|slides?)\b/i.test(prompt) &&
      /\b(?:this|current|active|the)\s+(?:document|file|markdown|draft)\b/i.test(prompt) ||
    /(?:这个|该|当前|这份|本)(?:文档|文件|Markdown|稿件).{0,24}(?:PPT|演示文稿|幻灯片)|(?:把|将|给).{0,12}(?:这个|该|当前|这份|本)?(?:文档|文件|Markdown|稿件).{0,24}(?:做成|制成|写成|生成|制作|写个|做个)?.{0,8}(?:PPT|演示文稿|幻灯片)/i.test(prompt)
  )
  if (workDocumentDeckRequest) return {
    required: false,
    reason: 'work-document',
    basis: 'A Work request converts the active Markdown document and delegates the visual system automatically.',
    sourceHash
  }
  const explicitlyCreatesDeck =
    /^\s*(?:please\s+)?(?:create|make|build|prepare|draft|design)\b.{0,32}\b(?:deck|presentation|slides?)\b/i.test(prompt) ||
    /^\s*(?:请|帮我|麻烦)?\s*(?:新建|创建|制作|做|生成|设计).{0,24}(?:PPT|演示文稿|幻灯片)/i.test(prompt)
  const existingDeck = /\.(?:pptx?|pptd)\b/i.test(files) ||
    /\b(?:edit|revise|modify|continue|replicate|recreate)\b.{0,24}\b(?:the )?(?:attached|existing|current|original|previous)\s+(?:deck|presentation|slides?)\b/i.test(prompt) ||
    /\b(?:the )?(?:existing|current|original|previous)\s+(?:deck|presentation|slides?)\b/i.test(prompt) ||
    /(?:修改|编辑|延续|继续|复刻|仿制).{0,16}(?:附件中?的?|现有|当前|原有|原始|之前的?)(?:PPT|演示文稿|幻灯片)/i.test(prompt) ||
    /(?:现有|当前|原有|原始|之前的?)(?:PPT|演示文稿|幻灯片)/i.test(prompt)
  if (
    existingDeck || (!explicitlyCreatesDeck && (
      /(?:^|\b(?:can you|please|we need to|i want to)\s+)(?:edit|revise|update|modify|rework|extend)\b.{0,24}\b(?:(?:the|this|that|my|our|current|existing|attached)\s+)?(?:deck|presentation|slides?)\b/i.test(prompt) ||
      /\b(?:edit|revise|update|modify|rework|extend|continue)\b.{0,16}\b(?:this|that|the|my|our|current|existing|attached)\s+(?:deck|presentation|slides?)\b/i.test(prompt) ||
      /\b(?:replicate|recreate|continue)\b.{0,32}\b(?:deck|presentation|slides?)\b/i.test(prompt) ||
      /(?:复刻|仿制|延续|续写|继续|修改|调整|优化|改造|编辑|更新).{0,12}(?:这个|该|现有|当前|原有)?\s*(?:PPT|演示文稿|幻灯片)/i.test(prompt) ||
      /(?:把|将)?\s*(?:这个|该|现有|当前|原有)\s*(?:PPT|演示文稿|幻灯片).{0,12}(?:复刻|仿制|延续|续写|继续|修改|调整|优化|改造|编辑|更新)/i.test(prompt)
    ))
  ) return {
    required: false,
    reason: 'existing-presentation',
    basis: 'The request edits, replicates, or continues an existing presentation.',
    sourceHash
  }
  const explicitlyWantsDirections =
    /\b(?:do not|don't|never)\s+(?:skip|bypass)\b.{0,32}\b(?:direction|style option|concept option)\b/i.test(prompt) ||
    /(?:不要|别|不得).{0,6}(?:跳过|省略).{0,10}(?:方向|方案|风格)(?:选择|选项)?/i.test(prompt) ||
    /(?:不要|别).{0,4}直接生成|先.{0,8}(?:展示|给我|提供|看).{0,8}(?:方向|方案|风格)(?:选择|选项)?/i.test(prompt)
  const rejectsExistingStyle =
    /\b(?:do not|don't|never)\s+(?:keep|preserve|retain|use)\b.{0,20}\b(?:the )?(?:existing|original|same) style\b/i.test(prompt) ||
    /(?:不要|别|不再).{0,6}(?:保持|沿用|保留).{0,12}(?:原有|原来|现有|当前)?风格/i.test(prompt)
  if (!explicitlyWantsDirections && !rejectsExistingStyle && (
    /\b(?:skip|bypass|do not show|don't show|no need for)\b.{0,32}\b(?:direction|style option|concept option)\b/i.test(prompt) ||
    /\b(?:keep|preserve|retain|use)\b.{0,20}\b(?:the )?(?:existing|original|same) style\b/i.test(prompt) ||
    /跳过.{0,10}(?:方向|方案|风格)(?:选择|选项)|无需.{0,10}(?:方向|方案|风格)(?:选择|选项)|直接生成|保持原有?风格|沿用.{0,12}风格/i.test(prompt)
  )) return {
    required: false,
    reason: 'explicit-skip',
    basis: 'The source explicitly skips direction selection or preserves the current style.',
    sourceHash
  }
  const referenceFile = /(?:DESIGN_SYSTEM\.md|(?:brand|style)[-_ ]?(?:guide|manual)\.(?:md|pdf|docx?)|(?:design|visual)[-_ ]?reference\.(?:png|jpe?g|webp|pdf)|\.potx\b|\.thmx\b)/i.test(files)
  const imageReferenceFile = /\.(?:png|jpe?g|webp|gif|svg)\b/i.test(files)
  const explicitlyUsesImageReference = imageReferenceFile && (
    /\b(?:follow|match)\b.{0,36}\b(?:attached|this|the|provided)?\s*(?:image|screenshot|moodboard|visual reference|reference image|visual style)\b/i.test(prompt) ||
    /\b(?:use|apply)\b.{0,36}\b(?:attached|this|the|provided)?\s*(?:image|screenshot|moodboard)\b.{0,24}\b(?:as|for)\b.{0,16}\b(?:visual style|style reference|design reference|visual language|look and feel)\b/i.test(prompt) ||
    /(?:按照|参照|匹配).{0,18}(?:这个|该|附件|提供的)?(?:设计图|参考图|视觉参考|风格参考)/i.test(prompt) ||
    /(?:使用|采用).{0,18}(?:这个|该|附件|提供的)?(?:图片|截图|设计图).{0,12}(?:作为|用作).{0,10}(?:风格|设计|视觉)(?:参考|依据)?/i.test(prompt)
  )
  const deniesReference = /\b(?:no|without|do not have|don't have)\b.{0,24}\b(?:template|brand (?:guide|manual)|design system|style guide|reference)\b/i.test(prompt) ||
    /(?:没有|无|未提供).{0,12}(?:模板|品牌手册|设计系统|视觉规范|参考图|设计参考)/i.test(prompt)
  if (
    referenceFile || explicitlyUsesImageReference || (!deniesReference && (
      /\b(?:use|follow|apply|attached|provided)\b.{0,32}\b(?:template|brand (?:guide|manual)|design system|style guide|reference (?:design|image|style))\b/i.test(prompt) ||
      /(?:使用|遵循|按照|参照|附件|已提供).{0,18}(?:模板|品牌手册|设计系统|视觉规范|参考.{0,8}(?:图|设计|风格))/i.test(prompt)
    ))
  ) return {
    required: false,
    reason: 'design-reference',
    basis: 'A template, brand/design system, or visual reference is already authoritative.',
    sourceHash
  }
  const hasFont = /(?:font|typeface|字体|字族)\s*(?:[:=：]|is|用|为)\s*[\w\p{L}][\w\p{L} .-]{1,40}/iu.test(prompt) ||
    /\b(?:use|using)\s+[\w.-]{2,30}\s+(?:font|typeface)\b/i.test(prompt)
  const hasPalette = /#[0-9a-f]{6}\b/i.test(prompt) || /(?:palette|color scheme|配色|色板)\s*(?:[:=：]|is|用|为)\s*[^,，。;；]{2,50}/iu.test(prompt)
  const hasLayout = /(?:layout|grid|columns?|版式|网格|栏布局|页面结构)\s*(?:[:=：]|is|用|为)\s*[^,，。;；]{2,60}/iu.test(prompt) ||
    /\b\d{1,2}[- ]column\s+(?:grid|layout)\b/i.test(prompt)
  const hasImagery = /(?:imagery|photography|illustration|image treatment|图像策略|摄影|插画|图片风格)\s*(?:[:=：]|is|用|为)\s*[^,，。;；]{2,60}/iu.test(prompt) ||
    /\b(?:documentary|editorial|product|architectural|abstract|minimal)\s+(?:photography|illustration|imagery)\b/i.test(prompt)
  if (hasFont && hasPalette && hasLayout && hasImagery) {
    return {
      required: false,
      reason: 'complete-visual-system',
      basis: 'The source specifies typography, palette, layout, and imagery strategy.',
      sourceHash
    }
  }
  return {
    required: true,
    reason: 'underspecified-new-deck',
    basis: 'This is a new presentation without a complete visual authority.',
    sourceHash
  }
}

export function pptDirectionContentFingerprint(plan: PptDesignPlanValue): string {
  return fingerprint({
    category: plan.category,
    audience: plan.audience,
    purpose: plan.purpose,
    pageStrategy: plan.pageStrategy,
    policyExceptions: plan.policyExceptions
  })
}

export function pptDirectionVisualFingerprint(plan: PptDesignPlanValue): string {
  return fingerprint({
    fontRoles: plan.fontRoles,
    colorRoles: plan.colorRoles,
    backgroundTreatment: plan.backgroundTreatment,
    effects: plan.effects,
    typeScale: plan.typeScale,
    spacingRhythm: plan.spacingRhythm,
    layoutSystem: plan.layoutSystem,
    imageryStrategy: plan.imageryStrategy
  })
}

function pptDirectionVisualDimensions(plan: PptDesignPlanValue): string[] {
  return [
    fingerprint(plan.fontRoles),
    fingerprint(plan.colorRoles),
    fingerprint(plan.backgroundTreatment),
    fingerprint({ effects: plan.effects, typeScale: plan.typeScale, spacingRhythm: plan.spacingRhythm }),
    fingerprint(plan.layoutSystem),
    fingerprint(plan.imageryStrategy)
  ]
}

export function pptDirectionPlanFingerprint(plan: unknown): string {
  return fingerprint(PptDesignPlanInput.parse(withoutGovernanceMetadata(plan)))
}

export function pptDirectionCandidateFingerprint(candidate: PptDirectionCandidate): string {
  return fingerprint({
    directionId: candidate.directionId,
    name: candidate.name,
    rationale: candidate.rationale,
    revision: candidate.revision,
    recommended: candidate.recommended,
    planFingerprint: pptDirectionPlanFingerprint(candidate.plan),
    previews: candidate.previews
  })
}

export function pptDirectionSlidesFingerprint(
  slides: ReadonlyArray<{
    slideId: string
    index: number
    title: string
    promptHash: string
    contentHash?: string
  }>
): string {
  return fingerprint(slides.map((slide) => ({
    slideId: slide.slideId,
    index: slide.index,
    title: slide.title,
    promptHash: slide.contentHash ?? slide.promptHash
  })))
}

export function samePptDirectionPlan(first: unknown, second: unknown): boolean {
  const left = PptDesignPlanInput.safeParse(withoutGovernanceMetadata(first))
  const right = PptDesignPlanInput.safeParse(withoutGovernanceMetadata(second))
  return left.success && right.success && fingerprint(left.data) === fingerprint(right.data)
}

export function pptDirectionSummary(plan: PptDesignPlanValue): {
  fonts: string[]
  colors: string[]
  layout: string
  background: string
  imagery: string
} {
  return {
    fonts: [plan.fontRoles.display, plan.fontRoles.body, ...(plan.fontRoles.monospace ? [plan.fontRoles.monospace] : [])],
    colors: Object.values(plan.colorRoles),
    layout: plan.layoutSystem,
    background: plan.backgroundTreatment.kind === 'gradient'
      ? `gradient ${plan.backgroundTreatment.stops.join(' → ')}`
      : plan.backgroundTreatment.kind,
    imagery: plan.imageryStrategy
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function withoutGovernanceMetadata(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const { fingerprint: _fingerprint, sourceRequestHash: _sourceRequestHash, ...plan } = value as Record<string, unknown>
  return plan
}

function isPortableWorkspaceRelativePath(value: string): boolean {
  const path = value.trim()
  if (!path || isAbsolute(path) || win32.isAbsolute(path)) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return false
  return !path.replaceAll('\\', '/').split('/').includes('..')
}
