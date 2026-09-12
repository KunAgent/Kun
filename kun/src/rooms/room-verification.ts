import type { TurnItem, ToolCallTurnItem } from '../contracts/items.js'
import type { RoomDelivery } from '../contracts/room-deliveries.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'

/** Collect only actual command outcomes; assistant prose never becomes evidence. */
export async function captureRoomVerification(deps: RoomRuntimeDeps, input: {
  roomId: string; taskId: string; threadId: string; turnId: string; workspace: string; deliveryId: string
}) {
  const items: TurnItem[] = deps.sessions.loadItemPage
    ? (await deps.sessions.loadItemPage(input.threadId, { maxItems: 1000, maxBytes: 4 * 1024 * 1024, anchorTurnId: input.turnId })).items
    : await deps.sessions.loadItems(input.threadId)
  const calls = new Map(items.filter((item): item is ToolCallTurnItem => item.kind === 'tool_call' && item.turnId === input.turnId)
    .map((item) => [item.callId, item]))
  const verification: RoomDelivery['verification'] = []
  const incomplete: string[] = []
  for (const item of items) {
    if (item.kind !== 'tool_result' || item.turnId !== input.turnId) continue
    if (item.isError) incomplete.push('Tool ' + item.toolName + ' reported an error; inspect the execution record.')
    const call = calls.get(item.callId)
    if (!call || item.toolKind !== 'command_execution' || typeof item.output !== 'object' || !item.output) continue
    const output = item.output as Record<string, unknown>
    const exit = output.exit_code ?? output.exitCode
    const command = call.arguments.command ?? call.arguments.cmd
    // Only validation commands contribute to the verification badge.
    if (typeof command !== 'string' || !/\b(test|vitest|jest|pytest|typecheck|tsc|lint|eslint|build|check)\b/i.test(command)) continue
    if (typeof exit !== 'number' || !item.finishedAt) {
      incomplete.push('A validation command has no confirmed exit status.')
      continue
    }
    const artifactId = input.deliveryId + '-log-' + verification.length
    await deps.store.commit({ requestId: artifactId,
      checks: [{ kind: 'artifact', id: artifactId, expectedRevision: null }],
      puts: [{ kind: 'artifact', id: artifactId, roomId: input.roomId, taskId: input.taskId, value: item }],
      result: { id: artifactId } })
    verification.push({ command, cwd: typeof call.arguments.cwd === 'string' ? call.arguments.cwd : input.workspace,
      startedAt: call.createdAt, endedAt: item.finishedAt, exitCode: exit,
      status: exit === 0 && !item.isError ? 'passed' : 'failed', logArtifactId: artifactId })
  }
  if (!verification.length) incomplete.push('No completed validation command was captured; validation is not claimed.')
  const passed = verification.filter((item) => item.status === 'passed').length
  const status = !verification.length ? 'not_run' as const : passed === verification.length && !incomplete.length
    ? 'passed' as const : passed ? 'partial' as const : 'failed' as const
  return { verification, incomplete: [...new Set(incomplete)].slice(0, 100), status }
}
