import type { AdeHarnessTestResult } from '@shared/ade-harnesses'

export class AgentEnablementError extends Error {
  constructor(key: string, readonly detail = '') { super(key) }
}

export function agentReadinessFailure(result: AdeHarnessTestResult): AgentEnablementError {
  const failed = result.readiness?.checks.find((check) => !check.ok)
  const detail = result.readiness?.detail || failed?.detail || result.handshake?.detail || result.detect.status.message || ''
  const pluginFailure = result.harnessId === 'opencode' && failed?.id === 'protocol' &&
    /fn\d* is not a function|(?:plugin.*(?:failed|error)|(?:failed|error).*plugin)/i.test(detail)
  return new AgentEnablementError(pluginFailure ? 'agentEnablement.opencodePluginFailed'
    : failed ? `agentEnablement.failures.${failed.id}` : 'agentEnablement.failed', detail)
}

/** Undefined values and record insertion order must not change configuration identity. */
export function agentConfigurationKey(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
  })
}

export function abortableAgentOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason ?? new Error('agentEnablement.cancelled'))
    if (signal.aborted) { void operation.catch(() => undefined); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function waitForAgentPoll(signal: AbortSignal, ms = 250): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const abort = (): void => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
