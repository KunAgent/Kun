import { z } from 'zod'

/** Read-only, on-demand evidence. A missing native record is a normal outcome. */
export const AcpToolOutputSchema = z.object({
  text: z.string().max(64 * 1024), truncated: z.boolean()
})
export type AcpToolOutput = z.infer<typeof AcpToolOutputSchema>
