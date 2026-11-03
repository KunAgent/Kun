import { expect, it } from 'vitest'
import { putRoomDocument } from '../../../rooms/room-service.js'
import { RemoteArtifacts } from '../../files/artifacts.js'
import { transferReceipt } from '../../files/transfer-receipts.js'
import { AgentParamSchemas } from '../service.js'
import { artifactDownloadName } from './access.js'
import { agentLibraryFixture } from './library.test-support.js'

it('keeps public download names bounded, path-free and valid Unicode with their safe extension', () => {
  const name = artifactDownloadName({ title: '../' + '😀'.repeat(140), relativePath: 'private/folder/file.pdf' })
  expect(name.length).toBeLessThanOrEqual(180); expect(name.endsWith('.pdf')).toBe(true)
  expect(name).not.toContain('/'); expect(name).not.toMatch(/[\uD800-\uDBFF]\.pdf$/)
  expect(artifactDownloadName({ title: '..', relativePath: 'file.txt' })).toBe('artifact.txt')
})

it('serves all five installed SDK read contracts through the real facade without creating mutation receipts', async () => {
  const f = await agentLibraryFixture()
  try {
    const call = (method: string, params: unknown) => f.facade.execute(f.envelope(method, params)) as Promise<any>
    const runs = await call('agent.runs.list', { agentId: f.agent.id })
    const detail = await call('agent.runs.get', { agentId: f.agent.id, runId: runs.runs[0].id, expectedRevision: runs.runs[0].revision })
    expect(detail.messages.length).toBeGreaterThan(0)
    const artifacts = await call('agent.artifacts.list', { agentId: f.agent.id })
    expect(artifacts.artifacts[0].version).toBe(1)
    const get = await call('agent.artifacts.get', { agentId: f.agent.id, artifactId: f.first.artifactId, version: 1 })
    const versions = await call('agent.artifacts.versions', { agentId: f.agent.id, artifactId: f.first.artifactId })
    expect(versions.versions[0].sha256).toBe(get.artifact.sha256)
    expect(await f.store.list('remote_receipt')).toEqual([])
  } finally { await f.close() }
})

it('lists bounded personal runs, strips raw execution configuration and links only verified sources', async () => {
  const f = await agentLibraryFixture()
  try {
    await f.run('run-two', { status: 'failed', outcome: 'failed' })
    await f.run('memory-phase', { phase: 'memory' })
    const row = (await f.store.get<any>('room', f.room.id))!
    await putRoomDocument(f.store, 'room', 'group-room', 'group-room', { ...row.value, id: 'group-room', conversationKind: 'group' }, null)
    await f.run('group-run', { roomId: 'group-room' })
    const first = await f.call('agent.runs.list', { agentId: f.agent.id, limit: 1 })
    expect(first).toMatchObject({ complete: false, hasMore: true })
    expect(first.runs[0]).toMatchObject({ id: 'run-two', errorCode: 'RUN_FAILED', status: 'failed' })
    const next = await f.call('agent.runs.list', { agentId: f.agent.id, limit: 1, cursor: first.nextCursor })
    expect(next.runs.map((run: any) => run.id)).toEqual(['run-one'])
    expect(next).toMatchObject({ complete: true, hasMore: false })
    const serialized = JSON.stringify([first, next])
    for (const hidden of ['INTERNAL_SYSTEM_PROMPT', 'PRIVATE_PROVIDER', 'PRIVATE_CREDENTIAL', 'PRIVATE_EXCEPTION', '/secret/path', 'private-gui-thread', 'memory-phase', 'group-run'])
      expect(serialized).not.toContain(hidden)
    expect(next.runs[0].source).toMatchObject({ resource: { kind: 'agent', id: f.agent.id }, roomId: f.room.id, runId: 'run-one', messageId: 'reply-1' })
    expect(next.runs[0].source.code).toBeUndefined()
    await expect(f.call('agent.runs.list', { agentId: f.agent.id, status: 'failed', cursor: first.nextCursor })).rejects.toThrow('INVALID_CURSOR')
  } finally { await f.close() }
})

