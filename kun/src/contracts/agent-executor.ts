import { z } from 'zod'
import { HarnessCredentialModeSchema } from './harness.js'

/**
 * External coding Agents that may join conversations. Their native tools are
 * gated by an engine sandbox or permission mode that Kun can force read-only;
 * engines without such a gate stay Code-task only.
 */
export const CONVERSATION_HARNESS_IDS = ['claude-code', 'codex', 'opencode'] as const
export const ConversationHarnessIdSchema = z.enum(CONVERSATION_HARNESS_IDS)
export type ConversationHarnessId = z.infer<typeof ConversationHarnessIdSchema>

/**
 * Who runs an Agent identity's turns. Absent means Kun's own loop; `harness`
 * pins one external engine route, validated by the same catalog as Code tasks.
 */
export const AgentExecutorSchema = z.object({
  kind: z.literal('harness'),
  harnessId: ConversationHarnessIdSchema,
  credentialMode: HarnessCredentialModeSchema,
  model: z.string().min(1).max(256),
  providerId: z.string().min(1).max(256).optional(),
  accountId: z.string().min(1).max(256).optional()
}).strict()
export type AgentExecutor = z.infer<typeof AgentExecutorSchema>

/** The fixed engine route; the model may change without creating a new identity. */
export function agentExecutorRouteKey(executor: AgentExecutor): string {
  return JSON.stringify([executor.harnessId, executor.credentialMode, executor.providerId ?? '', executor.accountId ?? ''])
}

/** Only private chats and read-only discussion may run on an engine-native gate. */
export function isConversationalRoomEngine(kind: string, harnessId: string): boolean {
  return (kind === 'conversation' || kind === 'discussion') &&
    (CONVERSATION_HARNESS_IDS as readonly string[]).includes(harnessId)
}
