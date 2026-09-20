import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { RoomRuntimeDeps, RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomRunTextSegment } from '../rooms/room-run-segments.js'
import type { RoomService } from '../rooms/room-service.js'
import { roomTurnItems } from '../rooms/room-item-history.js'
import { agentStableId } from './agent-identity-service.js'

type GeneratedFile = { name: string; relativePath: string }

function safeRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replaceAll('\\', '/')
  if (!normalized || isAbsolute(normalized) || normalized.startsWith('/') ||
    normalized.includes('\0') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) return undefined
  return normalized
}

function generatedFiles(output: unknown): GeneratedFile[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return []
  const payload = output as Record<string, unknown>
  if (payload.ok === false || payload.status === 'failed' || payload.status === 'accepted' || payload.unverified === true) return []
  const candidates = [
    ...(Array.isArray(payload.generatedFiles) ? payload.generatedFiles : []),
    ...(Array.isArray(payload.generatedArtifacts) ? payload.generatedArtifacts : []),
    ...(Array.isArray(payload.files) ? payload.files : [])
  ]
  const files: GeneratedFile[] = []
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = candidate as Record<string, unknown>
    const relativePath = safeRelativePath(record.relativePath ?? record.relative_path ?? record.path)
    if (!relativePath) continue
    const name = typeof record.name === 'string' && record.name.trim()
      ? record.name.trim().slice(0, 300)
      : relativePath.split('/').at(-1) ?? relativePath
    files.push({ name, relativePath })
  }
  return files
}

async function collectRunReferences(
  deps: RoomRuntimeDeps,
  request: RoomRequestState
): Promise<import('../contracts/room-content.js').RoomContentReference[]> {
  if (!request.privateWorkspace || !request.turnId) return []
  const canonicalRoot = await realpath(request.privateWorkspace).catch(() => null)
  if (!canonicalRoot) return []
  const workspaceId = agentStableId('private-workspace', request.roomId, request.privateWorkspace)
  const references: import('../contracts/room-content.js').RoomContentReference[] = []
  const add = async (file: GeneratedFile): Promise<void> => {
    if (references.length >= 20 || references.some((ref) =>
      ref.kind === 'agent_file' && ref.relativePath === file.relativePath)) return
    const absolute = await realpath(join(request.privateWorkspace!, file.relativePath)).catch(() => null)
    if (!absolute) return
    const rel = relative(canonicalRoot, absolute)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) return
    const info = await stat(absolute).catch(() => null)
    if (!info?.isFile() || info.size > 100 * 1024 * 1024) return
    references.push({ kind: 'agent_file', workspaceId, relativePath: file.relativePath, titleSnapshot: file.name })
  }

  for await (const item of roomTurnItems(deps.sessions, request.threadId, request.turnId)) {
    if (item.kind !== 'tool_result' || item.isError) continue
    for (const file of generatedFiles(item.output)) await add(file)
    const toolName = item.toolName.replace(/^mcp__kun__/, '')
    const payload = item.output && typeof item.output === 'object' ? item.output as Record<string, unknown> : {}
    if (['write', 'edit', 'office_edit'].includes(toolName) && payload.ok !== false) {
      const path = safeRelativePath(payload.relative_path ?? payload.relativePath)
      if (path) await add({ name: path.split('/').at(-1)!, relativePath: path })
    }
  }
  return references
}

/** Draft projections are visible only; only a final response may feed memory or collaborators. */
export async function publishDirectResponse(deps: RoomRuntimeDeps, service: RoomService, request: RoomRequestState,
  segments: RoomRunTextSegment[], status: 'streaming' | 'final' | 'failed') {
  if (!request.privateRunId || (!segments.length && status === 'streaming')) return
  const member = request.roomSnapshot.members.find((item) => item.id === request.roomSnapshot.defaultMemberId)!
  const references = status === 'final' ? await collectRunReferences(deps, request) : []
  const source = await deps.store.get<import('../contracts/rooms.js').RoomMessage>('message', request.sourceMessageId)
  const displayThreadRootId = source?.value.replyToMessageId ? source.value.displayThreadRootId : undefined
  const current = await deps.store.get<RoomRequestState>('request', request.id)
  if (!current || current.value.cancellationRequested && status !== 'failed') return
  const publishSegments = segments.length || !references.length ? segments : [{
    itemId: agentStableId('private-artifact-item', request.privateRunId),
    messageId: agentStableId('private-artifact-message', request.privateRunId),
    text: 'Generated files.',
    createdAt: new Date().toISOString(),
    status: 'completed' as const
  }]
  for (let index = 0; index < publishSegments.length; index += 1) {
    const segment = publishSegments[index]!
    await service.publishSegment(request.roomId, {
      messageId: segment.messageId, runId: request.privateRunId, itemId: segment.itemId, body: segment.text,
      memberId: member.id, createdAt: segment.createdAt, status,
      references: status === 'final' && index === publishSegments.length - 1 && references.length ? references : undefined,
      displayThreadRootId
    })
  }
}
