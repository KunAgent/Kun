import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { withToolBoundary } from './builtin-tool-utils.js'
import type { BackgroundShellRecordInput } from './builtin-tool-types.js'
import {
  isBashSessionId,
  listBashSessionRecords,
  pollBashSession,
  readBashSessionPayload,
  stopBashSessionById,
  writeBashSessionStdin
} from './builtin-bash-tool.js'

export type BackgroundShellToolOptions = {
  listBackgroundSessions?: (threadId?: string) => readonly BackgroundShellRecordInput[]
}


function normalizeYieldSeconds(value: unknown): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 10
  return Math.max(1, Math.min(60, raw))
}

export function createBackgroundShellTool(options: BackgroundShellToolOptions = {}): LocalTool {
  return LocalToolHost.defineTool({
    name: 'background_shell',
    description:
      'Manage shell sessions started with bash background=true. The bash tool assigns an 8-character session_id when starting a background command; use that id here. action="list" lists running sessions by default (set include_finished=true to also show completed/stopped/failed sessions; optional thread_only). action="read" returns a non-blocking output snapshot. action="poll" waits up to yield_seconds for more output or exit. action="write" sends stdin via input. action="stop" terminates a running session.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'read', 'poll', 'write', 'stop']
        },
        session_id: {
          type: 'string',
          description: 'Required for read, poll, write, and stop. The 8-character id returned by bash when background=true.'
        },
        yield_seconds: { type: 'number' },
        include_finished: { type: 'boolean', default: false },
        thread_only: { type: 'boolean', default: true },
        input: { type: 'string' }
      },
      required: ['action'],
      additionalProperties: false
    },
    policy: 'auto',
    toolKind: 'tool_call',
    execute: async (args, context) =>
      withToolBoundary(async () => {
        const action = typeof args.action === 'string' ? args.action.trim() : ''
        if (action === 'list') {
          const threadOnly = args.thread_only !== false
          const threadId = threadOnly ? context.threadId : undefined
          let sessions = options.listBackgroundSessions
            ? [...options.listBackgroundSessions(threadId)]
            : await listBashSessionRecords(threadId)
          if (args.include_finished !== true) {
            sessions = sessions.filter((session) => session.status === 'running')
          }
          return {
            output: {
              sessions: sessions.map((session) => ({
                session_id: session.id,
                command: session.command,
                cwd: session.cwd,
                shell: session.shell,
                status: session.status,
                started_at: session.startedAt,
                ...(session.finishedAt ? { finished_at: session.finishedAt } : {}),
                exit_code: session.exitCode,
                output: session.output,
                ...(session.outputTruncated ? { output_truncated: true } : {}),
                ...(session.outputFilePath ? { output_file: session.outputFilePath } : {}),
                detached: session.detached
              })),
              running: sessions.filter((session) => session.status === 'running').length
            }
          }
        }

        const sessionId = typeof args.session_id === 'string' ? args.session_id.trim() : ''
        if (!sessionId) {
          return { output: { error: 'session_id is required' }, isError: true }
        }
        if (!isBashSessionId(sessionId)) {
          return {
            output: {
              error: 'session_id must be the 8-character id returned by bash when background=true',
              session_id: sessionId
            },
            isError: true
          }
        }

        if (action === 'read') {
          const payload = await readBashSessionPayload(sessionId)
          if (!payload) {
            return { output: { error: 'background shell session not found', session_id: sessionId }, isError: true }
          }
          return { output: payload, isError: payload.status === 'failed' }
        }

        if (action === 'stop') {
          const stopped = await stopBashSessionById(sessionId)
          const payload = await readBashSessionPayload(sessionId)
          if (!payload) {
            return {
              output: { error: 'background shell session not found', session_id: sessionId, stopped },
              isError: true
            }
          }
          return {
            output: { ...payload, stop_sent: stopped },
            isError: payload.status === 'running' || payload.status === 'failed'
          }
        }

        if (action === 'write') {
          const payload = await writeBashSessionStdin(
            sessionId,
            typeof args.input === 'string' ? args.input : '',
            normalizeYieldSeconds(args.yield_seconds)
          )
          if (!payload) {
            return { output: { error: 'background shell session not found', session_id: sessionId }, isError: true }
          }
          return { output: payload, isError: payload.status === 'failed' }
        }

        if (action === 'poll') {
          const payload = await pollBashSession(sessionId, normalizeYieldSeconds(args.yield_seconds))
          if (!payload) {
            return { output: { error: 'background shell session not found', session_id: sessionId }, isError: true }
          }
          return { output: payload, isError: payload.status === 'failed' }
        }

        return { output: { error: `unsupported background_shell action: ${action}` }, isError: true }
      })
  })
}
