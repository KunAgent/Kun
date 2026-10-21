import { join } from 'node:path'
import {
  execGitBuffer,
  readCurrentFile,
  sha256Hex,
  splitNulBuffer,
  type CheckpointFileReader
} from './git-turn-undo-checkpoint-reader'

/**
 * Paths that changed between a checkpoint and the end of the attribution
 * window: the next turn's checkpoint when there is one, otherwise the current
 * working tree. Used only to *report* files Kun's file tools did not write
 * (shell commands, manual edits); undo never touches them.
 */
export async function listWindowChangedPaths(params: {
  start: CheckpointFileReader
  end: CheckpointFileReader | null
}): Promise<string[]> {
  const { start, end } = params
  const repositoryRoot = start.repositoryRoot
  const changed = new Set<string>()
  const startTree = await start.writeTree()

  if (end) {
    const endTree = await end.writeTree()
    const stdout = await execGitBuffer(repositoryRoot, ['diff-tree', '-r', '--name-only', '-z', startTree, endTree])
    for (const path of splitNulBuffer(stdout)) changed.add(path)
  } else {
    const stdout = await execGitBuffer(repositoryRoot, ['diff', '--no-ext-diff', '--name-only', '-z', startTree])
    for (const path of splitNulBuffer(stdout)) changed.add(path)
  }

  const endUntracked = end
    ? new Set(end.untrackedPaths)
    : new Set(splitNulBuffer(await execGitBuffer(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z'])))

  const sharedUntracked: string[] = []
  for (const path of endUntracked) {
    if (start.untrackedPaths.has(path)) sharedUntracked.push(path)
    else changed.add(path)
  }
  for (const path of start.untrackedPaths) {
    if (!endUntracked.has(path)) changed.add(path)
  }

  if (sharedUntracked.length > 0) {
    const before = await start.readMany(sharedUntracked)
    const after = end ? await end.readMany(sharedUntracked) : null
    for (const path of sharedUntracked) {
      const startContent = before.get(path)
      const startSha = startContent?.kind === 'content' ? sha256Hex(startContent.bytes) : null
      let endSha: string | null = null
      if (after) {
        const endContent = after.get(path)
        endSha = endContent?.kind === 'content' ? sha256Hex(endContent.bytes) : null
      } else {
        endSha = await readCurrentFile(join(repositoryRoot, path)).then((file) => file?.sha256 ?? null, () => null)
      }
      if (!startSha || startSha !== endSha) changed.add(path)
    }
  }
  return [...changed].sort()
}
