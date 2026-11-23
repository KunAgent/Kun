import type { SessionStore } from '../ports/session-store.js'
import type { ThreadService } from './thread-service.js'
import type { DelegatedSessionBindingStore } from '../runtime/delegated-session-binding.js'
import { ANTIGRAVITY_SESSION_ID, readAntigravityToolOutput } from '../runtime/antigravity/antigravity-tool-output.js'
import { readDevinToolOutput } from '../runtime/acp/devin-tool-output.js'
import type { AcpOutputProvider, AcpToolOutput } from '../contracts/acp-tool-output.js'
import { hasAcpResult } from '../contracts/acp-tool-display.js'
import type { ToolPresentation } from '../contracts/tool-presentation.js'

type Stores = Pick<SessionStore, 'loadItemPage' | 'loadEventPage' | 'highestSeq'>

/** Older turns did not stamp a locator on their results. A committed binding
 * or a same-turn session recreation event can still prove which store to read. */
async function legacySession(sessions: Stores, bindings: Pick<DelegatedSessionBindingStore, 'peek'>,
  threadId: string, turnId: string, startedAt: string, provider: AcpOutputProvider): Promise<string | undefined> {
  const binding = await bindings.peek?.(threadId)
  if (binding?.threadId === threadId) {
    const exact = [binding, ...(binding.parked ?? [])].find(entry => entry.providerId === provider &&
      entry.providerKind === 'acp' && entry.lastCommittedTurnId === turnId && entry.nativeSessionId)
    if (exact) return exact.nativeSessionId
  }
  // Seek the sparse event index near admission. Timestamps only narrow the
  // search: an exact, host-recorded turn/session association is still required.
  const start = Date.parse(startedAt)
  if (!sessions.loadEventPage || !Number.isFinite(start)) return
  let lo = 0, hi = await sessions.highestSeq(threadId)
  for (let probes = 0; lo < hi && probes < 24; probes++) {
    const mid = Math.floor((lo + hi) / 2)
    const first = (await sessions.loadEventPage(threadId, { sinceSeq: mid, maxEvents: 1, maxBytes: 64 * 1024 })).events[0]
    if (first && Date.parse(first.timestamp) < start) lo = mid + 1
    else hi = mid
  }
  const page = await sessions.loadEventPage(threadId, { sinceSeq: lo, maxEvents: 64, maxBytes: 512 * 1024 })
  for (const e of page.events) {
    if (e.threadId === threadId && e.turnId === turnId && e.kind === 'harness_session_recreated' &&
        e.harnessId === provider && e.providerKind === 'acp') return e.replacementSession?.nativeSessionId
  }
}

export function createAcpToolOutputReader(threads: Pick<ThreadService, 'getMetadata'>, sessions: Stores,
  bindings: Pick<DelegatedSessionBindingStore, 'peek'>,
  readers = { antigravity: readAntigravityToolOutput, devin: readDevinToolOutput }) {
  const legacyLocators = new Map<string, string>()
  return async (threadId: string, turnId: string, callId: string): Promise<AcpToolOutput | null> => {
    if (!sessions.loadItemPage || !callId || callId.length > 1024) return null
    const thread = await threads.getMetadata(threadId)
    const turn = thread?.turns.find(entry => entry.id === turnId)
    const provider = turn?.harnessId ?? thread?.harnessId
    if (!turn || thread?.id !== threadId || (provider !== 'antigravity' && provider !== 'devin')) return null
    const items = await sessions.loadItemPage(threadId, { turnId, callId, maxItems: 4, maxBytes: 512 * 1024 })
    const result = items.items.find(item => item.kind === 'tool_result' && item.threadId === threadId &&
      item.turnId === turnId && item.callId === callId && item.toolName?.startsWith('acp:'))
    if (result?.kind !== 'tool_result' || (result.status !== 'completed' && result.status !== 'failed')) return null
    const view = result.meta?.toolPresentation ?? result.meta?.delegatedTool
    if ((result.output != null && result.output !== '') || (view && typeof view === 'object' && hasAcpResult(view as ToolPresentation))) return null
    const name = view && typeof view === 'object' && 'name' in view && typeof view.name === 'string' ? view.name : undefined
    if (provider === 'antigravity' && !name) return null
    const key = JSON.stringify([provider, threadId, turnId, turn.startedAt ?? turn.createdAt])
    const locator = result.meta?.acpOutputLocator
    if (locator !== undefined && (!locator || typeof locator !== 'object' || !('harnessId' in locator) || locator.harnessId !== provider ||
      !('sessionId' in locator) || typeof locator.sessionId !== 'string' || !locator.sessionId)) return null
    const stamped = locator?.sessionId ?? (provider === 'antigravity' ? result.meta?.antigravityOutputSessionId : undefined)
    const sessionId = stamped ?? legacyLocators.get(key) ??
      await legacySession(sessions, bindings, threadId, turnId, turn.startedAt ?? turn.createdAt, provider).catch(() => undefined)
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 1_024) return null
    const output = provider === 'devin' ? readers.devin({ sessionId, callId, finishedAt: result.finishedAt ?? result.createdAt })
      : name && ANTIGRAVITY_SESSION_ID.test(sessionId) ? readers.antigravity({ sessionId, callId, name, failed: result.status === 'failed' }) : null
    if (output && !stamped && !legacyLocators.has(key)) {
      if (legacyLocators.size >= 32) legacyLocators.delete(legacyLocators.keys().next().value!)
      legacyLocators.set(key, sessionId)
    }
    return output ? { ...output, provider } : null
  }
}
