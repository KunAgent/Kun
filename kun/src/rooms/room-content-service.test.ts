import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '../contracts/rooms.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { RoomContentReferenceSchema } from '../contracts/room-content.js'
import { agentStableId } from '../agents/agent-identity-service.js'
import { resolveRoomContent } from './room-content-service.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const room = { id: 'room', revision: 0, repositories: [] } as unknown as Room
const runtime = (records = new Map<string, unknown>()) => ({ rooms: { deps: {
  store: { get: vi.fn(async (kind, id) => records.get(`${kind}:${id}`) ?? null), list: vi.fn(async () => []) },
  threadStore: { getMetadata: vi.fn(async () => null) }
} } }) as unknown as ServerRuntime

describe('room content authorization and readonly projection', () => {
  it('rejects absolute, traversal and Windows paths in the public schema', () => {
    for (const relativePath of ['../secret', '/secret', 'C:/secret', 'safe/../../secret', 'safe\\secret']) {
      expect(RoomContentReferenceSchema.safeParse({ kind: 'repository_file', repositoryId: 'repo', relativePath }).success).toBe(false)
    }
  })
  it('reads only the exact repository file and fails closed after deletion or a symlink escape', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-room-preview-')))
    roots.push(root)
    const repository = join(root, 'repo')
    await promisify(execFile)('git', ['init', repository])
    await writeFile(join(repository, 'README.md'), '# Exact document')
    await writeFile(join(root, 'secret.txt'), 'PRIVATE OUTSIDE CONTENT')
    const scoped = { ...room, repositories: [{ id: 'repo', displayPath: repository, canonicalRoot: repository,
      gitCommonDir: join(repository, '.git'), availability: 'available' }] } as Room
    const reference = { kind: 'repository_file', repositoryId: 'repo', relativePath: 'README.md' } as const
    expect(await resolveRoomContent(runtime(), scoped, reference, 'preview')).toMatchObject({ state: 'available',
      preview: { type: 'text', text: '# Exact document', truncated: false } })
    await unlink(join(repository, 'README.md'))
    await writeFile(join(repository, 'similar-README.md'), 'Must not substitute')
    expect((await resolveRoomContent(runtime(), scoped, reference, 'preview')).state).toBe('unavailable')
    await symlink(join(root, 'secret.txt'), join(repository, 'README.md'))
    const denied = await resolveRoomContent(runtime(), scoped, reference, 'preview')
    expect(denied.state).toBe('unavailable')
    expect(JSON.stringify(denied)).not.toContain('PRIVATE OUTSIDE CONTENT')
    expect((await resolveRoomContent(runtime(), scoped, { ...reference, repositoryId: 'foreign' }, 'preview')).state).toBe('unavailable')
  })
  it('never exposes a task or immutable delivery from another room', async () => {
    const store = new Map([['task:foreign', { roomId: 'another', value: { task: { title: 'private task' } } }]])
    const denied = await resolveRoomContent(runtime(store), room, { kind: 'task', taskId: 'foreign' }, 'preview')
    expect(denied.state).toBe('unavailable')
    expect(JSON.stringify(denied)).not.toContain('private task')
  })
  it('does not reinterpret an old file reference after its repository ID is remapped', async () => {
    const reference = { kind: 'repository_file', repositoryId: 'repo', relativePath: 'README.md' } as const
    const records = new Map<string, unknown>([
      ['message:source', { roomId: room.id, value: { references: [reference], sourceRequestId: 'original' } }],
      ['request:original', { roomId: room.id, value: { roomSnapshot: { repositories: [
        { id: 'repo', canonicalRoot: '/original', gitCommonDir: '/original/.git' }
      ] } } }]
    ])
    const changed = { ...room, repositories: [{ id: 'repo', canonicalRoot: '/replacement', gitCommonDir: '/replacement/.git' }] } as Room
    expect(await resolveRoomContent(runtime(records), changed, reference, 'preview', 'source'))
      .toMatchObject({ state: 'unavailable', reason: 'repository_changed' })
  })
  it('loads attachment metadata without original bytes and requires message scope for unbound uploads', async () => {
    const records = new Map([['message:source', { roomId: room.id, value: { attachmentIds: ['image'] } }]])
    const fixture = runtime(records)
    const resolveContent = vi.fn(async () => { throw new Error('must not read image content during summary') })
    fixture.attachmentStore = { get: vi.fn(async () => ({ id: 'image', name: 'Photo', kind: 'image', mimeType: 'image/png',
      width: 800, height: 600, byteSize: 1000000, threadIds: [], workspaces: [] })), resolveContent } as never
    const reference = { kind: 'attachment', attachmentId: 'image' } as const
    expect(await resolveRoomContent(fixture, room, reference, 'summary', 'source')).toMatchObject({ state: 'available', width: 800, height: 600 })
    expect(resolveContent).not.toHaveBeenCalled()
    expect((await resolveRoomContent(fixture, room, reference, 'thumbnail', 'source')).state).toBe('available')
    expect(resolveContent).not.toHaveBeenCalled()
    expect((await resolveRoomContent(fixture, room, reference, 'preview')).state).toBe('unavailable')
    expect(resolveContent).not.toHaveBeenCalled()
  })
  it('retains exact room discussion attachments after thread cleanup without accepting foreign workspaces or forged messages', async () => {
    const records = new Map<string, unknown>([
      ['message:source', { roomId: room.id, value: { attachmentIds: ['retained-image'] } }],
      ['message:foreign', { roomId: 'another-room', value: { attachmentIds: ['retained-image'] } }],
      ['message:unrelated', { roomId: room.id, value: { attachmentIds: ['different-image'] } }]
    ])
    const fixture = runtime(records)
    const dataDir = join(tmpdir(), 'kun-content-retained-discussion')
    fixture.rooms!.deps.dataDir = dataDir
    const discussionWorkspace = join(dataDir, 'rooms', 'discussion', room.id)
    const metadata = { id: 'retained-image', name: 'Retained image', kind: 'image', mimeType: 'image/png',
      width: 64, height: 64, byteSize: 4, threadIds: ['deleted-turn-thread'], workspaces: [discussionWorkspace] }
    const resolveContent = vi.fn(async () => ({ ...metadata, data: Buffer.from('test') }))
    fixture.attachmentStore = { get: vi.fn(async () => metadata), resolveContent } as never
    const reference = { kind: 'attachment', attachmentId: metadata.id } as const
    expect(await resolveRoomContent(fixture, room, reference, 'preview', 'source')).toMatchObject({ state: 'available',
      preview: { type: 'image', image: { dataBase64: Buffer.from('test').toString('base64') } } })
    expect(resolveContent).toHaveBeenCalledWith(metadata.id, { workspace: discussionWorkspace })
    resolveContent.mockClear()
    for (const messageId of [undefined, 'missing', 'foreign', 'unrelated']) {
      expect((await resolveRoomContent(fixture, room, reference, 'preview', messageId)).state).toBe('unavailable')
    }
    for (const foreignWorkspace of [join(dataDir, 'rooms', 'discussion', 'another-room'), `${discussionWorkspace}-other`, join(tmpdir(), 'outside-data', 'rooms', 'discussion', room.id)]) {
      metadata.workspaces = [foreignWorkspace]
      expect((await resolveRoomContent(fixture, room, reference, 'preview', 'source')).state).toBe('unavailable')
    }
    expect(resolveContent).not.toHaveBeenCalled()
  })
  it('serves audio and video agent files as inline media within the preview cap', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-room-media-')))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'note.mp3'), 'audio-bytes')
    await writeFile(join(workspace, 'clip.mp4'), 'video-bytes')
    const agentRoom = { ...room, conversationKind: 'user_agent', privateWorkspace: workspace,
      members: [{ participantAgentId: 'agent-1' }] } as unknown as Room
    const workspaceId = agentStableId('private-workspace', room.id, workspace)
    const audio = await resolveRoomContent(runtime(), agentRoom,
      { kind: 'agent_file', workspaceId, relativePath: 'note.mp3' }, 'preview')
    expect(audio).toMatchObject({ state: 'available', kind: 'audio', mimeType: 'audio/mpeg',
      preview: { type: 'media', mimeType: 'audio/mpeg' } })
    const video = await resolveRoomContent(runtime(), agentRoom,
      { kind: 'agent_file', workspaceId, relativePath: 'clip.mp4' }, 'preview')
    expect(video).toMatchObject({ state: 'available', kind: 'video', mimeType: 'video/mp4',
      preview: { type: 'media', mimeType: 'video/mp4' } })
  })
  it('degrades oversized media and unsupported audio attachments to file cards', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-room-media-big-')))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'big.mp4'), Buffer.alloc(12 * 1024 * 1024 + 1))
    const agentRoom = { ...room, conversationKind: 'user_agent', privateWorkspace: workspace,
      members: [{ participantAgentId: 'agent-1' }] } as unknown as Room
    const workspaceId = agentStableId('private-workspace', room.id, workspace)
    const oversized = await resolveRoomContent(runtime(), agentRoom,
      { kind: 'agent_file', workspaceId, relativePath: 'big.mp4' }, 'preview')
    expect(oversized).toMatchObject({ state: 'available', kind: 'file', byteSize: 12 * 1024 * 1024 + 1 })
    expect(oversized.preview).toBeUndefined()
    const records = new Map([['message:source', { roomId: room.id, value: { attachmentIds: ['voice', 'huge'] } }]])
    const fixture = runtime(records)
    const voice = { id: 'voice', name: 'Voice', kind: 'file', mimeType: 'audio/mpeg', byteSize: 100, threadIds: [], workspaces: [] }
    const huge = { id: 'huge', name: 'Movie', kind: 'file', mimeType: 'video/mp4', byteSize: 13 * 1024 * 1024, threadIds: [], workspaces: [] }
    const resolveContent = vi.fn(async (id: string) => ({ data: Buffer.from('x') }))
    fixture.attachmentStore = { get: vi.fn(async (id: string) => (id === 'voice' ? voice : id === 'huge' ? huge : null)),
      resolveContent } as never
    expect(await resolveRoomContent(fixture, room, { kind: 'attachment', attachmentId: 'voice' }, 'preview', 'source'))
      .toMatchObject({ state: 'available', kind: 'audio', preview: { type: 'media', mimeType: 'audio/mpeg' } })
    resolveContent.mockClear()
    expect(await resolveRoomContent(fixture, room, { kind: 'attachment', attachmentId: 'huge' }, 'preview', 'source'))
      .toMatchObject({ state: 'available', kind: 'file' })
    expect(resolveContent).not.toHaveBeenCalled()
  })
})
