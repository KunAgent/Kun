import { z } from 'zod'
import { RoomReviewSchema } from '../contracts/room-deliveries.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { CapabilityToolProvider } from '../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { RoomCoordinationPlanSchema } from './room-coordination-plan.js'
import { roomRuleReadTool } from './room-rule-read-tool.js'
import { roomPollVoteTool } from './room-poll-vote-tool.js'
import { roomPeerTools, roomPeerStoreBinding } from './room-peer-tools.js'

export const RoomReviewResultSchema = z.object({
  verdict: RoomReviewSchema.shape.verdict,
  findings: RoomReviewSchema.shape.findings,
  limitations: RoomReviewSchema.shape.limitations
}).strict().refine((review) => review.verdict !== 'passed' ||
  !review.findings.some((finding) => finding.severity === 'blocking'), 'blocking findings cannot produce a passing review')
export const RoomChecksSchema = z.object({
  checks: z.array(z.object({ id: z.string().min(1).max(128),
    purpose: z.string().trim().min(1).max(2000).optional(),
    command: z.string().min(1).max(16000), cwd: z.string().optional() }).strict()).max(100)
}).strict().refine((value) => new Set(value.checks.map((check) => check.id)).size === value.checks.length, 'check IDs must be unique')

export function roomResultProvider(threads: ThreadStore): CapabilityToolProvider {
  return {
    id: 'room-results', kind: 'built-in', enabled: true, available: true,
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    tools: [roomRuleReadTool(threads), roomPollVoteTool(threads, () => roomPeerStoreBinding(threads)), ...roomPeerTools(threads), ...[
      { name: 'submit_room_plan', kind: 'coordination', schema: RoomCoordinationPlanSchema,
        description: 'Submit the structured room decision for the current user request.' },
      { name: 'submit_room_review', kind: 'review', schema: RoomReviewResultSchema,
        description: 'After inspecting the pinned delivery, submit the review findings and limitations.' },
      { name: 'declare_room_checks', kind: 'execution', schema: RoomChecksSchema,
        description: 'Before executing verification, declare exact validation commands and their workspace. Results will be matched to actual tool executions.' }
    ].map(({ name, kind, schema, description }) => LocalToolHost.defineTool({
      name, description, toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
      effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
      shouldAdvertise: (context) => context.roomStepKind === kind,
      inputSchema: z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>,
      execute: async (args, context) => {
        const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
        if (context.roomStepKind !== kind || thread?.roomContext?.kind !== kind || !thread.turns.some((turn) => turn.id === context.turnId)) return { isError: true, output: { error: 'room step scope required' } }
        const parsed = schema.safeParse(args)
        return parsed.success ? { output: { accepted: true, value: parsed.data } } :
          { isError: true, output: { error: 'invalid room result', issues: parsed.error.issues } }
      }
    }))]
  }
}
