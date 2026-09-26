import { z } from 'zod'

export const ItemHistoryContentSchema = z.object({
  itemId: z.string(),
  field: z.enum(['text', 'arguments', 'output', 'details']),
  text: z.string(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().optional(),
  totalChars: z.number().int().nonnegative()
})
