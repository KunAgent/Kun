import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionArchiveInput, SessionArchiveResult } from '../../ports/session-store.js'

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporaryPath, content, 'utf8')
  await rename(temporaryPath, path)
}

export async function writeSessionArchive(
  threadDirectory: string,
  input: SessionArchiveInput
): Promise<SessionArchiveResult> {
  const cutoff = input.cutoffTurnId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  const stamp = input.createdAt.replace(/[^0-9]/g, '').slice(0, 17) || String(Date.now())
  const archiveRoot = join(threadDirectory, 'archives')
  const finalPath = join(archiveRoot, `${stamp}-${cutoff}`)
  const stagingPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`
  await mkdir(stagingPath, { recursive: true })
  try {
    const jsonl = `${input.items.map((item) => JSON.stringify(item)).join('\n')}\n`
    const markdown = [
      '# Conversation archive',
      '',
      `- Thread: ${input.threadId}`,
      `- Cutoff turn: ${input.cutoffTurnId}`,
      `- Created: ${input.createdAt}`,
      '',
      ...input.items.map((item) => [
        `## ${item.kind} · ${item.turnId}`,
        '',
        '```json',
        JSON.stringify(item, null, 2),
        '```',
        ''
      ].join('\n'))
    ].join('\n')
    await writeAtomic(join(stagingPath, 'messages.jsonl'), jsonl)
    await writeAtomic(join(stagingPath, 'conversation.md'), markdown)
    await writeAtomic(join(stagingPath, 'manifest.json'), `${JSON.stringify({
      version: 1,
      threadId: input.threadId,
      cutoffTurnId: input.cutoffTurnId,
      createdAt: input.createdAt,
      archivedItems: input.items.length,
      retainedItems: input.retainedItems,
      replacedTokens: input.replacedTokens
    }, null, 2)}\n`)
    await mkdir(archiveRoot, { recursive: true })
    await rename(stagingPath, finalPath)
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true })
    throw error
  }
  return {
    path: finalPath,
    cleanup: () => rm(finalPath, { recursive: true, force: true })
  }
}
