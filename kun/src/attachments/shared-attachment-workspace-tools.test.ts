import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../ports/tool-host.js'
import '../adapters/tool/local-tool-host.js'
import { createReadLocalTool } from '../adapters/tool/builtin-read-tool.js'
import { createEditLocalTool, createWriteLocalTool } from '../adapters/tool/builtin-file-tools.js'
import { createGlobLocalTool, createGrepLocalTool, createLsLocalTool } from '../adapters/tool/builtin-search-tools.js'
import { createRepoMapLocalTool } from '../adapters/tool/builtin-repo-map-tool.js'
import { isSharedAttachmentCachePath } from './shared-attachment-content.js'

// Native filesystem coverage: on Windows the workspace and private cache both
// live on the temporary directory's drive, reproducing the reported failure.
describe.each([
  { name: 'ordinary context', attachmentAliases: undefined },
  { name: 'shared context', attachmentAliases: [] }
])('ordinary file tools: $name', ({ attachmentAliases }) => {
  it('allows read, ls, grep, glob, repo_map, write and edit outside the attachment cache', async () => {
    const workspace = await realpath(await mkdtemp(join(tmpdir(), 'kun-attachment-workspace-')))
    const file = join(workspace, 'example.ts')
    const context: ToolHostContext = {
      workspace, threadId: 'workspace-tools', turnId: 'turn', attachmentAliases,
      sandboxMode: 'workspace-write', approvalPolicy: 'auto',
      abortSignal: new AbortController().signal, awaitApproval: async () => 'allow'
    }
    try {
      expect(isSharedAttachmentCachePath(file)).toBe(false)
      const written = await createWriteLocalTool().execute({ path: file, content: 'export const needle = 1\n' }, context)
      expect(written.isError, JSON.stringify(written.output)).not.toBe(true)
      const calls = [
        [createReadLocalTool(), { path: file }],
        [createLsLocalTool(), { path: workspace }],
        [createGrepLocalTool({ rgExecutableCandidates: [] }), { path: workspace, pattern: 'needle' }],
        [createGlobLocalTool({ fdExecutableCandidates: [], rgExecutableCandidates: [] }), { path: workspace, pattern: '*.ts' }],
        [createRepoMapLocalTool(), { path: workspace, query: 'needle' }],
        [createEditLocalTool(), { path: file, oldText: 'needle = 1', newText: 'needle = 2' }]
      ] as const
      for (const [tool, args] of calls) {
        const result = await tool.execute(args, context)
        expect(result.isError, `${tool.name}: ${JSON.stringify(result.output)}`).not.toBe(true)
      }
      expect(await readFile(file, 'utf8')).toBe('export const needle = 2\n')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
