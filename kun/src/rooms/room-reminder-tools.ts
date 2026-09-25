import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { Room } from '../contracts/rooms.js'
import type { RoomRequestState } from './room-runtime-types.js'
import { ROOM_REMINDER_LIMITS } from '../contracts/room-reminders.js'
import type { RoomStore } from './room-store.js'
import { roomRunId } from './room-run-recording.js'
import { roomPeerStoreBinding } from './room-peer-tools.js'
import { agentStableId } from '../agents/agent-identity-service.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import type { LocalTool } from '../adapters/tool/local-tool-host.js'
import { cancelRoomReminder, createRoomReminder, listRoomReminders,
  reminderFireAt, remindersEnabled, updateRoomReminder } from './room-reminders.js'

export const SCHEDULE_REMINDER_TOOL_NAME = 'schedule_reminder'
export const LIST_REMINDERS_TOOL_NAME = 'list_reminders'
export const UPDATE_REMINDER_TOOL_NAME = 'update_reminder'
export const CANCEL_REMINDER_TOOL_NAME = 'cancel_reminder'
export const ROOM_REMINDER_TOOL_NAMES = [
  SCHEDULE_REMINDER_TOOL_NAME, LIST_REMINDERS_TOOL_NAME, UPDATE_REMINDER_TOOL_NAME, CANCEL_REMINDER_TOOL_NAME
] as const

const delayOrTime = {
  delaySeconds: z.number().int().positive().optional(),
  fireAt: z.string().datetime({ offset: true }).optional()
}
const ScheduleReminderInput = z.object({
  note: z.string().trim().min(1).max(1000),
  ...delayOrTime,
  anchorMessageId: z.string().min(1).max(256).optional()
}).strict()
const ListRemindersInput = z.object({
  status: z.enum(['scheduled', 'all']).default('scheduled')
}).strict()
const UpdateReminderInput = z.object({
  reminderId: z.string().min(1).max(256),
  note: z.string().trim().min(1).max(1000).optional(),
  ...delayOrTime
}).strict()
const CancelReminderInput = z.object({ reminderId: z.string().min(1).max(256) }).strict()

type ReminderBinding = {
  store: RoomStore
  roomId: string
  memberId: string
  participantAgentId: string
  runId: string
  requestId?: string
  chainDepth: number
  triggerMessageId?: string
}

/**
 * Reminder tools bind exactly like send_im_message: the active running turn,
 * its recorded room run, the bound member and the host-derived agent identity.
 * Model arguments can never supply any of these fields.
 */
async function reminderConversationBinding(threads: ThreadStore, context: ToolHostContext): Promise<ReminderBinding> {
  const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  const room = thread?.roomContext, store = roomPeerStoreBinding(threads)
  if (!thread || !store || room?.kind !== 'conversation' || !room.participantAgentId) {
    throw new Error('agent conversation scope required')
  }
  const turn = thread.turns.find((item) => item.id === context.turnId)
  if (!turn || turn.status !== 'running' || !turn.clientRequestId) {
    throw new Error('reminder tools require the active agent conversation turn')
  }
  const runId = roomRunId(room.roomId, turn.clientRequestId)
  const run = await store.get<RoomRunRecord>('room_run', runId)
  if (!run || run.value.threadId !== thread.id || run.value.turnId !== turn.id || run.value.memberId !== room.memberId) {
    throw new Error('reminder conversation run binding unavailable')
  }
  const roomDoc = await store.get<Room>('room', room.roomId)
  if (!roomDoc || roomDoc.value.conversationKind !== 'user_agent') {
    throw new Error('reminders are only available in private agent conversations')
  }
  const member = roomDoc.value.members.find((entry) => entry.id === room.memberId)
  if (!member || member.removedAt || !member.enabled || member.participantAgentId !== room.participantAgentId) {
    throw new Error('the agent member is unavailable')
  }
  const request = run.value.requestId ? await store.get<RoomRequestState>('request', run.value.requestId) : null
  return { store, roomId: room.roomId, memberId: room.memberId, participantAgentId: room.participantAgentId,
    runId, requestId: run.value.requestId,
    chainDepth: (request?.value.privateReminder?.chainDepth ?? -1) + 1,
    triggerMessageId: run.value.triggerMessageId }
}

async function reminderBinding(threads: ThreadStore, context: ToolHostContext): Promise<ReminderBinding> {
  const binding = await reminderConversationBinding(threads, context)
  if (!(await remindersEnabled(binding.store))) throw new Error('agent reminders are disabled')
  return binding
}

const advertise = (context: ToolHostContext) => context.roomAgent === true && context.roomStepKind === 'conversation'
const meta = {
  toolKind: 'tool_call' as const, policy: 'auto' as const, sideEffect: 'read-only' as const,
  effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false }
}
const schema = (value: z.ZodType) => z.toJSONSchema(value, { unrepresentable: 'any' }) as Record<string, unknown>
const fail = (error: unknown) => ({ isError: true, output: { error: error instanceof Error ? error.message : String(error) } })

/**
 * Private-agent reminder tools. The agent may only ever schedule, list,
 * update or cancel reminders it owns inside its current private room.
 */
