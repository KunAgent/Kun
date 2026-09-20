import { privateWorkspace } from '../agents/agent-direct-service.js'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import type { Room, RoomMessage, RoomRepository } from '../contracts/rooms.js'
import type { RoomTaskExecution, RoomRequestState } from './room-runtime-types.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomDelivery } from '../contracts/room-deliveries.js'
import type { RoomContentReference, RoomContentResult } from '../contracts/room-content.js'
import { EXCALIDRAW_PNG_SIDECAR_PATTERN } from '../contracts/generated-image-path.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { roomGit } from './room-git.js'
import { roomPreviewImage } from './room-preview-image.js'
import { roomUploadedPreviewImage } from './room-uploaded-preview.js'

export type RoomContentMode = 'summary' | 'thumbnail' | 'preview'
export function roomContentReferenceKey(reference: RoomContentReference): string {
  const { titleSnapshot: _title, ...identity } = reference
  return JSON.stringify(identity)
}
export async function assertRoomContentRepository(room: Room, repositoryId: string): Promise<RoomRepository> {
  const repository = room.repositories.find((item) => item.id === repositoryId)
  if (!repository) throw new Error('repository_unauthorized')
  if (repository.availability !== 'available') throw new Error('repository_unavailable')
  const root = await realpath(repository.canonicalRoot)
  if (root !== repository.canonicalRoot || await realpath(repository.displayPath) !== root) throw new Error('repository_moved')
  const common = await realpath(await roomGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
  if (common !== repository.gitCommonDir) throw new Error('repository_changed')
  return repository
}
function inside(root: string, path: string): boolean {
  const pathWithin = relative(root, path)
  return pathWithin !== '..' && !pathWithin.startsWith('../') && !isAbsolute(pathWithin)
}
export async function readRoomRepositoryFile(repository: Pick<RoomRepository, 'canonicalRoot'>, relativePath: string, maxBytes: number) {
  const path = await realpath(resolve(repository.canonicalRoot, relativePath))
  if (!inside(repository.canonicalRoot, path)) throw new Error('file_unauthorized')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    const observedPath = await realpath(resolve(repository.canonicalRoot, relativePath))
    const observed = await stat(observedPath)
    if (!inside(repository.canonicalRoot, observedPath) || info.dev !== observed.dev || info.ino !== observed.ino || !info.isFile()) {
      throw new Error('file_changed')
    }
    const bytes = Buffer.alloc(Math.min(info.size, maxBytes))
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    return { data: bytes.subarray(0, bytesRead), size: info.size }
  } finally { await handle.close() }
}

async function attachmentScope(runtime: ServerRuntime, room: Room, id: string, messageId?: string, allowDraft = false) {
  if (!runtime.attachmentStore) throw new Error('attachment_unavailable')
  const metadata = await runtime.attachmentStore.get(id)
  if (!metadata) throw new Error('attachment_missing')
  let message: RoomMessage | undefined
  if (messageId) {
    const record = await runtime.rooms!.deps.store.get<RoomMessage>('message', messageId)
    if (!record || record.roomId !== room.id) throw new Error('message_unavailable')
    message = record.value
    if (!message.attachmentIds.includes(id) && !message.references?.some((ref) => ref.kind === 'attachment' && ref.attachmentId === id)) {
      throw new Error('attachment_unauthorized')
    }
  }
  const workspace = metadata.workspaces.find((root) => room.repositories.some((repository) => repository.canonicalRoot === root))
  if (workspace) {
    await assertRoomContentRepository(room, room.repositories.find((repo) => repo.canonicalRoot === workspace)!.id)
    return { metadata, scope: { workspace } }
  }
  if (message && metadata.workspaces.length) {
    const discussionWorkspace = resolve(runtime.rooms!.deps.dataDir, 'rooms', 'discussion', room.id)
    if (metadata.workspaces.includes(discussionWorkspace)) return { metadata, scope: { workspace: discussionWorkspace } }
  }
  for (const threadId of metadata.threadIds.slice(0, 100)) {
    const thread = await runtime.rooms!.deps.threadStore.getMetadata?.(threadId)
    if (thread?.roomContext?.roomId === room.id) return { metadata, scope: { threadId } }
  }
  if ((message || allowDraft) && metadata.threadIds.length === 0 && metadata.workspaces.length === 0) return { metadata, scope: {} }
  throw new Error('attachment_unauthorized')
}
function attachmentSummary(metadata: AttachmentMetadata) {
  return { title: metadata.name, kind: metadata.kind === 'image' ? 'image' as const : 'file' as const,
    mimeType: metadata.mimeType, byteSize: metadata.byteSize, width: metadata.width, height: metadata.height,
    description: metadata.documentFormat?.toUpperCase() }
}
const textExtensions = new Set(['.txt', '.md', '.mdx', '.json', '.xml', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.rs',
  '.go', '.java', '.css', '.html', '.yaml', '.yml', '.toml', '.sh', '.sql', '.c', '.h', '.cpp', '.vue', '.svelte', '.log'])
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

