import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AgentDispatchAction, AgentDispatchIntentView } from '@shared/agent-dispatch'
import { agentDispatchCache, agentDispatchClient, publishAgentDispatchIntent } from '../../agent/agent-dispatch-client'

export function useAgentDispatchIntent(intentId: string, initial?: AgentDispatchIntentView) {
  const intent = useSyncExternalStore(agentDispatchCache.subscribe,
    () => agentDispatchCache.get(intentId) ?? initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const refresh = useCallback(async () => {
    try { publishAgentDispatchIntent(await agentDispatchClient.get(intentId)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [intentId])
  useEffect(() => { void refresh() }, [refresh])
  const intentState = intent?.state
  useEffect(() => {
    // Events update immediately; a bounded poll repairs missed events after a
    // reconnect without depending on the originating turn still streaming.
    if (!intentState || ['completed', 'failed', 'cancelled'].includes(intentState)) return
    const timer = setInterval(() => { void refresh() }, 3000)
    return () => clearInterval(timer)
  }, [intentState, refresh])
  const act = useCallback(async (action: AgentDispatchAction,
    changes?: { recommendation?: Partial<AgentDispatchIntentView['recommendation']> }): Promise<AgentDispatchIntentView | undefined> => {
    if (!intent || busyRef.current) return undefined
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const next = await agentDispatchClient.act(intent, action, changes)
      publishAgentDispatchIntent(next)
      return next
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await refresh()
      return undefined
    } finally { busyRef.current = false; setBusy(false) }
  }, [intent, refresh])
  return { intent, error, busy, act, refresh }
}
