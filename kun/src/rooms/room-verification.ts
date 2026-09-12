import { resolve } from 'node:path'
import type { ToolCallTurnItem, ToolResultTurnItem } from '../contracts/items.js'
import type { RoomDelivery } from '../contracts/room-deliveries.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import { RoomChecksSchema } from './room-result-tools.js'
import { roomEvidenceHistory } from './room-evidence-history.js'

type Check = { id: string; command: string; cwd: string; purpose?: string; order: number; declarationCallId: string }
type Outcome = { call: ToolCallTurnItem; result: ToolResultTurnItem; output: Record<string, unknown>; order: number; eventSeq?: number }
const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined

/** Match declared checks to real commands, including their final background poll. */
export async function captureRoomVerification(deps: RoomRuntimeDeps, input: {
  roomId: string; taskId: string; threadId: string; turnId: string; workspace: string; deliveryId: string
}) {
  const checks = new Map<string, Check>()
  const calls = new Map<string, { item: ToolCallTurnItem; order: number }>()
  const history = await roomEvidenceHistory(deps.sessions, input.threadId, input.turnId)
  for (const { item, order } of history.items) {
    if (item.kind === 'tool_call') calls.set(item.callId, { item, order })
    if (item.kind !== 'tool_result' || item.toolName !== 'declare_room_checks' || item.isError) continue
    const output = object(item.output)
    const parsed = RoomChecksSchema.safeParse(output?.value)
    if (output?.accepted !== true || !parsed.success) continue
    for (const check of parsed.data.checks) if (!checks.has(check.id)) {
      checks.set(check.id, { ...check, cwd: resolve(input.workspace, check.cwd ?? '.'), order, declarationCallId: item.callId })
    }
  }
  const outcomes = new Map<string, Outcome>()
  const sessions = new Map<string, Outcome>()
  const incomplete: string[] = []
  let activeBackground = false
  let latestFileChangeOrder = Number.POSITIVE_INFINITY
  for (const { item, order } of history.items) {
    if (item.kind === 'tool_result' && item.toolKind === 'file_change' && !item.isError) latestFileChangeOrder = Math.min(order, latestFileChangeOrder)
    if (item.kind !== 'tool_result' || item.toolKind !== 'command_execution') continue
    const call = calls.get(item.callId)
    const output = object(item.output)
    if (!call || !output) continue
    const outcome = { call: call.item, result: item, output, order }
    // Only this thread's shell host owns session identities; another tool cannot fabricate them.
    if (item.toolName === 'background_shell') {
      const records = Array.isArray(output.sessions) ? output.sessions.map(object).filter(Boolean) : [output]
      for (const record of records) if (typeof record?.session_id === 'string' && !sessions.has(record.session_id)) {
        sessions.set(record.session_id, { ...outcome, output: record })
      }
    } else if (!outcomes.has(item.callId)) outcomes.set(item.callId, outcome)
  }
  for (const { event, order } of history.background) {
    const origin = [...outcomes.values()].find((outcome) => outcome.result.toolName === 'bash' && outcome.output.session_id === event.sessionId)
    if (!origin || (sessions.get(event.sessionId)?.order ?? Number.POSITIVE_INFINITY) < order) continue
    sessions.set(event.sessionId, { ...origin, order, eventSeq: event.seq, output: {
      session_id: event.sessionId, status: event.status, exit_code: event.exitCode,
      finished_at: event.finishedAt, output_truncated: event.outputTruncated, output_file: event.outputFilePath
    } })
  }
  // Do not freeze a delivery while any known command can still change its worktree.
  for (const outcome of outcomes.values()) {
    const id = outcome.result.toolName === 'bash' ? outcome.output.session_id : undefined
    const latest = typeof id === 'string' ? sessions.get(id) ?? outcome : outcome
    if (latest.output.status === 'running') activeBackground = true
  }
  activeBackground ||= deps.backgroundExecutionActive?.(input.threadId) === true
  if (activeBackground) incomplete.push('A background command is still running; stop or observe it before delivery.')
  if (activeBackground) return { verification: [], incomplete, status: 'not_run' as const, activeBackground }
  const verification: RoomDelivery['verification'] = []
  for (const check of checks.values()) {
    const attempts = [...outcomes.values()].filter(({ call }) => {
      const invoked = calls.get(call.callId)!
      const command = call.arguments.command ?? call.arguments.cmd
      const cwd = call.arguments.cwd ?? call.arguments.workdir
      return invoked.order < check.order && command === check.command &&
        resolve(input.workspace, typeof cwd === 'string' ? cwd : '.') === check.cwd
    }).map((outcome) => {
      const id = outcome.result.toolName === 'bash' ? outcome.output.session_id : undefined
      const poll = typeof id === 'string' ? sessions.get(id) : undefined
      return poll && poll.order < outcome.order ? { ...poll, call: outcome.call } : outcome
    }).sort((a, b) => a.order - b.order)
    const latest = attempts[0]
    const exit = latest?.output.exit_code ?? latest?.output.exitCode
    const endedAt = typeof latest?.output.finished_at === 'string' ? latest.output.finished_at : latest?.result.finishedAt
    if (!latest || typeof exit !== 'number' || !endedAt || latest.output.status === 'running') {
      incomplete.push('Declared check has no confirmed completed execution: ' + check.command)
      if (latest?.output.status === 'running') activeBackground = true
      continue
    }
    if (latestFileChangeOrder < latest.order) incomplete.push('Workspace files changed after validation; rerun: ' + check.command)
    const artifactId = input.deliveryId + '-check-' + verification.length
    await deps.store.commit({ requestId: artifactId,
      checks: [{ kind: 'artifact', id: artifactId, expectedRevision: null }],
      puts: [{ kind: 'artifact', id: artifactId, roomId: input.roomId, taskId: input.taskId, value: {
        check, deliveryId: input.deliveryId, threadId: input.threadId, turnId: input.turnId,
        attempts: attempts.map(({ call, result, output, eventSeq }) => ({ callId: call.callId, resultId: result.id, eventSeq,
          exitCode: output.exit_code ?? output.exitCode ?? null, sessionId: output.session_id,
          outputFile: output.output_file ?? output.full_output_path,
          outputTruncated: Boolean(output.output_truncated || output.truncation),
          startedAt: call.createdAt, endedAt: output.finished_at ?? result.finishedAt }))
      } }], result: { id: artifactId } })
    verification.push({ command: check.command, cwd: check.cwd, startedAt: latest.call.createdAt, endedAt,
      exitCode: exit, status: exit === 0 && !latest.result.isError && (!latest.output.status || latest.output.status === 'completed') ? 'passed' : 'failed', logArtifactId: artifactId })
  }
  if (!verification.length) incomplete.push('No declared validation command completed; validation is not claimed.')
  const passed = verification.filter((item) => item.status === 'passed').length
  const status = !verification.length ? 'not_run' as const : passed === verification.length && !incomplete.length
    ? 'passed' as const : passed ? 'partial' as const : 'failed' as const
  return { verification, incomplete: [...new Set(incomplete)].slice(0, 100), status, activeBackground }
}
