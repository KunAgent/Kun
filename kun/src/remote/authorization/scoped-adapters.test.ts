import { describe, expect, it, vi } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RemoteAuthority, RemoteScopeName } from './scopes.js'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { openAgentConversation } from '../../agents/agent-conversations.js'
import { WorkbenchLinkSchema } from '../../contracts/workbench-links.js'
import { RoomRunRecordSchema } from '../../contracts/room-runs.js'
import { ExtensionPaths, ExtensionRegistry, ExtensionPackageManager, parseExtensionManifest } from '../../extensions/index.js'
import type { ExtensionPlatformRuntime } from '../../server/routes/server-runtime.js'
const authority = (...scopes: RemoteScopeName[]): RemoteAuthority => ({ accountId: 'owner', deviceId: 'phone', authorizationId: 'grant', scopes })
async function fixture() {
  const f = await remoteFixture()
  const group = (await f.rooms.service.create({ name: 'Team', clientRequestId: 'group' })).room
  const agent = (await f.rooms.agents.create({ clientRequestId: 'agent', name: 'Personal' })).agent
  const personal = (await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)).room
  return { ...f, group, personal, agent,
    invoke: async (scope: RemoteAuthority, method: string, params: unknown, requestId = 'read') => {
      const result = await f.facade.execute({ ...scope, call: { method, requestId, params, expiresAt: Date.now() + 60000 } }) as any
      return result?.receipt ? result.receipt.result : result
    } }
}
describe('Remote adapters require independent trusted scopes', () => {
  it('default personal authority neither advertises nor reads group, collaboration, schedule or plugin data', async () => {
    const f = await fixture()
    try {
      const scope = authority()
      expect((await f.invoke(scope, 'catalog.get', {})).capabilityDescriptors.filter((d: any) =>
        d.operation === 'agent.directory.list' || /^(group|collaboration|schedule|plugin)\./.test(d.operation))
        .map((d: any) => d.operation)).toEqual(['agent.directory.list'])
      const get = vi.spyOn(f.store, 'get'), list = vi.spyOn(f.store, 'list')
      for (const method of ['group.list', 'group.history', 'group.message.send', 'collaboration.runs.list',
        'collaboration.tasks.list', 'schedule.list', 'schedule.runs.list', 'plugin.catalog', 'plugin.view'])
        await expect(f.invoke(scope, method, { roomId: f.group.id, text: 'no grant', scopes: ['groups.read'] })).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
      expect(get).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled()
      expect((await f.call('catalog.get', {})).capabilityDescriptors.some((d: any) => d.operation.startsWith('group.'))).toBe(false)
    } finally { await f.close() }
  })
  it('reads only group rooms, sends through native api authority and deduplicates by stable request id', async () => {
    const f = await fixture(), scope = authority('groups.read', 'groups.write')
    try {
      const list = await f.invoke(scope, 'group.list', {})
      expect(list.groups.map((g: any) => g.id)).toEqual([f.group.id])
      expect(JSON.stringify(list)).not.toContain('canonicalRoot')
      await expect(f.invoke(scope, 'group.history', { roomId: f.personal.id })).rejects.toThrow('NOT_A_GROUP')
      await expect(f.invoke(authority('groups.read'), 'group.message.send', { roomId: f.group.id, text: 'refused' })).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
      const params = { roomId: f.group.id, text: 'one input', executionIntent: 'discussion' }
      const first = await f.invoke(scope, 'group.message.send', params, 'send_once')
      expect(await f.invoke(scope, 'group.message.send', params, 'send_once')).toEqual(first)
      const row = await f.store.get<any>('request', first.requestId)
      expect(row?.value).toMatchObject({ clientSurface: 'api', remoteDeviceId: 'phone' })
      const history = await f.invoke(scope, 'group.history', { roomId: f.group.id })
      expect(history.messages.filter((m: any) => m.authorKind === 'user')).toHaveLength(1)
      expect(history.messages[0].body).toBe('one input')
      expect(history.messages[0]).not.toHaveProperty('requestFingerprint')
      expect(history.room).not.toHaveProperty('repositories')
    } finally { await f.close() }
  })
  it('applies bounded history without dropping the oldest omitted message', async () => {
    const f = await fixture(), scope = authority('groups.read')
    try {
      for (let i = 0; i < 3; i++) await f.rooms.service.append(f.group.id, 'large_' + i, '\u0000'.repeat(64000))
      const first = await f.invoke(scope, 'group.history', { roomId: f.group.id, limit: 20 })
      expect(first.messages).toHaveLength(1); expect(first.hasMore).toBe(true)
      const second = await f.invoke(scope, 'group.history', { roomId: f.group.id, limit: 20, cursor: first.nextCursor })
      expect(second.messages).toHaveLength(1)
      const third = await f.invoke(scope, 'group.history', { roomId: f.group.id, limit: 20, cursor: second.nextCursor })
      expect(third.messages).toHaveLength(1); expect(third.hasMore).toBe(false)
      expect(new Set([first, second, third].flatMap((page) => page.messages.map((m: any) => m.id))).size).toBe(3)
    } finally { await f.close() }
  })
  it('collaboration reads require both group and collaboration scopes, project only safe native run metadata', async () => {
    const f = await fixture()
    try {
      const now = new Date().toISOString(), run = RoomRunRecordSchema.parse({ id: 'run', roomId: f.group.id,
        memberId: 'member', memberLabel: 'Member', phase: 'discussion', attempt: 1, clientRequestId: 'run-key',
        input: 'hidden coordination prompt', accountId: 'credential-account', status: 'completed', createdAt: now, updatedAt: now })
      await f.store.commit({ requestId: 'seed-run', checks: [{ kind: 'room_run', id: run.id, expectedRevision: null }],
        puts: [{ kind: 'room_run', id: run.id, roomId: run.roomId, value: run }] })
      await expect(f.invoke(authority('groups.read'), 'collaboration.runs.list', { roomId: f.group.id })).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
      await expect(f.invoke(authority('collaboration.read'), 'collaboration.runs.list', { roomId: f.group.id })).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
      const page = await f.invoke(authority('groups.read', 'collaboration.read'), 'collaboration.runs.list', { roomId: f.group.id })
      expect(page.runs[0]).toMatchObject({ id: 'run', status: 'completed' })
      expect(JSON.stringify(page)).not.toContain('coordination prompt'); expect(JSON.stringify(page)).not.toContain('credential-account')
    } finally { await f.close() }
  })
  it('reads actual runtime scheduled series and runs while filtering group schedules without groups.read', async () => {
    const f = await fixture()
    try {
      const now = new Date().toISOString()
      const record = (id: string, roomId: string, child = false) => WorkbenchLinkSchema.parse({ schemaVersion: 1,
        id, roomId, participantAgentId: f.agent.id, memberId: 'member', kind: child ? 'code_task' : 'schedule_series',
        surface: 'code', status: child ? 'completed' : 'active',
        origin: child ? { kind: 'series', seriesId: 'private_schedule', occurrence: 1 } : { kind: 'user', action: 'watch' },
        ...(child ? { seriesId: 'private_schedule', occurrence: 1, threadId: 'target_thread', turnId: 'target_turn' } : {}),
        request: { title: id, workspaceRoot: '/private/project', schedule: child ? undefined :
          { kind: 'recurring', every: 'day', time: '10:00', timeZone: 'Asia/Shanghai' } }, createdAt: now, updatedAt: now })
      for (const link of [record('private_schedule', f.personal.id), record('group_schedule', f.group.id), record('private_run', f.personal.id, true)])
        await f.store.commit({ requestId: 'seed-' + link.id, checks: [{ kind: 'workbench_link', id: link.id, expectedRevision: null }],
          puts: [{ kind: 'workbench_link', id: link.id, roomId: link.roomId, value: link }] })
      const personal = await f.invoke(authority('schedules.read'), 'schedule.list', {})
      expect(personal.source).toBe('runtime_workbench')
      expect(personal.schedules.map((s: any) => s.id)).toEqual(['private_schedule'])
      expect(JSON.stringify(personal)).not.toContain('/private/project')
      const all = await f.invoke(authority('schedules.read', 'groups.read'), 'schedule.list', {})
      expect(all.schedules.map((s: any) => s.id).sort()).toEqual(['group_schedule', 'private_schedule'])
      await expect(f.invoke(authority('schedules.read'), 'schedule.runs.list', { scheduleId: 'group_schedule' })).rejects.toThrow('NOT_FOUND')
      const runs = await f.invoke(authority('schedules.read'), 'schedule.runs.list', { scheduleId: 'private_schedule' })
      expect(runs.runs[0]).toMatchObject({ id: 'private_run', threadId: 'target_thread', turnId: 'target_turn' })
    } finally { await f.close() }
  })
  it('continues schedule scans beyond a full nonmatching ledger window', async () => {
    const f = await fixture()
    try {
      const now = new Date().toISOString(), base = { schemaVersion: 1, roomId: f.personal.id,
        participantAgentId: f.agent.id, memberId: 'member', surface: 'code', status: 'completed',
        origin: { kind: 'user', action: 'watch' }, createdAt: now, updatedAt: now }
      const scheduled = WorkbenchLinkSchema.parse({ ...base, id: 'older_schedule', kind: 'schedule_series', status: 'active',
        request: { title: 'Earlier scheduled series', schedule: { kind: 'recurring', every: 'day', time: '12:00', timeZone: 'UTC' } } })
      await f.store.commit({ requestId: 'older-schedule', checks: [{ kind: 'workbench_link', id: scheduled.id, expectedRevision: null }],
        puts: [{ kind: 'workbench_link', id: scheduled.id, roomId: f.personal.id, value: scheduled }] })
      for (let batch = 0; batch < 2; batch++) {
        const records = Array.from({ length: batch ? 1 : 1000 }, (_, index) => WorkbenchLinkSchema.parse({ ...base,
          id: 'ordinary_' + batch + '_' + index, kind: 'code_task', request: { title: 'Unscheduled task' } }))
        await f.store.commit({ requestId: 'ledger-batch-' + batch,
          checks: records.map((record) => ({ kind: 'workbench_link' as const, id: record.id, expectedRevision: null })),
          puts: records.map((record) => ({ kind: 'workbench_link' as const, id: record.id, roomId: record.roomId, value: record })) })
      }
      const first = await f.invoke(authority('schedules.read'), 'schedule.list', { limit: 1 })
      expect(first.schedules).toEqual([]); expect(first.hasMore).toBe(true); expect(first.complete).toBe(false)
      const second = await f.invoke(authority('schedules.read'), 'schedule.list', { limit: 1, cursor: first.nextCursor })
      expect(second.schedules[0].id).toBe('older_schedule')
    } finally { await f.close() }
  })
  it('projects installed plugin view metadata without activating a host or exposing local paths/session secrets', async () => {
    const f = await fixture()
    try {
      const paths = new ExtensionPaths({ packageRoot: join(f.root, 'plugins'), dataRoot: join(f.root, 'plugin-data') })
      const registry = new ExtensionRegistry(paths), packageManager = new ExtensionPackageManager(paths, registry, {
        compatibility: { kunVersion: '0.1.0', supportedManifestVersions: [1], supportedApiVersions: ['1.0.0'] } })
      const manifest = parseExtensionManifest({ publisher: 'acme', name: 'demo', version: '1.0.0', displayName: 'Demo',
        description: 'Installed plugin', manifestVersion: 1, stateSchemaVersion: 1, apiVersion: '1.0.0', engines: { kun: '*' },
        main: 'dist/main.mjs', activationEvents: ['onView:preview'], permissions: ['ui.views', 'webview'],
        contributes: { 'views.rightSidebar': [{ id: 'preview', title: 'Preview', entry: 'dist/private.html' }] } })
      await mkdir(paths.packageVersion('acme.demo', '1.0.0'), { recursive: true })
      await registry.registerVersion('acme.demo', { version: '1.0.0', packagePath: paths.packageVersion('acme.demo', '1.0.0'),
        archiveSha256: 'a'.repeat(64), integrity: { algorithm: 'sha256', files: {} }, source: { type: 'local', locator: '/private/archive.kunx' },
        signatureStatus: 'unsigned', requestedPermissions: ['ui.views', 'webview'], grantedPermissions: ['ui.views', 'webview'],
        installedAt: new Date().toISOString(), manifest, mutable: false })
      const activate = vi.fn()
      f.runtime.extensionPlatform = { registry, paths, packageManager, manager: { activate } } as unknown as ExtensionPlatformRuntime
      const scope = authority('extensions.read')
      const catalog = await f.invoke(scope, 'plugin.catalog', {})
      expect(catalog.plugins[0]).toMatchObject({ id: 'acme.demo', name: 'Demo', views: [{ id: 'preview', mode: 'desktop_only' }] })
      const view = await f.invoke(scope, 'plugin.view', { pluginId: 'acme.demo', contributionId: 'preview' })
      expect(view.actions).toEqual([]); expect(view.view.available).toBe(false)
      const encoded = JSON.stringify({ catalog, view })
      for (const privateField of ['private.html', 'archive.kunx', 'nonce', 'partition', 'grantedPermissions', 'packagePath'])
        expect(encoded).not.toContain(privateField)
      expect(activate).not.toHaveBeenCalled()
    } finally { await f.close() }
  })
})
