import type { z } from 'zod'
import type { AcpUsageSchema } from './acp-schema.js'

/** Token usage in ACP's own shape: `inputTokens` includes cache reads. */
export type AcpUsage = z.infer<typeof AcpUsageSchema>
