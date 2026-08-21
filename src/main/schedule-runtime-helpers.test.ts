import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { runPromptViaRuntime } from './schedule-runtime-helpers'

describe('runPromptViaRuntime workspace validation', () => {
  it('forwards graph orchestration to the turn request', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-schedule-workspace-'))
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      path: string,
      options?: { body?: string }
    ) => {
      if (path === '/v1/threads') return { ok: true, status: 200, body: JSON.stringify({ id: 'thread-1' }) }
      if (path === '/v1/threads/thread-1/turns') return { ok: true, status: 200, body: JSON.stringify({ turn: { id: 'turn-1' } }) }
      return { ok: true, status: 200, body: '{}' }
    })
    try {
      const result = await runPromptViaRuntime(
        { runtimeRequest },
        { agents: { kun: { model: 'test-model' } } } as AppSettingsV1,
        {
          prompt: 'graph build', title: 'test', workspaceRoot, model: 'test-model',
          reasoningEffort: 'high', mode: 'agent', orchestration: 'graph',
          waitForResult: false, responseTimeoutMs: 1_000
        }
      )
      expect(result.ok).toBe(true)
      const turnCall = runtimeRequest.mock.calls.find(([, path]) => path === '/v1/threads/thread-1/turns')
      expect(turnCall).toBeDefined()
      expect(JSON.parse(turnCall?.[2]?.body ?? '{}')).toMatchObject({ orchestration: 'graph' })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('reuses an existing thread without creating a scheduled-task thread', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-schedule-workspace-'))
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      path: string,
      options?: { body?: string }
    ) => {
      if (path === '/v1/threads/thread-existing/turns') {
        return { ok: true, status: 200, body: JSON.stringify({ turn: { id: 'turn-scheduled' } }) }
      }
      throw new Error(`unexpected path ${path}`)
    })
    try {
      const result = await runPromptViaRuntime(
        { runtimeRequest },
        { agents: { kun: { model: 'test-model' } } } as AppSettingsV1,
        {
          prompt: 'continue plan build',
          title: '[Scheduled task] Plan',
          workspaceRoot,
          threadId: 'thread-existing',
          model: 'test-model',
          providerId: 'provider-a',
          reasoningEffort: 'high',
          mode: 'agent',
          waitForResult: false,
          responseTimeoutMs: 1_000
        }
      )

      expect(result).toMatchObject({
        ok: true,
        threadId: 'thread-existing',
        turnId: 'turn-scheduled'
      })
      expect(runtimeRequest.mock.calls.some(([, path]) => path === '/v1/threads')).toBe(false)
      const turnBody = runtimeRequest.mock.calls[0]?.[2]?.body
      expect(JSON.parse(turnBody ?? '{}')).toMatchObject({
        model: 'test-model',
        providerId: 'provider-a',
        reasoningEffort: 'high',
        disableUserInput: true
      })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('rejects a missing custom workspace without creating it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'kun-schedule-workspace-'))
    const workspaceRoot = join(parent, 'missing-project')
    const runtimeRequest = vi.fn()
    try {
      const result = await runPromptViaRuntime(
        { runtimeRequest },
        { agents: { kun: { model: 'test-model' } } } as AppSettingsV1,
        {
          prompt: 'test',
          title: 'test',
          workspaceRoot,
          model: 'test-model',
          reasoningEffort: '',
          mode: 'agent',
          waitForResult: false,
          responseTimeoutMs: 1_000
        }
      )

      expect(result).toEqual({
        ok: false,
        message: `Workspace directory is unavailable: ${workspaceRoot}`
      })
      expect(runtimeRequest).not.toHaveBeenCalled()
      await expect(stat(workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
