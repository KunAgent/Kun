import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfiguredHooks } from './hook-config.js'
import { runPreToolUseHooks } from './hook-engine.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveConfiguredHooks', () => {
  it('resolves a workflow entry to an in-process run hook', () => {
    const hooks = resolveConfiguredHooks([
      {
        phase: 'PostToolUse',
        toolNames: ['write', 'edit'],
        workflow: 'wf-1',
        mode: 'rewrite',
        baseUrl: 'http://127.0.0.1:8765',
        timeoutMs: 15_000
      }
    ])
    expect(hooks).toHaveLength(1)
    const hook = hooks[0]
    expect(hook.phase).toBe('PostToolUse')
    expect(hook.toolNames).toEqual(['write', 'edit'])
    expect(hook.timeoutMs).toBe(15_000)
    expect('run' in hook && typeof hook.run === 'function').toBe(true)
    expect('command' in hook).toBe(false)
  })

  it('still resolves a command entry to a command hook', () => {
    const hooks = resolveConfiguredHooks([{ phase: 'PreToolUse', command: 'echo hi', cwd: '/tmp' }])
    expect(hooks).toHaveLength(1)
    const hook = hooks[0]
    expect('command' in hook && hook.command).toBe('echo hi')
    expect('run' in hook).toBe(false)
  })

  it('does not run GUI workflow hooks for TUI turns', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetch)
    const hooks = resolveConfiguredHooks([{
      phase: 'PreToolUse',
      workflow: 'wf-gui',
      baseUrl: 'http://127.0.0.1:8765',
      clientSurfaces: ['gui']
    }])
    const input = {
      call: { callId: 'call_1', toolName: 'read', arguments: {} },
      context: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/project',
        approvalPolicy: 'auto' as const,
        sandboxMode: 'workspace-write' as const,
        clientSurface: 'tui' as const
      }
    }

    await runPreToolUseHooks(hooks, input)
    expect(fetch).not.toHaveBeenCalled()
    await runPreToolUseHooks(hooks, {
      ...input,
      context: { ...input.context, clientSurface: 'gui' }
    })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('fails closed for a block workflow hook on a transport error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))
    const hooks = resolveConfiguredHooks([{
      phase: 'PreToolUse',
      workflow: 'wf-block',
      mode: 'block',
      baseUrl: 'http://127.0.0.1:1'
    }])
    const input = {
      call: { callId: 'call_1', toolName: 'bash', arguments: { command: 'rm -rf /tmp/x' } },
      context: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/project',
        approvalPolicy: 'auto' as const,
        sandboxMode: 'workspace-write' as const,
        clientSurface: 'tui' as const
      }
    }

    const outcome = await runPreToolUseHooks(hooks, input)

    expect(outcome.denied ?? '').toContain('workflow hook error')
  })

})
