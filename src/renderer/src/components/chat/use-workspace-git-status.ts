import { useEffect, useMemo, useState } from 'react'
import type { GitFileStatusCode, GitFileStatusEntry } from '@shared/git-file-status'
import { chatFileTreePathKey } from './chat-file-tree-helpers'

export type WorkspaceGitStatus = {
  available: boolean
  branch: string | null
  /** Changed files, without ignored entries. */
  changed: GitFileStatusEntry[]
  statusFor: (path: string) => GitFileStatusCode | null
  hasChangesUnder: (directoryPath: string) => boolean
}

type Snapshot = { available: boolean; branch: string | null; entries: GitFileStatusEntry[] }

const EMPTY: Snapshot = { available: false, branch: null, entries: [] }

function parentKey(key: string): string | null {
  const index = key.lastIndexOf('/')
  return index > 0 ? key.slice(0, index) : null
}

export function createWorkspaceGitStatus(snapshot: Snapshot): WorkspaceGitStatus {
  const exact = new Map<string, GitFileStatusCode>()
  const folders = new Map<string, GitFileStatusCode>()
  const changedAncestors = new Set<string>()
  const changed: GitFileStatusEntry[] = []
  for (const entry of snapshot.entries) {
    const key = chatFileTreePathKey(entry.path)
    exact.set(key, entry.status)
    if (entry.directory) folders.set(key, entry.status)
    if (entry.status === 'ignored') continue
    changed.push(entry)
    for (let ancestor = parentKey(key); ancestor; ancestor = parentKey(ancestor)) {
      if (changedAncestors.has(ancestor)) break
      changedAncestors.add(ancestor)
    }
  }
  return {
    available: snapshot.available,
    branch: snapshot.branch,
    changed,
    statusFor: (path) => {
      const key = chatFileTreePathKey(path)
      const direct = exact.get(key)
      if (direct) return direct
      if (folders.size === 0) return null
      for (let ancestor = parentKey(key); ancestor; ancestor = parentKey(ancestor)) {
        const inherited = folders.get(ancestor)
        if (inherited) return inherited
      }
      return null
    },
    hasChangesUnder: (directoryPath) => changedAncestors.has(chatFileTreePathKey(directoryPath))
  }
}

/** Git status for the tree's roots; refreshed on demand and when the window regains focus. */
export function useWorkspaceGitStatus(roots: readonly string[], refreshNonce: number): WorkspaceGitStatus {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [focusNonce, setFocusNonce] = useState(0)
  const rootsKey = roots.join('\n')

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    const onFocus = (): void => setFocusNonce((value) => value + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    const read = typeof window !== 'undefined' ? window.kunGui?.getGitFileStatus?.bind(window.kunGui) : undefined
    const targets = rootsKey ? rootsKey.split('\n') : []
    if (!read || targets.length === 0) {
      setSnapshot(EMPTY)
      return
    }
    let cancelled = false
    void Promise.all(targets.map((root) => read(root).catch(() => null))).then((results) => {
      if (cancelled) return
      const entries: GitFileStatusEntry[] = []
      let branch: string | null = null
      let available = false
      results.forEach((result, index) => {
        if (!result?.ok) return
        available = true
        if (index === 0) branch = result.branch
        entries.push(...result.entries)
      })
      setSnapshot({ available, branch, entries })
    })
    return () => {
      cancelled = true
    }
  }, [focusNonce, refreshNonce, rootsKey])

  return useMemo(() => createWorkspaceGitStatus(snapshot), [snapshot])
}
