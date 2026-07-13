import { describe, expect, it, vi } from 'vitest'
import {
  attachRendererProcessRecovery,
  DEFAULT_RENDERER_RECOVERY_POLICY,
  INITIAL_RENDERER_RECOVERY_STATE,
  reduceRendererRecovery
} from './renderer-process-recovery'

describe('renderer process recovery', () => {
  it('reloads once for a failure and ignores duplicate events while recovering', () => {
    const first = reduceRendererRecovery(INITIAL_RENDERER_RECOVERY_STATE, {
      type: 'failure', reason: 'render-process-gone', at: 100
    })
    expect(first.action).toBe('reload')
    const duplicate = reduceRendererRecovery(first.state, {
      type: 'failure', reason: 'unresponsive', at: 101
    })
    expect(duplicate.action).toBe('none')
    expect(duplicate.state.attempts).toBe(1)
  })

  it('does not count clean exits and resets after a stable load', () => {
    const clean = reduceRendererRecovery(INITIAL_RENDERER_RECOVERY_STATE, {
      type: 'failure', reason: 'render-process-gone', at: 100, cleanExit: true
    })
    expect(clean).toEqual({ state: INITIAL_RENDERER_RECOVERY_STATE, action: 'none' })
    const failed = reduceRendererRecovery(INITIAL_RENDERER_RECOVERY_STATE, {
      type: 'failure', reason: 'render-process-gone', at: 100
    })
    const loaded = reduceRendererRecovery(failed.state, {
      type: 'loaded', at: 100 + DEFAULT_RENDERER_RECOVERY_POLICY.stableMs
    })
    expect(loaded).toEqual({ state: INITIAL_RENDERER_RECOVERY_STATE, action: 'none' })
  })

  it('stops reloading after the bounded crash window', () => {
    let state = INITIAL_RENDERER_RECOVERY_STATE
    for (let attempt = 0; attempt < DEFAULT_RENDERER_RECOVERY_POLICY.maxAttempts; attempt++) {
      const decision = reduceRendererRecovery(state, {
        type: 'failure', reason: 'render-process-gone', at: 100 + attempt
      })
      expect(decision.action).toBe('reload')
      state = { ...decision.state, recovering: false }
    }
    const blocked = reduceRendererRecovery(state, {
      type: 'failure', reason: 'render-process-gone', at: 200
    })
    expect(blocked.action).toBe('notify')
  })

  it('cancels a pending retry when disposed', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const reload = vi.fn()
    const cancel = vi.fn()
    const window = {
      isDestroyed: () => false,
      webContents: {
        on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener),
        reload
      }
    }
    const timer = {} as ReturnType<typeof setTimeout>
    const dispose = attachRendererProcessRecovery(
      window as unknown as Parameters<typeof attachRendererProcessRecovery>[0],
      {
      log: vi.fn(),
      schedule: vi.fn(() => timer),
      cancel
      }
    )
    listeners.get('render-process-gone')?.({}, { reason: 'crashed' })
    listeners.get('responsive')?.()
    dispose()
    expect(cancel).toHaveBeenCalledWith(timer)
    expect(reload).not.toHaveBeenCalled()
  })
})
