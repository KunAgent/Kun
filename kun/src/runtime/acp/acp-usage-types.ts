import type { z } from 'zod'
import type { AcpUsageSchema } from './acp-schema.js'

/**
 * Token usage in ACP's own shape. `inputTokens` usually includes cache reads;
 * OpenCode's does not (see AcpEventMapper.applyPromptResult).
 */
export type AcpUsage = z.infer<typeof AcpUsageSchema>
