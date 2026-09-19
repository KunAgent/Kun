import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { assertHistoryReferenceWorkspace } from './history-reference-workspace.js'

it('permits native legacy workspaces but requires a real directory for source branches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-reference-workspace-'))
  try {
    await expect(assertHistoryReferenceWorkspace({ workspace: join(root, 'absent') })).resolves.toBeUndefined()
    await expect(assertHistoryReferenceWorkspace({ historyRefId: 'ref', workspace: root })).resolves.toBeUndefined()
    await expect(assertHistoryReferenceWorkspace({ historyRefId: 'ref', workspace: join(root, 'absent') })).rejects.toThrow('Select an existing workspace')
    const file = join(root, 'file')
    await writeFile(file, 'file')
    await expect(assertHistoryReferenceWorkspace({ historyRefId: 'ref', workspace: file })).rejects.toThrow('Select an existing workspace')
  } finally { await rm(root, { recursive: true, force: true }) }
})
