import type { ChatBlock } from '../agent/types'
import {
  countDiffStats,
  extractDiffFilePath,
  extractUnifiedDiffText,
  formatFilePathForDisplay
} from './diff-stats'

export type ComposerChangedFile = {
  path: string
  added: number
  removed: number
}

export type ComposerChangeSummary = {
  files: ComposerChangedFile[]
  added: number
  removed: number
}

export function collectComposerChangeSummary(
  blocks: ChatBlock[],
  workspaceRoot: string
): ComposerChangeSummary | null {
  const byPath = new Map<string, ComposerChangedFile>()

  for (const block of blocks) {
    if (!(block.kind === 'tool' && block.toolKind === 'file_change' && block.status === 'success')) {
      continue
    }
    const patch = extractUnifiedDiffText(block.detail)
    if (!patch) continue

    const path = formatFilePathForDisplay(extractDiffFilePath(patch, block.filePath), workspaceRoot)
    if (!path) continue

    const stats = countDiffStats(patch) ?? { added: 0, removed: 0 }
    const existing = byPath.get(path)
    if (existing) {
      existing.added += stats.added
      existing.removed += stats.removed
    } else {
      byPath.set(path, { path, added: stats.added, removed: stats.removed })
    }
  }

  if (byPath.size === 0) return null

  const files = [...byPath.values()]
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0)
  }
}
