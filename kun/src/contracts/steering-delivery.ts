import { z } from 'zod'

/** Durable ownership receipt; item identity survives lost responses and restart. */
export const SteeringDeliverySchema = z.object({
  operationId: z.string().min(1).max(256),
  itemId: z.string().min(1),
  fingerprint: z.string(),
  sourceTurnId: z.string().optional(),
  text: z.string(),
  displayText: z.string().optional(),
  attachmentIds: z.array(z.string()),
  createdAt: z.string(),
  delivered: z.boolean().default(false)
})
export type SteeringDelivery = z.infer<typeof SteeringDeliverySchema>
