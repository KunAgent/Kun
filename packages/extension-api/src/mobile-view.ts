import { z } from 'zod'
import { LocalIdSchema } from './common.js'

const safeText = (max: number, min = 0) => z.string().min(min).max(max).refine(value => !value.includes('\0'), 'NUL is not allowed')
const label = safeText(128, 1).refine(value => value.trim().length > 0)
const option = z.strictObject({ value: LocalIdSchema, label })
/** Inert native presentation only. There are deliberately no URLs, scripts, commands or remote actions. */
export const MobileViewBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ id: LocalIdSchema, type: z.literal('text'), text: safeText(2000, 1).refine(value => value.trim().length > 0) }),
  z.strictObject({ id: LocalIdSchema, type: z.literal('stat'), label, value: safeText(256) }),
  z.strictObject({ id: LocalIdSchema, type: z.literal('toggle'), label, initial: z.boolean() }),
  z.strictObject({ id: LocalIdSchema, type: z.literal('choice'), label,
    options: z.array(option).min(1).max(12), initial: LocalIdSchema })
])
export const MobileViewSchema = z.strictObject({
  version: z.literal(1),
  description: safeText(1000).optional(),
  blocks: z.array(MobileViewBlockSchema).min(1).max(24)
}).superRefine((view, context) => {
  const ids = new Set<string>()
  view.blocks.forEach((block, index) => {
    if (ids.has(block.id)) context.addIssue({ code: 'custom', path: ['blocks', index, 'id'], message: 'Block IDs must be unique' })
    ids.add(block.id)
    if (block.type === 'choice' && (new Set(block.options.map(item => item.value)).size !== block.options.length ||
      !block.options.some(item => item.value === block.initial)))
      context.addIssue({ code: 'custom', path: ['blocks', index], message: 'Choices need unique values and a declared initial option' })
  })
})
export type MobileView = z.infer<typeof MobileViewSchema>
export type MobileViewBlock = z.infer<typeof MobileViewBlockSchema>
