import { useEffect, useMemo, useState } from 'react'
import { rankChatFileTreeSearch, type ChatFileTreeSearchHit } from './chat-file-tree-rows'

const LISTING_TTL_MS = 30_000

type Listing = { root: string; files: string[]; truncated: boolean; loadedAt: number }

const listingCache = new Map<string, Listing | Promise<Listing | null>>()

async function loadListing(root: string, force: boolean): Promise<Listing | null> {
  const cached = listingCache.get(root)
  if (!force && cached && !(cached instanceof Promise) && Date.now() - cached.loadedAt < LISTING_TTL_MS) return cached
  if (!force && cached instanceof Promise) return cached
  const list = typeof window !== 'undefined' ? window.kunGui?.listWorkspaceFiles?.bind(window.kunGui) : undefined
  if (!list) return null
  const task = list({ workspaceRoot: root })
    .then((result) => (result.ok ? { root, files: result.files, truncated: result.truncated, loadedAt: Date.now() } : null))
    .catch(() => null)
  listingCache.set(root, task)
  const listing = await task
  if (listing) listingCache.set(root, listing)
  else listingCache.delete(root)
  return listing
}

export function clearWorkspaceFileSearchCache(): void {
  listingCache.clear()
}

export type WorkspaceFileSearch = {
  loading: boolean
  hits: ChatFileTreeSearchHit[]
  truncated: boolean
}

/** Workspace-wide file search for the tree, listed once per root by the main process. */
export function useWorkspaceFileSearch(
  roots: readonly string[],
  query: string,
  refreshNonce: number
): WorkspaceFileSearch {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(false)
  const active = query.trim().length > 0
  const rootsKey = roots.join('\n')

  useEffect(() => {
    if (!active || !rootsKey) return
    let cancelled = false
    setLoading(true)
    void Promise.all(rootsKey.split('\n').map((root) => loadListing(root, false))).then((results) => {
      if (cancelled) return
      setListings(results.filter((item): item is Listing => Boolean(item)))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [active, rootsKey])

  useEffect(() => {
    if (refreshNonce > 0) listingCache.clear()
  }, [refreshNonce])

  const hits = useMemo(() => {
    if (!active) return []
    const files = listings.flatMap((listing) => listing.files.map((relativePath) => {
      const separator = listing.root.includes('\\') && !listing.root.includes('/') ? '\\' : '/'
      return {
        path: `${listing.root.replace(/[\\/]+$/, '')}${separator}${separator === '\\' ? relativePath.replaceAll('/', '\\') : relativePath}`,
        relativePath,
        name: relativePath.split('/').pop() ?? relativePath,
        workspaceRoot: listing.root
      }
    }))
    return rankChatFileTreeSearch(files, query)
  }, [active, listings, query])

  return { loading: active && loading, hits, truncated: listings.some((listing) => listing.truncated) }
}
