import { z } from 'zod'

/** Read-only, on-demand evidence. A missing native record is a normal outcome. */
export const AcpToolOutputSchema = z.object({
  text: z.string().max(64 * 1024), truncated: z.boolean(), provider: z.enum(['devin', 'antigravity']).optional()
})
export type AcpToolOutput = z.infer<typeof AcpToolOutputSchema>

/** Set by the host after negotiating the ACP session, never by a tool. */
export type AcpOutputProvider = 'antigravity' | 'devin'
export type AcpOutputLocator = { harnessId: AcpOutputProvider; sessionId: string }
