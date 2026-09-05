import type { ThreadLeaseAuthorityState } from '../../ports/thread-execution-lease.js'

/**
 * Narrow view of the thread execution lease used to gate side-effecting tool
 * dispatch while a renewal grace window is open. Provided by the runtime
 * composition root only when a Manager is wired; embedded runtimes omit it
 * and are treated as permanent holders.
 */
export type ToolDispatchLeaseAuthority = {
  authorityState(threadId: string): ThreadLeaseAuthorityState
  waitAuthorityResolution?(threadId: string): Promise<'holder' | 'lost'>
}

/**
 * While the local lease deadline has fired and the runtime is renewing inside
 * its unilateral grace window, Manager may already have re-issued the lease
 * (and its fencing token) to another runtime. File mutations through Manager
 * routes are fenced, but external side effects (third-party APIs, browser
 * actions, shell commands) are not. Pause those dispatches until renewal
 * resolves; read-only tools keep flowing so the turn can still observe state.
 */
export async function awaitLeaseAuthorityForSideEffectingTool(input: {
  authority: ToolDispatchLeaseAuthority
  threadId: string
  signal: AbortSignal
}): Promise<'holder' | 'lost'> {
  const { authority, threadId, signal } = input
  if (authority.authorityState(threadId) !== 'grace') return 'holder'
  if (!authority.waitAuthorityResolution) return 'holder'
  const resolution = authority.waitAuthorityResolution(threadId)
  // Never leak: once we settle, detach our listener.
  return await new Promise<'holder' | 'lost'>((resolve) => {
    let settled = false
    const settle = (state: 'holder' | 'lost') => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(state)
    }
    const onAbort = () => {
      // The turn is aborting anyway (lease-lost path or user abort). Do not
      // start the side effect; report `lost` so the caller throws the abort.
      settle('lost')
    }
    if (signal.aborted) {
      settle('lost')
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    resolution.then((state) => settle(state))
  })
}
