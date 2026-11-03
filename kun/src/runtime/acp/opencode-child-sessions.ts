/**
 * Mirrors OpenCode-family subagent sessions into their Kun side threads.
 *
 * OpenCode's ACP server only forwards events of sessions it created, so a
 * `task` subagent's steps never reach Kun over ACP. Its child session is in
 * the Agent's own SQLite store (`session.parent_id` = the ACP session), which
 * this reader polls read-only while the parent turn runs. It never writes
 * the database and stops quietly when the store is missing or unsupported.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { clipExternalText, externalSubagentTurnId } from '../../contracts/external-subagent.js'
import type { TurnItem } from '../../contracts/items.js'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem
} from '../../domain/item.js'
import { withOpenCodeDatabase } from '../../history/opencode-source.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { describeToolActivity } from '../external-subagent-activity.js'
import type { AcpSubagentCard, AcpSubagentTracker } from './acp-subagent-tracker.js'

const POLL_INTERVAL_MS = 1_000
const MAX_FAILURES = 3
const MAX_OUTPUT_CHARS = 16 * 1024

/** The Agent's SQLite store, honoring OPENCODE_DB and XDG_DATA_HOME; undefined when absent. */
export function openCodeDatabasePath(harnessId: string, env: NodeJS.ProcessEnv): string | undefined {
  const dataHome = env.XDG_DATA_HOME || join(homedir(), '.local/share')
  const custom = env.OPENCODE_DB && env.OPENCODE_DB !== ':memory:' ? env.OPENCODE_DB : undefined
  const apps = harnessId === 'codemaker' ? ['codemaker', 'opencode'] : harnessId === 'opencode' ? ['opencode'] : []
  const candidates = [
    ...(custom ? apps.map((app) => isAbsolute(custom) ? custom : join(dataHome, app, custom)) : []),
    ...apps.flatMap((app) => [join(dataHome, app, `${app}.db`), join(dataHome, app, 'opencode.db')])
  ]
  return candidates.find((path) => existsSync(path))
}

type PartRow = { id: string; message_id: string; time_updated: number; data: string }
type ChildState = { seenTools: Map<string, 'call' | 'result'>; texts: Map<string, number>; cursor: number; steps: number }

export type OpenCodeChildSessions = { stop(): Promise<void> }

export function startOpenCodeChildSessions(input: {
  dbPath: string
  acpSessionId: string
  tracker: AcpSubagentTracker
  emit: (drafts: RuntimeEventDraft[]) => void
  debug?: (summary: string) => void
  intervalMs?: number
}): OpenCodeChildSessions {
  const children = new Map<string, ChildState>()
  const bound = new Set<string>()
  let failures = 0
  let stopped = false

  const syncOnce = (): void => {
    if (failures >= MAX_FAILURES) return
    const cards = input.tracker.openCards()
    if (!cards.length) return
    try {
      const drafts = withOpenCodeDatabase(input.dbPath, (db) => cards.flatMap((card) => {
        if (!card.sessionId) {
          const sessions = db.prepare('SELECT id, title FROM session WHERE parent_id = ? ORDER BY time_created, id')
            .all(input.acpSessionId) as Array<{ id: string; title: string }>
          const label = card.presentation.label ?? ''
          const match = sessions.find((row) => !bound.has(row.id) && label && row.title.includes(label))
            ?? (sessions.length === 1 && !bound.has(sessions[0]!.id) ? sessions[0] : undefined)
          if (!match) return []
          input.tracker.bindSession(card, match.id)
        }
        bound.add(card.sessionId!)
        const state = children.get(card.callId) ?? { seenTools: new Map(), texts: new Map(), cursor: 0, steps: 0 }
        children.set(card.callId, state)
        const roles = new Map<string, { role?: string; model?: string }>()
        for (const row of db.prepare('SELECT id, data FROM message WHERE session_id = ?').all(card.sessionId!) as Array<{ id: string; data: string }>) {
          const info = parse(row.data)
          roles.set(row.id, { ...(typeof info.role === 'string' ? { role: info.role } : {}), ...(typeof info.modelID === 'string' ? { model: info.modelID } : {}) })
        }
        const rows = db.prepare('SELECT id, message_id, time_updated, data FROM part WHERE session_id = ? AND time_updated >= ? ORDER BY time_updated, id')
          .all(card.sessionId!, state.cursor) as PartRow[]
        return projectChildParts(card, state, rows, roles, input.tracker)
      }))
      failures = 0
      if (drafts.length) input.emit(drafts)
    } catch (error) {
      failures += 1
      input.debug?.(`opencode child session read failed (${failures}/${MAX_FAILURES}): ${String(error).slice(0, 200)}`)
    }
  }

  const timer = setInterval(syncOnce, input.intervalMs ?? POLL_INTERVAL_MS)
  timer.unref?.()
  return {
    async stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      syncOnce()
    }
  }
}

