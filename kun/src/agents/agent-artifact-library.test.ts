import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FileArtifactStore } from '../artifacts/artifact-store.js'
import { workbenchFixture } from '../workbench-bridge/workbench-test-support.js'
import { AgentArtifactLibrary, artifactReference, bindAgentArtifactLibrary } from './agent-artifact-library.js'
import { agentArtifactTools } from './agent-artifact-tools.js'
import { resolveRoomContent } from '../rooms/room-content-service.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { bindImMessageService, roomImMessageTool } from '../rooms/room-im-message-tool.js'
import type { RoomMessage } from '../contracts/rooms.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const f = await workbenchFixture(); cleanups.push(f.cleanup)
  f.deps.artifacts = new FileArtifactStore(join(f.directory, 'artifacts'))
  const library = new AgentArtifactLibrary(f.deps)
  bindAgentArtifactLibrary(f.deps.threadStore, library)
  bindImMessageService(f.deps.threadStore, f.service)
  const input = { participantAgentId: 'agent-1', roomId: f.room.id, sourceRunId: f.runId, requestId: 'capture-1',
    workspaceRoot: f.directory, workspaceId: 'workspace', relativePath: 'nested/report.txt', title: 'Report' }
  await mkdir(join(f.directory, 'nested')); await writeFile(join(f.directory, input.relativePath), 'first version')
  return { ...f, library, input }
}

it('retains exact version bytes after overwrite and deletion and reuses the shared content store', async () => {
  const f = await fixture()
  const first = await f.library.capture(f.input)
  expect(await f.library.capture(f.input)).toEqual(first)
  await writeFile(join(f.directory, f.input.relativePath), 'second version')
  const second = await f.library.capture({ ...f.input, requestId: 'capture-2', sourceRunId: 'later-run' })
  expect(second.artifactId).toBe(first.artifactId); expect(second.version).toBe(2)
  await rm(join(f.directory, f.input.relativePath))
  const reopened = new AgentArtifactLibrary({ ...f.deps, artifacts: new FileArtifactStore(join(f.directory, 'artifacts')) })
  expect((await reopened.read('agent-1', first.artifactId, 1)).data.toString()).toBe('first version')
  expect((await reopened.read('agent-1', first.artifactId, 2)).data.toString()).toBe('second version')
  expect((await reopened.versions('agent-1', first.artifactId)).versions.map((value) => value.version)).toEqual([2, 1])
  expect((await f.deps.artifacts!.list!()).map((blob) => blob.id)).toContain(first.blobId)
  await expect(reopened.read('foreign-agent', first.artifactId, 1)).rejects.toThrow('not found')
  const runtime = { rooms: { deps: f.deps, artifactLibrary: reopened } } as unknown as ServerRuntime
  expect(await resolveRoomContent(runtime, f.room, artifactReference(first), 'preview')).toMatchObject({
    state: 'available', version: '1', preview: { text: 'first version' } })
})

it('pages/searches beyond the old recent-message/root-file limit and archives reversibly', async () => {
  const f = await fixture()
  for (let n = 0; n < 105; n++) await f.library.capture({ ...f.input, workspaceId: 'workspace-' + n, requestId: `capture-${n}`,
    title: n === 0 ? 'Old research' : `Report ${n}` })
  const page = await f.library.list('agent-1', { limit: 100 })
  expect(page.artifacts).toHaveLength(100); expect(page.nextCursor).toBeTruthy()
  expect((await f.library.list('agent-1', { limit: 100, cursor: page.nextCursor })).artifacts).toHaveLength(5)
  const old = (await f.library.list('agent-1', { search: 'old research' })).artifacts[0]
  expect(old.title).toBe('Old research')
  await f.library.archive('agent-1', old.id, { expectedRevision: old.revision, clientRequestId: 'archive', archived: true })
  expect((await f.library.list('agent-1', { search: 'old research' })).artifacts).toEqual([])
  expect((await f.library.list('agent-1', { archived: 'true' })).artifacts).toHaveLength(1)
  expect((await f.library.read('agent-1', old.id, 1)).data.toString()).toBe('first version')
})

