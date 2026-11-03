import { z } from 'zod'
import { isGuiPlanRelativePath } from '../shared/gui-plan.js'

/**
 * Plan operation kinds the renderer can advertise on a plan turn.
 * Mirrors the shared renderer contract so request metadata stays
 * stable across reconnects and replays.
 */
export const GuiPlanOperationSchema = z.enum(['draft', 'refine'])
export type GuiPlanOperationJson = z.infer<typeof GuiPlanOperationSchema>

/**
 * Plan context the renderer can attach to a `StartTurnRequest`. The
 * thread mode is carried on the thread record; this struct adds the
 * reserved path and source request needed to scope `create_plan`.
 */
export const GuiPlanContextSchema = z.object({
  operation: GuiPlanOperationSchema,
  workspaceRoot: z.string().min(1),
  relativePath: z
    .string()
    .min(1)
    .refine(isGuiPlanRelativePath, {
      message: 'relativePath must be a direct Markdown file under .kunsdd/plan'
    }),
  planId: z.string().min(1), fixedPath: z.boolean().optional(),
  sourceRequest: z.string().optional(),
  title: z.string().optional()
})
export type GuiPlanContextJson = z.infer<typeof GuiPlanContextSchema>

const GuiDesignArtifactPathSchema = (extension: string, message: string) =>
  z.string().min(1).refine((value) => {
    const normalized = value.replaceAll('\\', '/')
    return normalized === value &&
      normalized.startsWith('.kun-design/') &&
      !normalized.split('/').includes('..') &&
      new RegExp(`\\/v\\d+\\.${extension}$`, 'i').test(normalized)
  }, { message })

export const GuiDesignArtifactContextSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('svg'),
    artifactId: z.string().min(1),
    relativePath: GuiDesignArtifactPathSchema('svg', 'relativePath must be a versioned SVG file under .kun-design')
  }),
  // A screen-generation turn: the model may write only this page and its design notes.
  z.object({
    kind: z.literal('html'),
    artifactId: z.string().min(1),
    relativePath: GuiDesignArtifactPathSchema('html', 'relativePath must be a versioned HTML file under .kun-design'),
    designMdPath: z.string().min(1).refine((value) => {
      const normalized = value.replaceAll('\\', '/')
      return normalized === value &&
        normalized.startsWith('.kun-design/') &&
        !normalized.split('/').includes('..') &&
        normalized.endsWith('/DESIGN.md')
    }, { message: 'designMdPath must be a DESIGN.md file under .kun-design' }).optional()
  })
])
export type GuiDesignArtifactContextJson = z.infer<typeof GuiDesignArtifactContextSchema>
