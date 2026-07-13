export type RendererRecoveryReason = 'render-process-gone' | 'unresponsive'

export type RendererRecoveryPolicy = {
  maxAttempts: number
  windowMs: number
  stableMs: number
  retryDelayMs: number
}

export const DEFAULT_RENDERER_RECOVERY_POLICY: RendererRecoveryPolicy = {
  maxAttempts: 3,
  windowMs: 5 * 60_000,
  stableMs: 2 * 60_000,
  retryDelayMs: 750
}

export type RendererRecoveryState = {
  attempts: number
  windowStartedAt: number | null
  lastFailureAt: number | null
  recovering: boolean
}

export type RendererRecoveryEvent =
  | { type: 'failure'; reason: RendererRecoveryReason; at: number; cleanExit?: boolean }
  | { type: 'responsive' }
  | { type: 'loaded'; at: number }

export type RendererRecoveryDecision = {
  state: RendererRecoveryState
  action: 'reload' | 'notify' | 'none'
}

export const INITIAL_RENDERER_RECOVERY_STATE: RendererRecoveryState = {
  attempts: 0,
  windowStartedAt: null,
  lastFailureAt: null,
  recovering: false
}

export function reduceRendererRecovery(
  state: RendererRecoveryState,
  event: RendererRecoveryEvent,
  policy: RendererRecoveryPolicy = DEFAULT_RENDERER_RECOVERY_POLICY
): RendererRecoveryDecision {
  if (event.type === 'responsive') {
    return { state: { ...state, recovering: false }, action: 'none' }
  }
  if (event.type === 'loaded') {
    const stable = state.lastFailureAt !== null && event.at - state.lastFailureAt >= policy.stableMs
    return {
      state: stable
        ? INITIAL_RENDERER_RECOVERY_STATE
        : { ...state, recovering: false },
      action: 'none'
    }
  }
  if (event.cleanExit) return { state, action: 'none' }
  if (state.recovering) return { state, action: 'none' }

  const withinWindow = state.windowStartedAt !== null &&
    event.at - state.windowStartedAt >= 0 &&
    event.at - state.windowStartedAt < policy.windowMs
  const attempts = withinWindow ? state.attempts : 0
  const windowStartedAt = withinWindow ? state.windowStartedAt : event.at
  if (attempts >= policy.maxAttempts) {
    return {
      state: { attempts, windowStartedAt, lastFailureAt: event.at, recovering: false },
      action: 'notify'
    }
  }
  return {
    state: {
      attempts: attempts + 1,
      windowStartedAt,
      lastFailureAt: event.at,
      recovering: true
    },
    action: 'reload'
  }
}

type RecoveryWindow = Pick<BrowserWindow, 'isDestroyed'> & {
  webContents: Pick<WebContents, 'on' | 'reload'>
}

export function attachRendererProcessRecovery(
  window: RecoveryWindow,
  options: {
    log: (message: string, details?: Record<string, unknown>) => void
    policy?: RendererRecoveryPolicy
    now?: () => number
    schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
    cancel?: (timer: ReturnType<typeof setTimeout>) => void
  }
): () => void {
  const policy = options.policy ?? DEFAULT_RENDERER_RECOVERY_POLICY
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer))
  let state = INITIAL_RENDERER_RECOVERY_STATE
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const dispatch = (event: RendererRecoveryEvent): void => {
    if (disposed || window.isDestroyed()) return
    if ((event.type === 'responsive' || event.type === 'loaded') && retryTimer) {
      cancel(retryTimer)
      retryTimer = null
    }
    const decision = reduceRendererRecovery(state, event, policy)
    state = decision.state
    if (decision.action === 'reload') {
      options.log('Renderer process recovery scheduled', { reason: event.type, attempt: state.attempts })
      if (retryTimer) cancel(retryTimer)
      retryTimer = schedule(() => {
        retryTimer = null
        if (!disposed && !window.isDestroyed()) window.webContents.reload()
      }, policy.retryDelayMs)
    } else if (decision.action === 'notify') {
      options.log('Renderer process recovery limit reached', {
        reason: event.type,
        attempts: state.attempts
      })
    }
  }

  window.webContents.on('render-process-gone', (_event, rawDetails) => {
    const details = rawDetails && typeof rawDetails === 'object'
      ? rawDetails as { reason?: string }
      : undefined
    dispatch({
      type: 'failure',
      reason: 'render-process-gone',
      at: now(),
      cleanExit: details?.reason === 'clean-exit'
    })
  })
  window.webContents.on('unresponsive', () => {
    dispatch({ type: 'failure', reason: 'unresponsive', at: now() })
  })
  window.webContents.on('responsive', () => dispatch({ type: 'responsive' }))
  window.webContents.on('did-finish-load', () => dispatch({ type: 'loaded', at: now() }))

  return () => {
    disposed = true
    if (retryTimer) cancel(retryTimer)
    retryTimer = null
  }
}
import type { BrowserWindow, WebContents } from 'electron'
