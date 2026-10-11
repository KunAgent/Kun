import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { createWriteLocalTool } from './builtin-file-tools.js'

it('reports real creations/changes and detects identical workspace writes including empty files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'write-evidence-'))
  const context = { threadId: 'thread', turnId: 'turn', workspace: root, sandboxMode: 'workspace-write',
    approvalPolicy: 'never', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' } as ToolHostContext
  try {
    const tool = createWriteLocalTool()
    for (const [content, changed] of [['hello', true], ['hello', false], ['world', true], ['', true], ['', false]] as const) {
      const result = await tool.execute({ path: 'file.txt', content }, context)
      expect(result.isError).not.toBe(true)
      expect(result.output).toMatchObject({ changed })
      expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe(content)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('does not broaden prior-content reads for a full-access write outside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'write-evidence-outside-'))
  try {
    const path = join(root, 'outside.txt')
    await writeFile(path, 'existing')
    const result = await createWriteLocalTool().execute({ path, content: 'existing' }, {
      threadId: 'thread', turnId: 'turn', workspace: join(root, 'workspace'), sandboxMode: 'danger-full-access',
      approvalPolicy: 'never', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow'
    })
    expect(result.isError).not.toBe(true)
    expect(result.output).not.toHaveProperty('changed')
  } finally { await rm(root, { recursive: true, force: true }) }
})
