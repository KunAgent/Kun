import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitWorkingState, KunGuiGitCommitApi } from '@shared/git-commit'

const BACKGROUND_REFRESH_MS = 10_000

export function gitCommitApi(): KunGuiGitCommitApi | null {
  const api = typeof window !== 'undefined' ? window.kunGui : undefined
  return api && typeof api.getGitWorkingState === 'function' ? api : null
}

export type GitWorkingStateHandle = {
  state: GitWorkingState | null
  /** Bumps when the state changes or a reload is forced, so views holding diffs refetch. */
  revision: number
  /** Reload and refetch diffs even when the file list looks the same (after an operation, or on request). */
  refresh: () => void
}

/**
 * Working-tree state for the panel's workspace. Reloads when the panel becomes
 * active, when `stamp` changes (agent activity, new file changes), on demand,
 * and quietly while the panel is visible so edits made elsewhere (a terminal,
 * an editor) show up. A quiet reload that finds nothing new changes nothing.
 */
export function useGitWorkingState(workspaceRoot: string | null, active: boolean, stamp: string): GitWorkingStateHandle {
  const [state, setState] = useState<GitWorkingState | null>(null)
  const [revision, setRevision] = useState(0)
  const [nonce, setNonce] = useState(0)
  const request = useRef(0)
  const forced = useRef(true)
  const last = useRef('')
  const refresh = useCallback(() => {
    forced.current = true
    setNonce((value) => value + 1)
  }, [])
  const quietRefresh = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    setState(null)
    last.current = ''
    forced.current = true
  }, [workspaceRoot])

  // Agent activity can rewrite a file without changing the list; refetch its diff.
  useEffect(() => {
    forced.current = true
  }, [stamp])

  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    const target = window
    target.addEventListener('focus', quietRefresh)
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') quietRefresh()
    }, BACKGROUND_REFRESH_MS)
    return () => {
      target.removeEventListener('focus', quietRefresh)
      clearInterval(timer)
    }
  }, [active, quietRefresh])

  useEffect(() => {
    const api = gitCommitApi()
    if (!active || !workspaceRoot || !api) return
    const id = ++request.current
    const timer = setTimeout(() => {
      void api.getGitWorkingState(workspaceRoot).then((next) => {
        if (id !== request.current) return
        const serialized = JSON.stringify(next)
        if (serialized === last.current && !forced.current) return
        forced.current = false
        last.current = serialized
        setState(next)
        setRevision((value) => value + 1)
      }).catch((error: unknown) => {
        if (id !== request.current) return
        setState({ ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    }, 120)
    return () => clearTimeout(timer)
  }, [workspaceRoot, active, stamp, nonce])

  return { state, revision, refresh }
}
