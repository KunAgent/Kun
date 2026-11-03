import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { runExternalPlanBuildViaRuntime } from './schedule-runtime-external-plan'

const settings = {} as AppSettingsV1

describe('scheduled external plan handoff', () => {
  it('creates the conversation, waits for the task worktree, binds it and starts a plan-build turn', async () => {
    const calls: Array<{ path: string; method?: string; body?: Record<string, unknown> }> = []
    let polls = 0
    const runtimeRequest = vi.fn(async (_settings: AppSettingsV1, path: string, init: { method?: string; body?: string }) => {
      calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
      if (path === '/v1/threads') return { ok: true, status: 200, body: JSON.stringify({ id: 'thread-1' }) }
      if (path === '/v1/task-workspaces') return { ok: true, status: 200, body: JSON.stringify({ record: { workspaceId: 'ws-1', state: 'creating' } }) }
      if (path.startsWith('/v1/task-workspaces/')) {
        polls += 1
        return { ok: true, status: 200, body: JSON.stringify({ record: { workspaceId: 'ws-1', state: 'ready', path: '/wt/ws-1' } }) }
      }
      if (path === '/v1/threads/thread-1') return { ok: true, status: 200, body: '{}' }
      return { ok: true, status: 200, body: JSON.stringify({ turn: { id: 'turn-1' } }) }
    })
    const result = await runExternalPlanBuildViaRuntime({ runtimeRequest }, settings, {
      harness: { id: 'codex', credentialMode: 'native-login', model: 'gpt-6', reasoningEffort: 'high', providerId: 'ignored' },
      prompt: 'Build it', title: 'Plan', displayText: 'Plan', workspaceRoot: tmpdir()
    })
    expect(result).toEqual({ ok: true, threadId: 'thread-1', turnId: 'turn-1', message: 'Started' })
    expect(polls).toBe(1)
    expect(calls[0].body).toMatchObject({ harnessId: 'codex', workspaceMode: 'ade', model: 'gpt-6' })
    expect(calls[0].body).not.toHaveProperty('providerId')
    expect(calls[1].body).toMatchObject({ ownerThreadId: 'thread-1', startFrom: { kind: 'current-head' } })
    expect(calls[3]).toMatchObject({ method: 'PATCH', body: { workspace: '/wt/ws-1', taskWorkspaceId: 'ws-1' } })
    expect(calls[4].body).toMatchObject({ planBuild: true, harnessId: 'codex', reasoningEffort: 'high', model: 'gpt-6' })
  })

  it('stops before any turn when the worktree fails', async () => {
    const runtimeRequest = vi.fn(async (_settings: AppSettingsV1, path: string) => {
      if (path === '/v1/threads') return { ok: true, status: 200, body: JSON.stringify({ id: 'thread-1' }) }
      return { ok: true, status: 200, body: JSON.stringify({ record: { workspaceId: 'ws-1', state: 'failed' } }) }
    })
    const result = await runExternalPlanBuildViaRuntime({ runtimeRequest }, settings, {
      harness: { id: 'codex' }, prompt: 'Build it', title: 'Plan', displayText: 'Plan', workspaceRoot: tmpdir()
    })
    expect(result.ok).toBe(false)
    expect(runtimeRequest.mock.calls.some(([, path]) => String(path).endsWith('/turns'))).toBe(false)
  })
})
