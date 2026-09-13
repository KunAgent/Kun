import { useEffect } from 'react'
import { useCodexReferenceState } from './codex-reference-state'
import { ensureCodexReferenceWatcher } from './codex-reference-watcher'
export { codexReferenceEnabled } from './codex-reference-watcher'

export function useCodexReferenceEnabled(provider?: 'codex' | 'claude-code'): boolean {
  const enabled = useCodexReferenceState((state) => provider === 'codex' ? state.enabled === true : provider === 'claude-code' ? state.claudeEnabled : state.enabled === true || state.claudeEnabled)
  useEffect(() => { ensureCodexReferenceWatcher() }, [])
  return enabled
}
