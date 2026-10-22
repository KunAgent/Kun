import { describe, expect, it, vi } from 'vitest'
import type { AgentRosterResolution } from '../delegation/agent-roster.js'
import { BUILTIN_HARNESSES } from '../harness/builtin-harnesses.js'
import type { ManagerToolContext } from './manager-runtime-deps.js'
import type { WorkerCreateInput } from './manager-worker-inputs.js'
import { resolveManagerWorkerRoute } from './worker-route.js'

const ctx = { threadId: 'thr_mgr', turnId: 'turn_1', workspace: '/repo' } as unknown as ManagerToolContext

function deps(resolution: AgentRosterResolution | undefined) {
  const resolve = vi.fn(async () => resolution!)
  return {
    resolve,
    deps: {
      threads: { get: async () => ({ model: 'deepseek-chat', providerId: 'deepseek' }) },
      catalog: {
        get: (id: string) => BUILTIN_HARNESSES.find((def) => def.id === id),
        list: () => BUILTIN_HARNESSES,
        isDisabled: () => false,
        isProfileEnabled: () => true
      },
      probedModels: (definition: { id: string }) => definition.id === 'codex' ? ['gpt-5.5-codex'] : undefined,
      ...(resolution ? { roster: { resolve } } : {})
    } as unknown as Parameters<typeof resolveManagerWorkerRoute>[0]
  }
}

const input = (overrides: Partial<WorkerCreateInput> = {}): WorkerCreateInput => ({
  label: 'Review', task: 'Review the diff', profile: 'reviewer', ...overrides
})

const resolved = (route?: Extract<AgentRosterResolution, { ok: true }>['route']): AgentRosterResolution => ({
  ok: true,
  id: 'reviewer',
  source: 'workspace',
  profile: { name: 'Reviewer', mode: 'subagent', toolPolicy: 'readOnly' },
  engine: route
    ? { kind: 'bound', harnessId: route.harnessId, displayName: 'Codex', credentialMode: route.credentialMode }
    : { kind: 'lane-default' },
  ...(route ? { route } : {})
})

describe('resolveManagerWorkerRoute with a roster profile', () => {
  it('runs a bound role on its engine and records the role', async () => {
    const { deps: d, resolve } = deps(resolved({ harnessId: 'codex', model: 'gpt-5.5-codex', credentialMode: 'native-login' }))
    const result = await resolveManagerWorkerRoute(d, ctx, input(), true, async () => 0)
    expect(result).toEqual({
      route: { harnessId: 'codex', model: 'gpt-5.5-codex', credentialMode: 'native-login' },
      profileId: 'reviewer'
    })
    expect(resolve).toHaveBeenCalledWith('reviewer', expect.objectContaining({ lane: 'worker', engineOverridden: false }))
  })

  it('runs an unbound role on the native loop with the manager route', async () => {
    const { deps: d } = deps(resolved())
    expect(await resolveManagerWorkerRoute(d, ctx, input(), true, async () => 0)).toEqual({
      route: { harnessId: 'kun', model: 'deepseek-chat', providerId: 'deepseek', credentialMode: 'provider' },
      profileId: 'reviewer'
    })
  })

  it('lets an explicit agent pin choose the engine while keeping the role', async () => {
    const { deps: d, resolve } = deps(resolved())
    const result = await resolveManagerWorkerRoute(d, ctx, input({
      agent: { harnessId: 'codex', model: 'gpt-5.5-codex', credentialMode: 'native-login' }
    }), true, async () => 0)
    expect(result).toMatchObject({ route: { harnessId: 'codex', model: 'gpt-5.5-codex' }, profileId: 'reviewer' })
    expect(resolve).toHaveBeenCalledWith('reviewer', expect.objectContaining({ engineOverridden: true }))
  })

  it('refuses with the roster reason instead of re-homing the role', async () => {
    const { deps: d } = deps({ ok: false, code: 'engine_not_ready', message: 'harness codex is signed out' })
    expect(await resolveManagerWorkerRoute(d, ctx, input(), true, async () => 0))
      .toEqual({ error: 'reviewer cannot run as a worker (engine_not_ready): harness codex is signed out' })
  })

  it('needs a roster to resolve a profile', async () => {
    const { deps: d } = deps(undefined)
    expect(await resolveManagerWorkerRoute(d, ctx, input(), true, async () => 0))
      .toMatchObject({ error: expect.stringContaining('roster is unavailable') })
  })
})