async function assertReferenceSource(runtime: ServerRuntime, room: Room, reference: RoomContentReference, messageId?: string) {
  if (!messageId || reference.kind === 'attachment') return
  const store = runtime.rooms!.deps.store
  const source = await store.get<RoomMessage>('message', messageId)
  if (!source || source.roomId !== room.id || !source.value.references?.some((item) => roomContentReferenceKey(item) === roomContentReferenceKey(reference))) {
    throw new Error('reference_unavailable')
  }
  if (reference.kind !== 'repository_file' && reference.kind !== 'board_card') return
  const requestId = source.value.sourceRequestId ?? source.value.rootRequestId
  const request = requestId ? await store.get<RoomRequestState>('request', requestId) : null
  const original = request?.roomId === room.id ? request.value.roomSnapshot.repositories.find((item) => item.id === reference.repositoryId) : undefined
  const current = room.repositories.find((item) => item.id === reference.repositoryId)
  if (!original || !current || original.canonicalRoot !== current.canonicalRoot || original.gitCommonDir !== current.gitCommonDir) {
    throw new Error('repository_changed')
  }
}

export async function resolveRoomContent(runtime: ServerRuntime, room: Room, reference: RoomContentReference,
  mode: RoomContentMode = 'summary', messageId?: string, allowDraft = false): Promise<RoomContentResult> {
  const result: RoomContentResult = { reference, state: 'available', title: reference.titleSnapshot ?? reference.kind }
  try {
    await assertReferenceSource(runtime, room, reference, messageId)
    const store = runtime.rooms!.deps.store
    if (reference.kind === 'agent_file') {
      let workspace = await privateWorkspace(runtime.rooms!, room)
      if (workspace.id !== reference.workspaceId) workspace = await privateWorkspace(runtime.rooms!, { ...room, privateWorkspace: undefined })
      if (workspace.id !== reference.workspaceId) throw new Error('workspace_changed')
      const root = await realpath(workspace.path)
      const sidecar = reference.relativePath.match(EXCALIDRAW_PNG_SIDECAR_PATTERN)
      if (sidecar) {
        const boardId = sidecar[1]
        const file = await readRoomRepositoryFile({ canonicalRoot: root }, reference.relativePath, 12 * 1024 * 1024)
        Object.assign(result, { title: reference.relativePath, kind: 'image', mimeType: 'image/png', byteSize: file.size,
          openTarget: { kind: 'excalidraw_board', workspaceRoot: root, boardId } })
        if (mode === 'thumbnail') result.thumbnail = await roomPreviewImage(file.data)
        else if (mode === 'preview') result.preview = { type: 'image', image: { dataBase64: file.data.toString('base64'),
          mimeType: 'image/png', width: 1, height: 1 } }
      } else {
        const extension = extname(reference.relativePath).toLowerCase()
        const imageFile = imageExtensions.has(extension)
        const file = await readRoomRepositoryFile({ canonicalRoot: root }, reference.relativePath,
          imageFile ? 12 * 1024 * 1024 : 128 * 1024)
        Object.assign(result, { title: reference.relativePath, kind: imageFile ? 'image' : 'file', byteSize: file.size,
          ...(imageFile ? { mimeType: extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : `image/${extension.slice(1)}` } : {}),
          openTarget: { kind: ['.pdf', '.docx', '.xlsx', '.pptx'].includes(extension) ? 'work_file' : 'code_file',
            workspaceRoot: root, relativePath: reference.relativePath } })
        if (imageFile && mode === 'thumbnail') result.thumbnail = await roomPreviewImage(file.data)
        else if (imageFile && mode === 'preview') result.preview = { type: 'image', image: {
          dataBase64: file.data.toString('base64'), mimeType: result.mimeType!, width: 1, height: 1 } }
        else if (mode === 'preview' && !file.data.includes(0)) result.preview = {
          type: 'text', text: file.data.toString('utf8'), truncated: file.size > file.data.length }
      }
    } else if (reference.kind === 'attachment') {
      const { metadata, scope } = await attachmentScope(runtime, room, reference.attachmentId, messageId, allowDraft && mode === 'summary')
      Object.assign(result, attachmentSummary(metadata))
      if (mode === 'thumbnail' && metadata.kind === 'image') {
        const small = metadata.visualPreview ?? metadata.textFallback
        // History cards consume the upload-time display projection only.
        // Legacy originals remain behind an explicit lightbox open.
        if (small && small.dataBase64.length <= 2 * 1024 * 1024) {
          result.thumbnail = await roomUploadedPreviewImage(small)
        }
      }
      if (mode === 'preview') {
        if (metadata.kind === 'image') {
          if (metadata.byteSize > 12 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(metadata.mimeType)) {
            throw new Error('unsupported_or_oversized_image')
          }
          const content = await runtime.attachmentStore!.resolveContent(metadata.id, scope)
          result.preview = { type: 'image', image: { dataBase64: content.data.toString('base64'), mimeType: metadata.mimeType,
            width: metadata.width ?? 1, height: metadata.height ?? 1 } }
        } else if (metadata.documentText !== undefined) {
          result.preview = { type: 'text', text: metadata.documentText.slice(0, 64000), truncated: metadata.documentText.length > 64000 || Boolean(metadata.truncated) }
        } else if (/^(text\/|application\/(json|xml))/.test(metadata.mimeType) && metadata.byteSize <= 2 * 1024 * 1024) {
          const content = await runtime.attachmentStore!.resolveContent(metadata.id, scope)
          result.preview = { type: 'text', text: content.data.subarray(0, 64000).toString('utf8'), truncated: content.data.length > 64000 }
        }
      }
    } else if (reference.kind === 'repository_file') {
      const repository = await assertRoomContentRepository(room, reference.repositoryId)
      const file = await readRoomRepositoryFile(repository, reference.relativePath, mode === 'summary' ? 0 : 64000)
      const extension = extname(reference.relativePath).toLowerCase()
      Object.assign(result, { title: reference.relativePath.split('/').at(-1), description: reference.relativePath,
        kind: imageExtensions.has(extension) ? 'image' : 'file', byteSize: file.size,
        openTarget: { kind: ['.pdf', '.docx', '.xlsx', '.pptx'].includes(extension) ? 'work_file' : 'code_file',
          workspaceRoot: repository.canonicalRoot, relativePath: reference.relativePath } })
      if (mode !== 'summary' && imageExtensions.has(extension)) {
        if (file.size > 12 * 1024 * 1024) throw new Error('image_too_large')
        const image = await readRoomRepositoryFile(repository, reference.relativePath, 12 * 1024 * 1024)
        if (mode === 'thumbnail') result.thumbnail = await roomPreviewImage(image.data)
        else result.preview = { type: 'image', image: { dataBase64: image.data.toString('base64'),
          mimeType: extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : `image/${extension.slice(1)}`, width: 1, height: 1 } }
      } else if (mode === 'preview' && textExtensions.has(extension) && !file.data.includes(0)) {
        result.preview = { type: 'text', text: file.data.toString('utf8'), truncated: file.size > file.data.length }
      }
    } else if (reference.kind === 'task' || reference.kind === 'delivery') {
      const row = await store.get<RoomTaskExecution>('task', reference.taskId)
      if (!row || row.roomId !== room.id || row.value.task.id !== reference.taskId || row.value.task.roomId !== room.id) throw new Error('task_unavailable')
      Object.assign(result, { title: row.value.task.title, status: row.value.task.status, kind: reference.kind,
        openTarget: { kind: 'thread', threadId: row.value.task.executionThreadId, turnId: row.value.turnId } })
      if (reference.kind === 'task') {
        result.description = row.value.task.latestProgress?.slice(0, 500)
        if (mode === 'preview') result.preview = { type: 'text', text: row.value.task.latestProgress ?? row.value.task.title, truncated: false }
      } else {
        const delivery = await store.get<RoomDelivery>('delivery', reference.deliveryId)
        if (!delivery || delivery.roomId !== room.id || delivery.taskId !== reference.taskId || delivery.value.taskId !== reference.taskId) {
          throw new Error('delivery_unavailable')
        }
        Object.assign(result, { version: delivery.value.versionHash, description: delivery.value.summary.slice(0, 500) })
        delete result.status
        delete result.openTarget
        const runs = await store.list<RoomRunRecord>('room_run', { roomId: room.id, taskId: reference.taskId, phase: 'execution', limit: 200 })
        const exact = runs.filter((run) => run.value.attempt === delivery.value.version && run.value.threadId && run.value.turnId)
        if (exact.length === 1) result.openTarget = { kind: 'thread', threadId: exact[0].value.threadId!, turnId: exact[0].value.turnId }
        if (mode === 'preview') {
          const artifact = await store.get<string>('artifact', delivery.value.diffArtifactId)
          if (!artifact || artifact.roomId !== room.id || artifact.taskId !== reference.taskId || typeof artifact.value !== 'string') throw new Error('delivery_content_unavailable')
          result.preview = { type: 'text', text: artifact.value.slice(0, 64000), truncated: artifact.value.length > 64000 }
        }
      }
    } else {
      const repository = await assertRoomContentRepository(room, reference.repositoryId)
      if (!runtime.projectBoardService) throw new Error('board_unavailable')
      const { card } = await runtime.projectBoardService.card({ workspace: repository.canonicalRoot, cardId: reference.cardId })
      if (!card || card.workspaceRoot !== repository.canonicalRoot) throw new Error('card_unavailable')
      Object.assign(result, { title: card.title, kind: 'board_card', status: card.status, description: card.description.slice(0, 500),
        openTarget: { kind: 'board', workspaceRoot: repository.canonicalRoot, cardId: card.id } })
      if (mode === 'preview') result.preview = { type: 'text', text: card.description, truncated: false }
    }
    return result
  } catch (error) {
    return { reference, state: 'unavailable', title: result.title,
      reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'content_missing' : error instanceof Error ? error.message : 'content_unavailable' }
  }
}