it('exports bounded binary bytes and refuses changed content, paths and stale tool calls', async () => {
  const f = await fixture()
  const data = Buffer.alloc(1024 * 1024 + 10, 127)
  await writeFile(join(f.directory, f.input.relativePath), data)
  const artifact = await f.library.capture(f.input)
  const first = await f.library.export('agent-1', artifact.artifactId)
  expect(Buffer.from(first.dataBase64, 'base64').length).toBe(1024 * 1024)
  const last = await f.library.export('agent-1', artifact.artifactId, { offset: first.nextOffset })
  expect(Buffer.from(last.dataBase64, 'base64').length).toBe(10); expect(last.nextOffset).toBeUndefined()
  await expect(f.library.capture({ ...f.input, requestId: 'escape', relativePath: '../outside' })).rejects.toThrow()
  await symlink('/etc/passwd', join(f.directory, 'escape'))
  await expect(f.library.capture({ ...f.input, requestId: 'escape-link', relativePath: 'escape' })).rejects.toThrow('unauthorized')
  const tool = agentArtifactTools(f.deps.threadStore).find((item) => item.name === 'list_agent_artifacts')!
  expect((await tool.execute({}, f.context())).isError).not.toBe(true)
  expect((await tool.execute({}, { ...f.context(), turnId: 'stale' })).isError).toBe(true)
  await writeFile(join(f.directory, 'artifacts', artifact.blobId + '.bin'), 'tampered')
  await expect(f.library.export('agent-1', artifact.artifactId)).rejects.toThrow('integrity')
})

it('send_im_message automatically captures versioned files, idempotently', async () => {
  const f = await fixture(), tool = roomImMessageTool(f.deps.threadStore)
  const args = { text: 'Report', attachments: [{ path: f.input.relativePath }] }
  const first = await tool.execute(args, f.context())
  expect(first.isError).not.toBe(true)
  const message = await f.store.get<RoomMessage>('message', (first.output as { messageId: string }).messageId)
  expect(message?.value.references?.[0]).toMatchObject({ kind: 'agent_file', artifactId: expect.any(String), artifactVersion: 1 })
  await tool.execute(args, f.context())
  expect((await f.library.list('agent-1')).artifacts).toHaveLength(1)
  expect((await f.library.list('agent-1')).artifacts[0].version).toBe(1)
})


it('enforces historical version immutability in canonical RoomStore writes', async () => {
  const f = await fixture(), version = await f.library.capture(f.input)
  await expect(f.store.commit({ requestId: 'rewrite-history',
    checks: [{ kind: 'agent_artifact', id: version.id, expectedRevision: 0 }],
    puts: [{ kind: 'agent_artifact', id: version.id, roomId: f.room.id, value: { ...version, title: 'Changed history' } }]
  })).rejects.toThrow('immutable')
  expect((await f.library.get('agent-1', version.artifactId, 1)).title).toBe('Report')
})


it('reads bounded export chunks across boundaries and loads metadata-only summaries', async () => {
  const f = await fixture()
  const size = 4 * 1024 * 1024
  await writeFile(join(f.directory, f.input.relativePath), Buffer.concat([Buffer.alloc(size, 1), Buffer.alloc(size, 2), Buffer.alloc(10, 3)]))
  const artifact = await f.library.capture(f.input)
  expect(artifact.blobIds).toHaveLength(3)
  const reads = vi.spyOn(f.deps.artifacts!, 'get')
  const exported = await f.library.export('agent-1', artifact.artifactId, { offset: size - 10, length: 20 })
  expect(Buffer.from(exported.dataBase64, 'base64')).toEqual(Buffer.concat([Buffer.alloc(10, 1), Buffer.alloc(10, 2)]))
  expect(reads).toHaveBeenCalledTimes(2)
  reads.mockClear()
  const runtime = { rooms: { deps: f.deps, artifactLibrary: f.library } } as unknown as ServerRuntime
  expect(await resolveRoomContent(runtime, f.room, artifactReference(artifact), 'summary')).toMatchObject({ state: 'available', byteSize: 2 * size + 10 })
  expect(reads).not.toHaveBeenCalled()
})
