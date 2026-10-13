import { z } from 'zod'
import { TurnItem } from './items.js'

/** References are resolved only against the exact expected session revision. */
export const ItemHistoryRewriteSchema = z.object({
  threadId: z.string().min(1).max(256),
  expectedRevision: z.number().int().nonnegative(),
  items: z.array(TurnItem).optional(),
  itemReferences: z.array(z.union([z.string().min(1), TurnItem])).optional()
}).strict().refine((value) => (value.items !== undefined) !== (value.itemReferences !== undefined), {
  message: 'Provide either items or itemReferences'
})