export function roomReminderTools(threads: ThreadStore): LocalTool[] {
  return [
    LocalToolHost.defineTool({
      name: SCHEDULE_REMINDER_TOOL_NAME,
      description:
        'Schedule a one-shot reminder for yourself in this private conversation. When it fires, you are woken here ' +
        'and decide whether the user should see a follow-up. Provide delaySeconds or fireAt (exactly one), ' +
        `${ROOM_REMINDER_LIMITS.minDelaySec} seconds to ${Math.floor(ROOM_REMINDER_LIMITS.maxDelaySec / 86400)} days out.`,
      ...meta, shouldAdvertise: advertise,
      inputSchema: schema(ScheduleReminderInput),
      execute: async (args, context) => {
        try {
          const parsed = ScheduleReminderInput.safeParse(args)
          if (!parsed.success) return { isError: true, output: { error: 'invalid schedule_reminder input', issues: parsed.error.issues } }
          if (!context.activeToolCallId) throw new Error('schedule_reminder tool call identity unavailable')
          const binding = await reminderBinding(threads, context)
          if (binding.chainDepth > ROOM_REMINDER_LIMITS.maxChainDepth) {
            throw new Error('reminder follow-up chain limit reached; act now instead of scheduling again')
          }
          const fireAt = reminderFireAt(parsed.data, new Date())
          const entry = await createRoomReminder(binding.store, {
            clientRequestId: agentStableId('reminder', binding.runId, context.activeToolCallId),
            roomId: binding.roomId, participantAgentId: binding.participantAgentId, memberId: binding.memberId,
            note: parsed.data.note, fireAt,
            anchorMessageId: parsed.data.anchorMessageId ?? binding.triggerMessageId,
            chainDepth: binding.chainDepth, createdByRunId: binding.runId })
          return { output: { accepted: true, reminderId: entry.reminderId, fireAt: entry.fireAt,
            note: 'One-shot reminder scheduled. It wakes only you when it fires.' } }
        } catch (error) { return fail(error) }
      }
    }),
    LocalToolHost.defineTool({
      name: LIST_REMINDERS_TOOL_NAME,
      description:
        'List your own reminders in this private conversation. Defaults to scheduled only; ' +
        'pass status "all" to include recently ended reminders.',
      ...meta, shouldAdvertise: advertise,
      inputSchema: schema(ListRemindersInput),
      execute: async (args, context) => {
        try {
          const parsed = ListRemindersInput.safeParse(args)
          if (!parsed.success) return { isError: true, output: { error: 'invalid list_reminders input', issues: parsed.error.issues } }
          const binding = await reminderBinding(threads, context)
          const reminders = (await listRoomReminders(binding.store, binding.roomId, {
            status: parsed.data.status, participantAgentId: binding.participantAgentId }))
            .map(({ revision: _revision, ...reminder }) => reminder)
          return { output: { reminders, count: reminders.length } }
        } catch (error) { return fail(error) }
      }
    }),
    LocalToolHost.defineTool({
      name: UPDATE_REMINDER_TOOL_NAME,
      description:
        'Update the note or fire time of one of your own scheduled reminders. ' +
        'Only still-scheduled reminders can change; ended ones are immutable.',
      ...meta, shouldAdvertise: advertise,
      inputSchema: schema(UpdateReminderInput),
      execute: async (args, context) => {
        try {
          const parsed = UpdateReminderInput.safeParse(args)
          if (!parsed.success) return { isError: true, output: { error: 'invalid update_reminder input', issues: parsed.error.issues } }
          if (!context.activeToolCallId) throw new Error('update_reminder tool call identity unavailable')
          const binding = await reminderBinding(threads, context)
          const current = await binding.store.get<{ participantAgentId?: string }>('room_reminder', parsed.data.reminderId)
          if (!current || current.roomId !== binding.roomId || current.value.participantAgentId !== binding.participantAgentId) {
            throw new Error('reminders may only be changed by their own agent')
          }
          const entry = await updateRoomReminder(binding.store, binding.roomId, parsed.data.reminderId, {
            clientRequestId: agentStableId('reminder-update', binding.runId, context.activeToolCallId),
            ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
            ...(parsed.data.delaySeconds !== undefined ? { delaySeconds: parsed.data.delaySeconds } : {}),
            ...(parsed.data.fireAt !== undefined ? { fireAt: parsed.data.fireAt } : {}) })
          return { output: { accepted: true, reminderId: entry.reminderId, fireAt: entry.fireAt, status: entry.status } }
        } catch (error) { return fail(error) }
      }
    }),
    LocalToolHost.defineTool({
      name: CANCEL_REMINDER_TOOL_NAME,
      description: 'Cancel one of your own scheduled reminders so it never fires.',
      ...meta, shouldAdvertise: advertise,
      inputSchema: schema(CancelReminderInput),
      execute: async (args, context) => {
        try {
          const parsed = CancelReminderInput.safeParse(args)
          if (!parsed.success) return { isError: true, output: { error: 'invalid cancel_reminder input', issues: parsed.error.issues } }
          if (!context.activeToolCallId) throw new Error('cancel_reminder tool call identity unavailable')
          const binding = await reminderBinding(threads, context)
          const current = await binding.store.get<{ roomId?: string; participantAgentId?: string }>('room_reminder', parsed.data.reminderId)
          if (!current || current.roomId !== binding.roomId || current.value.participantAgentId !== binding.participantAgentId) {
            throw new Error('reminders may only be cancelled by their own agent')
          }
          const entry = await cancelRoomReminder(binding.store, binding.roomId, parsed.data.reminderId, {
            clientRequestId: agentStableId('reminder-cancel', binding.runId, context.activeToolCallId),
            reason: 'agent_cancelled' })
          return { output: { accepted: true, reminderId: entry.reminderId, status: entry.status } }
        } catch (error) { return fail(error) }
      }
    })
  ]
}
