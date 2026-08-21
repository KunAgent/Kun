import { z } from 'zod'

export const CONVERSATION_VISUALIZATION_VERSION = 1 as const
export const MAX_CONVERSATION_VISUALIZATION_BYTES = 12 * 1024

export const ConversationVisualizationToneSchema = z.enum([
  'neutral',
  'accent',
  'success',
  'warning',
  'danger'
])
export type ConversationVisualizationTone = z.infer<typeof ConversationVisualizationToneSchema>

const ItemIdSchema = z.string().regex(
  /^[A-Za-z][A-Za-z0-9_-]{0,31}$/,
  'id must start with a letter and contain only letters, numbers, underscores, or hyphens'
)
const SectionTitleSchema = z.string().trim().min(1).max(80)
const ItemDescriptionSchema = z.string().trim().min(1).max(180)

const FlowItemSchema = z.object({
  id: ItemIdSchema,
  title: z.string().trim().min(1).max(80),
  description: ItemDescriptionSchema.optional(),
  tone: ConversationVisualizationToneSchema.optional()
}).strict()

const FlowSectionSchema = z.object({
  kind: z.literal('flow'),
  title: SectionTitleSchema.optional(),
  direction: z.enum(['horizontal', 'vertical']).default('horizontal'),
  steps: z.array(FlowItemSchema).min(2).max(10)
}).strict().superRefine((section, context) => addDuplicateIdIssues(section.steps, context))

const CardItemSchema = FlowItemSchema

const CardGridSectionSchema = z.object({
  kind: z.literal('card_grid'),
  title: SectionTitleSchema.optional(),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  cards: z.array(CardItemSchema).min(1).max(6)
}).strict().superRefine((section, context) => addDuplicateIdIssues(section.cards, context))

const CalloutSectionSchema = z.object({
  kind: z.literal('callout'),
  title: SectionTitleSchema.optional(),
  tone: ConversationVisualizationToneSchema.default('neutral'),
  lines: z.array(z.string().trim().min(1).max(240)).min(1).max(4)
}).strict()

export const ConversationVisualizationSectionSchema = z.discriminatedUnion('kind', [
  FlowSectionSchema,
  CardGridSectionSchema,
  CalloutSectionSchema
])

export const ConversationVisualizationV1Schema = z.object({
  version: z.literal(CONVERSATION_VISUALIZATION_VERSION),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(400).optional(),
  sections: z.array(ConversationVisualizationSectionSchema).min(1).max(6)
}).strict().superRefine((value, context) => {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > MAX_CONVERSATION_VISUALIZATION_BYTES) {
    context.addIssue({
      code: 'custom',
      message: `visualization exceeds ${MAX_CONVERSATION_VISUALIZATION_BYTES} bytes`
    })
  }
})
export type ConversationVisualizationV1 = z.infer<typeof ConversationVisualizationV1Schema>

function addDuplicateIdIssues(
  items: Array<{ id: string }>,
  context: z.RefinementCtx
): void {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `duplicate id: ${item.id}`
      })
    }
    seen.add(item.id)
  })
}
