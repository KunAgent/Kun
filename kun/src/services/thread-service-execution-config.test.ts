import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createTurnRecord } from '../domain/turn.js'
import { adeProjectDefaultsRevision } from '../shared/project-identity.js'
import { canonicalProjectIdentity } from '../shared/project-identity.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'
import { promotePendingExecutionConfig } from './thread-service-execution-config.js'
import { getThreadExecutionConfig, patchThreadExecutionConfig } from '../server/routes/thread-execution-config.js'

const NOW = '2026-09-30T00:00:00.000Z'
const roots: string[] = []

function serviceWith(
  projectSettings?: ConstructorParameters<typeof ThreadService>[0]['projectSettings'],
  hasActiveTeam?: (id: string) => Promise<boolean>
) {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const service = new ThreadService({
    threadStore, sessionStore, ids: new SequentialIdGenerator(), nowIso: () => NOW,
    ...(projectSettings ? { projectSettings } : {}),
    ...(hasActiveTeam ? { hasActiveTeam } : {}),
    events: new RuntimeEventRecorder({
      eventBus, sessionStore, nowIso: () => NOW,
      allocateSeq: (id) => eventBus.allocateSeq(id)
    })
  })
  return { service, threadStore }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('thread execution configuration', () => {
  it('keeps a legacy request route and requires a matching project revision before inheriting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-task-defaults-'))
    roots.push(root)
    const project = {
      route: { harnessId: 'kun', model: 'project-model', providerId: 'provider', credentialMode: 'provider' as const },
      collaborationEnabled: true,
      limits: { softWorkers: 2, hardWorkers: 3 }
    }
    const projectKey = (await canonicalProjectIdentity(root)).key
    const defaults = { [projectKey]: project }
    const { service } = serviceWith(() => ({ projectDefaults: defaults, defaultRoute: { model: 'global-model' } }))
    const legacy = await service.create({ workspace: root, model: 'global-model', mode: 'agent' })
    expect(legacy.model).toBe('global-model')
    expect(legacy.collaboration).toBeUndefined()
    const revision = adeProjectDefaultsRevision(projectKey, project)
    const inherited = await service.create({
      workspace: root, model: 'global-model', mode: 'agent',
      routeIntent: 'inherit', projectDefaultsRevision: revision
    })
    expect(inherited).toMatchObject({
      model: 'project-model', providerId: 'provider', harnessId: 'kun',
      collaboration: { enabled: true },
      executionConfig: {
        origins: { route: 'project', collaborationEnabled: 'project', limits: 'project' },
        limits: { softWorkers: 2, hardWorkers: 3 }
      }
    })
    defaults[projectKey] = { ...project, route: { ...project.route, model: 'changed' } }
    await expect(service.create({
      workspace: root, model: 'global-model', mode: 'agent',
      routeIntent: 'inherit', projectDefaultsRevision: revision
    })).rejects.toThrow(/changed or have not applied/)
  })

  it('supports atomic external-to-Kun handoff with task policy and object CAS', async () => {
    const { service } = serviceWith()
    const thread = await service.create({
      workspace: '/repo', model: 'claude-model', harnessId: 'claude-code', mode: 'agent'
    })
    const first = await service.getExecutionConfig(thread.id)
    expect(first?.revision).toMatch(/^task-config-v1:/)
    const saved = await service.mutateExecutionConfig(thread.id, {
      expectedRevision: first!.revision,
      set: {
        route: { harnessId: 'kun', model: 'kun-model', providerId: 'provider', credentialMode: 'provider' },
        collaborationEnabled: true
      }
    })
    expect(saved).toMatchObject({
      current: {
        route: { harnessId: 'kun', model: 'kun-model' },
        collaborationEnabled: true,
        origins: { route: 'task', collaborationEnabled: 'task' }
      }
    })
    expect(await service.get(thread.id)).toMatchObject({
      model: 'kun-model', harnessId: 'kun', collaboration: { enabled: true }
    })
    await expect(service.mutateExecutionConfig(thread.id, {
      expectedRevision: first!.revision, set: { collaborationEnabled: false }
    })).rejects.toThrow(/task settings changed/)
  })

  it('stores running edits as pending and preserves the admitted policy until promotion', async () => {
    const { service, threadStore } = serviceWith()
    const thread = await service.create({
      workspace: '/repo', model: 'kun-model', harnessId: 'kun', mode: 'agent',
      collaboration: { enabled: false }
    })
    const running = createTurnRecord({
      id: 'turn_running', threadId: thread.id, prompt: 'work', status: 'running'
    })
    await threadStore.upsert({ ...thread, status: 'running', turns: [running] })
    const current = await service.getExecutionConfig(thread.id)
    const saved = await service.mutateExecutionConfig(thread.id, {
      expectedRevision: current!.revision, set: { collaborationEnabled: true }
    })
    expect(saved.current.collaborationEnabled).toBe(false)
    expect(saved.pending?.collaborationEnabled).toBe(true)
    expect((await service.get(thread.id))?.collaboration?.enabled).toBe(false)
    const promoted = promotePendingExecutionConfig((await service.get(thread.id))!)
    expect(promoted.collaboration?.enabled).toBe(true)
    expect(promoted.pendingExecutionConfig).toBeUndefined()
  })

  it('restores inherited fields and blocks managed workers from self-editing', async () => {
    const { service, threadStore } = serviceWith()
    const thread = await service.create({
      workspace: '/repo', model: 'kun-model', harnessId: 'kun', mode: 'agent',
      collaboration: { enabled: true }
    })
    const first = await service.getExecutionConfig(thread.id)
    const edited = await service.mutateExecutionConfig(thread.id, {
      expectedRevision: first!.revision, set: { limits: { softWorkers: 1, hardWorkers: 2 } }
    })
    expect(edited.current.origins.limits).toBe('task')
    const restored = await service.mutateExecutionConfig(thread.id, {
      expectedRevision: edited.revision, unset: ['limits']
    })
    expect(restored.current.origins.limits).toBe('global')
    await threadStore.upsert({
      ...(await service.get(thread.id))!,
      executionUnit: {
        kind: 'worker', teamId: 'team', managerThreadId: 'manager', label: 'worker',
        lifecycle: 'persistent', control: 'manager'
      }
    })
    expect((await service.getExecutionConfig(thread.id))?.editable.limits)
      .toMatchObject({ allowed: false, reason: 'managed_execution_unit' })
    await expect(service.mutateExecutionConfig(thread.id, {
      expectedRevision: restored.revision, set: { limits: { softWorkers: 2, hardWorkers: 3 } }
    })).rejects.toThrow(/host-managed/)
  })

  it('serves the task GET/PATCH contract and reports stale revisions as HTTP 409', async () => {
    const { service } = serviceWith()
    const thread = await service.create({
      workspace: '/repo', model: 'm', harnessId: 'kun', mode: 'agent'
    })
    const get = await getThreadExecutionConfig(service, thread.id)
    expect(get.status).toBe(200)
    const snapshot = JSON.parse(get.body) as { revision: string; current: { route: { model: string } } }
    expect(snapshot.current.route.model).toBe('m')
    const patch = await patchThreadExecutionConfig(service, thread.id, new Request('http://kun.local', {
      method: 'PATCH', body: JSON.stringify({
        expectedRevision: snapshot.revision,
        set: { collaborationEnabled: true }
      })
    }))
    expect(patch.status).toBe(200)
    const stale = await patchThreadExecutionConfig(service, thread.id, new Request('http://kun.local', {
      method: 'PATCH', body: JSON.stringify({
        expectedRevision: snapshot.revision,
        set: { collaborationEnabled: false }
      })
    }))
    expect(stale.status).toBe(409)
    expect(JSON.parse(stale.body)).toMatchObject({ code: 'revision_conflict' })
  })

  it('locks an active team route but allows an ended team to hand off', async () => {
    let active = true
    const { service } = serviceWith(undefined, async () => active)
    const thread = await service.create({
      workspace: '/repo', model: 'm', harnessId: 'kun', mode: 'agent',
      collaboration: { enabled: true }
    })
    const first = await service.getExecutionConfig(thread.id)
    expect(first?.editable.route).toMatchObject({ allowed: false, reason: 'active_team_route_locked' })
    await expect(service.mutateExecutionConfig(thread.id, {
      expectedRevision: first!.revision,
      set: { route: { model: 'external', harnessId: 'claude-code', credentialMode: 'native-login' },
        collaborationEnabled: false }
    })).rejects.toThrow(/active team/)
    active = false
    const saved = await service.mutateExecutionConfig(thread.id, {
      expectedRevision: first!.revision,
      set: { route: { model: 'external', harnessId: 'claude-code', credentialMode: 'native-login' },
        collaborationEnabled: false }
    })
    expect(saved.current.route.harnessId).toBe('claude-code')
  })
  it('rejects inconsistent worker and token limits without changing the current snapshot', async () => {
    const { service } = serviceWith()
    const thread = await service.create({ workspace: '/project', model: 'test', mode: 'agent' })
    const before = await service.getExecutionConfig(thread.id)
    for (const set of [
      { limits: { softWorkers: 5, hardWorkers: 2 } },
      { budget: { softTokens: 500, hardTokens: 200 } }
    ]) {
      await expect(service.mutateExecutionConfig(thread.id, {
        expectedRevision: before!.revision, set
      })).rejects.toMatchObject({ code: 'invalid_limits' })
    }
    expect(await service.getExecutionConfig(thread.id)).toEqual(before)
  })

})
