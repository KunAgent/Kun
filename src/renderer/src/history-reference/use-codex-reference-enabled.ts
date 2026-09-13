import { useEffect } from 'react'
import { useCodexReferenceState } from './codex-reference-state'
import { ensureCodexReferenceWatcher } from './codex-reference-watcher'
export { codexReferenceEnabled } from './codex-reference-watcher'

export function useCodexReferenceEnabled(): boolean {
  const enabled = useCodexReferenceState((state) => state.enabled === true)
  useEffect(() => { ensureCodexReferenceWatcher() }, [])
  return enabled
}