it('continues a bounded scan past more than one hundred out-of-scope runs without claiming no history', async () => {
  const f = await agentLibraryFixture()
  try {
    const row = (await f.store.get<any>('room', f.room.id))!
    await putRoomDocument(f.store, 'room', 'group-room', 'group-room', { ...row.value, id: 'group-room', conversationKind: 'group' }, null)
    for (let n = 0; n < 110; n++) await f.run('group-' + n, { roomId: 'group-room' })
    const first = await f.call('agent.runs.list', { agentId: f.agent.id, limit: 20 })
    expect(first).toMatchObject({ runs: [], hasMore: true, complete: false })
    const next = await f.call('agent.runs.list', { agentId: f.agent.id, limit: 20, cursor: first.nextCursor })
    expect(next).toMatchObject({ hasMore: false, complete: true })
    expect(next.runs.map((run: any) => run.id)).toEqual(['run-one'])
  } finally { await f.close() }
})
it('reads a run-bound public message completely with both run and message revision fences', async () => {
  const f = await agentLibraryFixture()
  try {
    const summary = (await f.call('agent.runs.list', { agentId: f.agent.id })).runs[0]
    const base = { agentId: f.agent.id, runId: summary.id, expectedRevision: summary.revision }
    const detail = await f.call('agent.runs.get', base), reply = detail.messages.find((item: any) => item.id === 'reply-1')
    expect(reply).toMatchObject({ bodyRevision: 0, contentTruncated: true })
    let text = '', offset = 0
    do {
      const result = await f.call('agent.runs.get', { ...base, messageId: reply.id, expectedMessageRevision: reply.bodyRevision, contentOffset: offset, maxChars: 997 })
      text += result.message.content.text; offset = result.message.content.nextOffset
    } while (offset !== undefined)
    expect(text).toBe((await f.store.get<any>('message', reply.id))!.value.body)
    await expect(f.call('agent.runs.get', { ...base, messageId: f.candidate.id, expectedMessageRevision: 0 })).rejects.toThrow('NOT_FOUND')
    const row = (await f.store.get<any>('message', reply.id))!
    await putRoomDocument(f.store, 'message', row.id, f.room.id, { ...row.value, body: 'Changed', bodyRevision: 1 }, row)
    await expect(f.call('agent.runs.get', { ...base, messageId: reply.id, expectedMessageRevision: 0 })).rejects.toThrow('REVISION_CONFLICT')
    expect(() => AgentParamSchemas['agent.runs.get'].parse({ ...base, messageId: reply.id })).toThrow()
    expect(() => AgentParamSchemas['agent.runs.get'].parse({ ...base, contentOffset: 1 })).toThrow()
  } finally { await f.close() }
})
it('filters hidden setup, deleted rooms, foreign Agents and foreign published message identifiers', async () => {
  const f = await agentLibraryFixture()
  try {
    const other = (await f.rooms.agents.create({ clientRequestId: 'other', name: 'Other' })).agent
    await expect(f.call('agent.runs.get', { agentId: other.id, runId: f.firstRun.id, expectedRevision: 1 })).rejects.toThrow('NOT_FOUND')
    await expect(f.call('agent.artifacts.get', { agentId: other.id, artifactId: f.first.artifactId, version: 1 })).rejects.toThrow('NOT_FOUND')
    const message = (await f.store.get<any>('message', 'reply-1'))!
    await putRoomDocument(f.store, 'message', message.id, f.room.id, { ...message.value, originRunId: 'foreign-run' }, message)
    expect((await f.call('agent.runs.get', { agentId: f.agent.id, runId: f.firstRun.id, expectedRevision: 1 })).messages.map((item: any) => item.id)).not.toContain('reply-1')
    const source = (await f.store.get<any>('message', f.source.id))!
    await putRoomDocument(f.store, 'message', source.id, f.room.id, { ...source.value, presentationKind: 'setup' }, source)
    expect((await f.call('agent.runs.list', { agentId: f.agent.id })).runs).toEqual([])
    const room = (await f.store.get<any>('room', f.room.id))!
    await putRoomDocument(f.store, 'room', room.id, room.id, { ...room.value, conversationKind: 'group' }, room)
    expect((await f.call('agent.artifacts.list', { agentId: f.agent.id })).artifacts).toEqual([])
    await expect(new RemoteArtifacts(f.runtime).readAgent(f.agent.id, f.first.artifactId, 1)).rejects.toThrow('INVALID_REQUEST')
    const group = (await f.store.get<any>('room', f.room.id))!
    await putRoomDocument(f.store, 'room', room.id, room.id, { ...room.value, deletedAt: new Date().toISOString() }, group)
    await expect(f.call('agent.artifacts.get', { agentId: f.agent.id, artifactId: f.first.artifactId, version: 1 })).rejects.toThrow('NOT_FOUND')
    await expect(new RemoteArtifacts(f.runtime).readAgent(f.agent.id, f.first.artifactId, 1)).rejects.toThrow('NOT_FOUND')
  } finally { await f.close() }
})
it('projects exact immutable artifact versions and safely downloads each via existing native byte export', async () => {
  const f = await agentLibraryFixture()
  try {
    await f.run('run-two'); const second = await f.capture(2, 'run-two')
    const page = await f.call('agent.artifacts.versions', { agentId: f.agent.id, artifactId: f.first.artifactId, limit: 1 })
    expect(page).toMatchObject({ currentVersion: 2, complete: false, hasMore: true })
    expect(page.versions[0]).toMatchObject({ version: 2, available: true, name: 'Public report.txt', source: { runId: 'run-two', messageId: 'reply-2' } })
    const older = await f.call('agent.artifacts.versions', { agentId: f.agent.id, artifactId: f.first.artifactId, limit: 1, cursor: page.nextCursor })
    expect(older.versions[0]).toMatchObject({ version: 1, available: true, source: { runId: 'run-one', messageId: 'reply-1' } })
    expect(older).toMatchObject({ hasMore: false, complete: true })
    for (const entry of [page.versions[0], older.versions[0]]) {
      const bytes = await new RemoteArtifacts(f.runtime).readAgent(f.agent.id, entry.id, entry.version)
      expect(bytes.data.toString()).toBe('Immutable version ' + entry.version)
      expect(bytes.name).toBe(entry.name)
    }
    const serialized = JSON.stringify([page, older])
    for (const hidden of ['relativePath', 'workspaceId', 'private-workspace', 'blobId', 'native-report.txt', 'PRIVATE_CREDENTIAL', 'private-gui-thread']) expect(serialized).not.toContain(hidden)
    expect((await f.call('agent.artifacts.get', { agentId: f.agent.id, artifactId: second.artifactId, version: 1 })).artifact.sha256).toBe(f.first.sha256)
    await f.rooms.deps.artifacts!.delete!(second.blobId)
    expect((await f.call('agent.artifacts.get', { agentId: f.agent.id, artifactId: second.artifactId, version: 2 })).artifact.available).toBe(false)
  } finally { await f.close() }
})
it('keeps artifact archive retention distinct, binds version cursors and download receipts to exact version', async () => {
  const f = await agentLibraryFixture()
  try {
    await f.run('run-two'); await f.capture(2, 'run-two')
    const page = await f.call('agent.artifacts.versions', { agentId: f.agent.id, artifactId: f.first.artifactId, limit: 1 })
    const latest = await f.rooms.artifactLibrary.get(f.agent.id, f.first.artifactId)
    await f.rooms.artifactLibrary.archive(f.agent.id, latest.artifactId, { archived: true, expectedRevision: latest.revision, clientRequestId: 'archive' })
    expect((await f.call('agent.artifacts.list', { agentId: f.agent.id })).artifacts).toEqual([])
    expect((await f.call('agent.artifacts.list', { agentId: f.agent.id, archived: true })).artifacts[0].status).toBe('archived')
    await expect(f.call('agent.artifacts.versions', { agentId: f.agent.id, artifactId: f.first.artifactId, cursor: page.nextCursor })).rejects.toThrow('INVALID_CURSOR')
    const raw = { accountId: 'owner', deviceId: 'phone', authorizationId: 'connection', requestId: 'exact-version', method: 'attachment.export',
      params: { artifactId: f.first.artifactId, agentId: f.agent.id, version: 1 }, action: 'start' }
    expect(await transferReceipt(f.rooms, raw)).toEqual({ started: true })
    await expect(transferReceipt(f.rooms, { ...raw, params: { ...raw.params, version: 2 } })).rejects.toThrow('REQUEST_CONFLICT')
  } finally { await f.close() }
})
it('never adds an internal GUI thread link, but verifies a real permitted Code task before linking it', async () => {
  const f = await agentLibraryFixture()
  try {
    const code = await f.code('Public Code source')
    await f.run('code-run', { threadId: code.id })
    const list = await f.call('agent.runs.list', { agentId: f.agent.id })
    expect(list.runs[0].source.code).toMatchObject({ resource: { kind: 'code', id: code.id } })
    const other = (await f.rooms.agents.create({ clientRequestId: 'other', name: 'Other' })).agent
    const cursor = (await f.call('agent.artifacts.versions', { agentId: f.agent.id, artifactId: f.first.artifactId, limit: 1 })).nextCursor
    if (cursor) await expect(f.call('agent.artifacts.versions', { agentId: other.id, artifactId: f.first.artifactId, cursor })).rejects.toThrow('NOT_FOUND')
  } finally { await f.close() }
})
