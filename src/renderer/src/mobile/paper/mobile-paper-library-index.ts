import { useCallback, useEffect, useState } from 'react'
import type { PaperLibraryEntry, PaperLibraryEntriesResult } from '@shared/paper/paper-library-types'
import type { PaperLibraryApi } from '@shared/paper/kun-gui-api-paper'
import { paperResourceKey } from './paper-resource-key'
import type { MobilePaperRoute } from './mobile-paper-route'

type Listing = Extract<PaperLibraryEntriesResult, { ok: true }>
type ListPapers = PaperLibraryApi['paperLibraryList']

/** Keep mobile list ownership separate from desktop paper-mode's global store. */
export function useMobilePaperLibraryIndex(root: string, papersDir: string) {
  const [snapshot, setSnapshot] = useState<{ root: string; listing: Listing } | null>(null)
  const [request, setRequest] = useState<{ root: string; loading: boolean; error: string }>({
    root: '', loading: false, error: ''
  })
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    if (!root) return
    let live = true
    setRequest({ root, loading: true, error: '' })
    void window.kunGui.paperLibraryList({ workspaceRoot: root, papersDir }).then((result) => {
      if (!live) return
      if (result.ok) {
        setSnapshot({ root, listing: result })
        setRequest({ root, loading: false, error: '' })
      } else setRequest({ root, loading: false, error: result.message })
    }).catch((cause: unknown) => {
      if (live) setRequest({ root, loading: false, error: String(cause) })
    })
    return () => { live = false }
  }, [root, papersDir, revision])
  const current = request.root === root && !request.loading && !request.error && snapshot?.root === root
    ? snapshot.listing : null
  return {
    listing: current,
    loading: Boolean(root) && (request.root !== root || request.loading),
    error: request.root === root ? request.error : '',
    refresh
  }
}

/** Resolve an opaque URL key against configured libraries, not the last phone preference. */
export async function findMobilePaperResource(
  libraries: readonly string[], preferred: string, paperKey: string, papersDir: string,
  list: ListPapers, knownRoute?: MobilePaperRoute | null
): Promise<{ root: string; entry: PaperLibraryEntry } | null> {
  if (knownRoute && libraries.includes(knownRoute.root) &&
    paperResourceKey(knownRoute.root, knownRoute.unitDir) === paperKey) {
    const result = await list({ workspaceRoot: knownRoute.root, papersDir })
    if (!result.ok) throw new Error(result.message)
    const entry = result.entries.find((item) => item.unitDir === knownRoute.unitDir)
    return entry ? { root: knownRoute.root, entry } : null
  }
  const roots = [...new Set([preferred, ...libraries].filter((root) => Boolean(root) && libraries.includes(root)))]
  let firstError: string | null = null
  let found: { root: string; entry: PaperLibraryEntry } | null = null
  let ambiguous = false
  for (const root of roots) {
    try {
      const result = await list({ workspaceRoot: root, papersDir })
      if (!result.ok) { firstError ??= result.message; continue }
      const entry = result.entries.find((item) => paperResourceKey(root, item.unitDir) === paperKey)
      if (entry) {
        if (found) ambiguous = true
        else found = { root, entry }
      }
    } catch (cause) { firstError ??= String(cause) }
  }
  if (ambiguous) throw new Error('Paper link is ambiguous across libraries; open it from the library list.')
  if (firstError) throw new Error(firstError)
  return found
}
