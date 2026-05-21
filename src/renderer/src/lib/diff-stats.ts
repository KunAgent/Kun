export type DiffStats = {
  added: number
  removed: number
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

export function looksLikeUnifiedDiff(text: string | undefined): boolean {
  if (!text) return false
  return text
    .split('\n')
    .some((line) => /^(@@|diff --git |--- |\+\+\+ |index )/.test(line))
}

export function extractDiffFilePath(
  patch: string | undefined,
  override?: string
): string | undefined {
  const preset = override?.trim()
  if (preset) return preset
  if (!patch) return undefined

  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const raw = line.slice(4).trim()
      const cleaned = raw.replace(/^[ab]\//, '')
      if (cleaned && cleaned !== '/dev/null') return cleaned
      continue
    }
    if (line.startsWith('diff --git ')) {
      const match = line.match(/ b\/(\S+)/)
      if (match?.[1]) return match[1]
    }
  }

  return undefined
}

export function formatFilePathForDisplay(
  filePath: string | undefined,
  workspaceRoot?: string
): string | undefined {
  const raw = filePath?.trim()
  if (!raw) return undefined

  const normalizedFilePath = normalizePath(raw)
  const normalizedWorkspaceRoot = trimTrailingSlash(normalizePath(workspaceRoot?.trim() ?? ''))
  if (!normalizedWorkspaceRoot) return normalizedFilePath

  const fileLower = normalizedFilePath.toLowerCase()
  const rootLower = normalizedWorkspaceRoot.toLowerCase()
  if (fileLower === rootLower) return normalizedFilePath
  if (!fileLower.startsWith(`${rootLower}/`)) return normalizedFilePath

  return normalizedFilePath.slice(normalizedWorkspaceRoot.length + 1)
}

export function countDiffStats(patch: string | undefined): DiffStats | null {
  if (!patch) return null

  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }

  if (added === 0 && removed === 0) return null
  return { added, removed }
}

export function sumDiffStats(patches: Array<string | undefined>): DiffStats | null {
  let added = 0
  let removed = 0
  let hasStats = false

  for (const patch of patches) {
    const stats = countDiffStats(patch)
    if (!stats) continue
    added += stats.added
    removed += stats.removed
    hasStats = true
  }

  return hasStats ? { added, removed } : null
}