function projectChildParts(
  card: AcpSubagentCard,
  state: ChildState,
  rows: PartRow[],
  roles: Map<string, { role?: string; model?: string }>,
  tracker: AcpSubagentTracker
): RuntimeEventDraft[] {
  const threadId = card.presentation.childThreadId!
  const turnId = externalSubagentTurnId(threadId)
  const drafts: RuntimeEventDraft[] = []
  let activity: string | undefined
  for (const row of rows) {
    state.cursor = Math.max(state.cursor, row.time_updated)
    const part = parse(row.data)
    const message = roles.get(row.message_id)
    if (message?.role !== 'assistant') continue
    const id = `oc_${row.id}`
    if (part.type === 'tool' && typeof part.tool === 'string') {
      const toolState = parse(part.state)
      const status = toolState.status
      const callId = typeof part.callID === 'string' ? part.callID : row.id
      const toolKind = /^(bash|shell)$/i.test(part.tool) ? 'command_execution' as const
        : /^(edit|write|patch|multiedit)$/i.test(part.tool) ? 'file_change' as const : 'tool_call' as const
      const args = parse(toolState.input)
      if (!state.seenTools.has(row.id) && (status === 'running' || status === 'completed' || status === 'error')) {
        state.seenTools.set(row.id, 'call')
        state.steps += 1
        activity = describeToolActivity(part.tool, args)
        drafts.push(item('tool_call_started', makeToolCallItem({
          id, turnId, threadId, callId, toolName: part.tool, toolKind, arguments: args, status: 'running'
        })))
      }
      if (state.seenTools.get(row.id) === 'call' && (status === 'completed' || status === 'error')) {
        state.seenTools.set(row.id, 'result')
        const output = typeof toolState.output === 'string' ? toolState.output : typeof toolState.error === 'string' ? toolState.error : ''
        drafts.push(item('tool_call_finished', makeToolResultItem({
          id: `${id}_result`, turnId, threadId, callId, toolName: part.tool, toolKind,
          output: output.length > MAX_OUTPUT_CHARS ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]` : output,
          isError: status === 'error', status: status === 'error' ? 'failed' : 'completed'
        })))
      }
      continue
    }
    if ((part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string' && part.text.trim()) {
      if (state.texts.get(row.id) === part.text.length) continue
      state.texts.set(row.id, part.text.length)
      const done = Boolean(parse(part.time).end)
      const make = part.type === 'text' ? makeAssistantTextItem : makeAssistantReasoningItem
      drafts.push(item('item_created', make({ id, turnId, threadId, text: part.text, status: done ? 'completed' : 'running' })))
    }
  }
  const model = [...roles.values()].reverse().find((entry) => entry.role === 'assistant' && entry.model)?.model
  if (!drafts.length && (!model || card.presentation.model)) return drafts
  drafts.push(...tracker.progress(card, {
    steps: state.steps,
    ...(activity ? { activity } : {}),
    ...(model && !card.presentation.model ? { model: clipExternalText(model, 200)! } : {})
  }))
  return drafts
}

function item(kind: 'tool_call_started' | 'tool_call_finished' | 'item_created', value: TurnItem): RuntimeEventDraft {
  return { kind, threadId: value.threadId, turnId: value.turnId, itemId: value.id, item: value }
}

function parse(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
