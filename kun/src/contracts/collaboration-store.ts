import { z } from 'zod'
import { ParticipantAgentId } from './agent-identities.js'
import { FollowUpId, FollowUpTime } from './collaboration-followup.js'

export const CollaborationDocumentKindSchema = z.enum([
  'commitment_control', 'commitment_link', 'commitment_subscription', 'collaboration_source',
  'collaboration_source_grant', 'collaboration_event', 'commitment_event_binding',
  'commitment_execution', 'commitment_effect', 'commitment_attention', 'collaboration_policy'
])
export type CollaborationDocumentKind = z.infer<typeof CollaborationDocumentKindSchema>
const Limit = z.number().int().min(1).max(100).default(50)
const Scope = { commitmentId: FollowUpId, participantAgentId: ParticipantAgentId, sourceRoomId: FollowUpId }
const Cursor = z.object({ at: FollowUpTime, id: FollowUpId }).strict()

/** Internal Manager queries: due scans use current values, never the insertion seq as an update cursor. */
export const CollaborationQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('due_effects'), status: z.enum(['pending', 'dispatching', 'outcome_unknown']),
    before: FollowUpTime, cursor: Cursor.optional(), limit: Limit }).strict(),
  z.object({ kind: z.literal('due_executions'), phase: z.enum(['admitted', 'accepted', 'reconciling']),
    before: FollowUpTime, cursor: Cursor.optional(), limit: Limit }).strict(),
  z.object({ kind: z.literal('due_subscriptions'), before: FollowUpTime,
    cursor: Cursor.optional(), limit: Limit }).strict(),
  z.object({ kind: z.literal('by_commitment'), ...Scope,
    documentKind: z.enum(['commitment_control', 'commitment_link', 'commitment_subscription', 'collaboration_source_grant',
      'commitment_event_binding', 'commitment_execution', 'commitment_effect', 'commitment_attention', 'collaboration_policy']),
    cursor: Cursor.optional(), limit: Limit }).strict(),
  z.object({ kind: z.literal('commitment_activity'), ...Scope,
    category: z.enum(['links', 'subscriptions', 'executions', 'effects', 'attention']),
    cursor: Cursor.optional(), limit: Limit }).strict(),
  z.object({ kind: z.literal('attention'), participantAgentId: ParticipantAgentId, sourceRoomId: FollowUpId,
    status: z.enum(['open', 'resolved', 'superseded', 'expired']),
    cursor: z.object({ priority: z.number().int().min(0).max(100), at: FollowUpTime, id: FollowUpId }).strict().optional(),
    limit: Limit }).strict(),
  z.object({ kind: z.literal('owned_target'), targetKey: z.string().min(1).max(1024) }).strict(),
  z.object({ kind: z.literal('owned_thread'), threadId: FollowUpId }).strict(),
  z.object({ kind: z.literal('source_subscriptions'), sourceId: FollowUpId,
    cursor: Cursor.optional(), limit: Limit }).strict()
])
export type CollaborationQuery = z.input<typeof CollaborationQuerySchema>
