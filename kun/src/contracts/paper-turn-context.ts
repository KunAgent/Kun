import { z } from 'zod'

export const PAPER_CONTEXT_MAX_CHARS = 80_000
export const PaperTurnContextSchema = z.object({
  version: z.literal(1),
  scope: z.enum(['selected-passage', 'current-paper', 'multi-paper']),
  privacy: z.enum(['local-only', 'model-provider']),
  purpose: z.string().trim().min(1).max(2_000),
  providerId: z.string().trim().min(1).max(256),
  model: z.string().trim().min(1).max(256).refine((value) => value.toLowerCase() !== 'auto',
    'Paper reading requires an explicitly selected model'),
  maxModelRequests: z.literal(1),
  sources: z.array(z.object({
    paperId: z.string().trim().min(1).max(256),
    title: z.string().max(1_000),
    locator: z.string().max(1_000).optional(),
    sourceVersion: z.string().max(256).optional(),
    text: z.string().min(1).max(PAPER_CONTEXT_MAX_CHARS)
  }).strict()).min(1).max(12)
}).strict().superRefine((value, ctx) => {
  if (value.sources.reduce((sum, source) => sum + source.text.length, 0) > PAPER_CONTEXT_MAX_CHARS) {
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Frozen paper context exceeds 80,000 characters' })
  }
  const papers = new Set(value.sources.map((source) => source.paperId))
  if (value.scope !== 'multi-paper' && papers.size !== 1) {
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'This scope permits exactly one paper' })
  }
  if (value.scope === 'selected-passage' && value.sources.length !== 1) {
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Selected passage permits exactly one source excerpt' })
  }
})

export type PaperTurnContext = z.infer<typeof PaperTurnContextSchema>

/** Validation also copies the snapshot so later editor mutations cannot change a queued turn. */
export function createPaperTurnContext(input: PaperTurnContext): PaperTurnContext {
  return PaperTurnContextSchema.parse(input)
}

export function validatePaperTurnCombination(value: { paperContext?: PaperTurnContext } & Record<string, unknown>, ctx: z.RefinementCtx): void {
  if (!value.paperContext) return
  const extraArrays = ['attachmentIds', 'composerContexts', 'fileReferences', 'attachments']
  const extraFields = ['writeContext', 'guiPlan', 'guiDesignArtifact', 'guiDesignCanvas',
    'guiExcalidrawCanvas', 'guiDesignMode', 'designProfile', 'subagentResume', 'planBuild', 'imContext', 'persona']
  if (value.orchestration === 'graph' || value.mode === 'plan' ||
    extraArrays.some((key) => Array.isArray(value[key]) && value[key].length > 0) ||
    extraFields.some((key) => Boolean(value[key]))) {
    ctx.addIssue({ code: 'custom', path: ['paperContext'],
      message: 'Paper reading accepts only frozen sources and a question; start a separate turn for other context or actions' })
  }
}
