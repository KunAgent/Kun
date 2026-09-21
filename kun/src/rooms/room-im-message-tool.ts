import { realpath } from 'node:fs/promises'
import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { LocalTool } from '../adapters/tool/local-tool-host.js'
import { withToolBoundary } from '../adapters/tool/builtin-tool-utils.js'
import { resolveImAttachmentPath } from '../adapters/tool/im-attachment-tool.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomContentReference } from '../contracts/room-content.js'
import type { RoomService } from './room-service.js'
import { roomRunId } from './room-run-recording.js'
import { roomRunSegmentMessageId } from './room-run-segments.js'
import { agentStableId } from '../agents/agent-identity-service.js'

export const SEND_IM_MESSAGE_TOOL_NAME = 'send_im_message'
const MAX_IM_MESSAGE_TEXT_CHARS = 16_000
const MAX_IM_MESSAGE_ATTACHMENTS = 8

const ImMessageInputSchema = z.object({
  text: z.string().max(MAX_IM_MESSAGE_TEXT_CHARS).default(''),
  attachments: z.array(z.object({
    path: z.string().min(1).max(4096),
    fileName: z.string().max(300).optional()
  }).strict()).max(MAX_IM_MESSAGE_ATTACHMENTS).default([])
}).strict()

type ResolvedImFile = {
  absolutePath: string
  relativePath: string
  fileName: string
  bytes: number
}

const bindings = new WeakMap<ThreadStore, RoomService>()
export function bindImMessageService(threads: ThreadStore, service: RoomService): void {
  bindings.set(threads, service)
}
export function imMessageServiceBinding(threads: ThreadStore): RoomService | undefined {
  return bindings.get(threads)
}

async function resolveImMessageFiles(
  inputs: readonly { path: string; fileName?: string }[],
  workspaceRoot: string
): Promise<ResolvedImFile[]> {
  const files: ResolvedImFile[] = []
  for (const input of inputs) {
    const resolved = await resolveImAttachmentPath(input.path, workspaceRoot)
    if (files.some((file) => file.absolutePath === resolved.absolutePath)) continue
    files.push({
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      fileName: input.fileName?.trim() || resolved.fileName,
      bytes: resolved.bytes
    })
  }
  return files
}

function fileOutput(file: ResolvedImFile) {
  return {
    path: file.absolutePath,
    absolutePath: file.absolutePath,
    relativePath: file.relativePath,
    fileName: file.fileName,
    bytes: file.bytes
  }
}

/**
 * The only path that turns agent output into a user-visible IM bubble. In an
 * agent conversation it publishes a durable room message with run provenance;
 * on a remote IM surface it returns the message payload for the bridge.
 */
export function roomImMessageTool(threads: ThreadStore): LocalTool {
  return LocalToolHost.defineTool({
    name: SEND_IM_MESSAGE_TOOL_NAME,
    description:
      'Publish one message to the user in this IM conversation. Ordinary assistant text is internal working output the user never sees. ' +
      'Call this tool for every reply, status, question, or result the user should see: text and/or workspace files such as images, documents, audio, or video. ' +
      'One call creates one chat bubble; combine text with attachments or call it again for another bubble.',
    toolKind: 'tool_call',
    policy: 'auto',
    // Publishing a bubble is the conversation's own data-only protocol, like
    // send_room_message; it never mutates the user workspace itself.
    sideEffect: 'read-only',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: (context) => context.imContext === true ||
      (context.roomAgent === true && context.roomStepKind === 'conversation'),
    // Remote IM delivery uploads workspace bytes to an external chat and keeps
    // the same explicit-approval boundary as send_im_attachment. A bubble in
    // the user's own GUI conversation is intrinsic to the reply itself.
    requiresExplicitApproval: (call, context) => context.imContext === true &&
      Array.isArray((call.arguments as { attachments?: unknown }).attachments) &&
      ((call.arguments as { attachments: unknown[] }).attachments).length > 0,
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          maxLength: MAX_IM_MESSAGE_TEXT_CHARS,
          description: 'Markdown message body shown in the chat bubble.'
        },
        attachments: {
          type: 'array',
          maxItems: MAX_IM_MESSAGE_ATTACHMENTS,
          description: 'Workspace files to attach to this bubble (images, documents, audio, video, or other files).',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Workspace-relative or absolute path of a file inside the workspace.' },
              fileName: { type: 'string', description: 'Optional display name for the attachment.' }
            },
            required: ['path'],
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      const parsed = ImMessageInputSchema.safeParse(args)
      if (!parsed.success) {
        return { isError: true, output: { error: 'invalid send_im_message input', issues: parsed.error.issues } }
      }
      const input = parsed.data
      const text = input.text.trim().slice(0, MAX_IM_MESSAGE_TEXT_CHARS)
      if (!text && input.attachments.length === 0) {
        return { isError: true, output: { error: 'text or at least one attachment is required' } }
      }
      const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
      const room = thread?.roomContext

      if (room?.kind === 'conversation' && room.participantAgentId) {
        const service = bindings.get(threads)
        if (!service) throw new Error('room publication service unavailable')
        const turn = thread!.turns.find((item) => item.id === context.turnId)
        if (!turn || turn.status !== 'running' || !turn.clientRequestId) {
          throw new Error('send_im_message requires the active agent conversation turn')
        }
        const runId = roomRunId(room.roomId, turn.clientRequestId)
        const run = await service.store.get<RoomRunRecord>('room_run', runId)
        if (!run || run.value.threadId !== thread!.id || run.value.turnId !== turn.id ||
          run.value.memberId !== room.memberId) {
          throw new Error('send_im_message conversation run binding unavailable')
        }
        if (!context.activeToolCallId) throw new Error('send_im_message tool call identity unavailable')
        const workspace = await realpath(thread!.workspace)
        const files = await resolveImMessageFiles(input.attachments, workspace)
        const trigger = run.value.triggerMessageId
          ? await service.store.get<RoomMessage>('message', run.value.triggerMessageId)
          : null
        const workspaceId = agentStableId('private-workspace', room.roomId, workspace)
        const references: RoomContentReference[] = files.map((file) => ({
          kind: 'agent_file',
          workspaceId,
          relativePath: file.relativePath,
          titleSnapshot: file.fileName
        }))
        const messageId = roomRunSegmentMessageId(runId, context.activeToolCallId)
        await service.publishSegment(room.roomId, {
          messageId,
          runId,
          itemId: context.activeToolCallId,
          body: text,
          memberId: room.memberId,
          createdAt: new Date().toISOString(),
          status: 'final',
          ...(references.length ? { references } : {}),
          ...(trigger?.value.displayThreadRootId ? { displayThreadRootId: trigger.value.displayThreadRootId } : {})
        })
        return {
          output: {
            accepted: true,
            messageId,
            text,
            files: files.map(fileOutput)
          }
        }
      }

      if (context.imContext === true) {
        const files = await resolveImMessageFiles(input.attachments, context.workspace)
        return {
          output: {
            accepted: true,
            text,
            files: files.map(fileOutput)
          }
        }
      }

      return { isError: true, output: { error: 'send_im_message is only available in agent conversations or IM turns' } }
    })
  })
}
