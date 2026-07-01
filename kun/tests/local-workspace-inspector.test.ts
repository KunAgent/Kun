import type { ExecFileOptions } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalWorkspaceInspector } from '../src/adapters/workspace/local-workspace-inspector.js'

describe('LocalWorkspaceInspector', () => {
  it('runs git commands in the selected workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-workspace-'))
    const workspace = join(root, 'packages', 'app')
    await mkdir(workspace, { recursive: true })

    const calls: Array<{ args: string[]; cwd?: string }> = []
    const inspector = new LocalWorkspaceInspector({
      exec: async (_file: string, args: string[], options?: ExecFileOptions) => {
        calls.push({ args, cwd: typeof options?.cwd === 'string' ? options.cwd : undefined })
        const command = args.join(' ')
        if (command === 'rev-parse --is-inside-work-tree') return { stdout: 'true\n', stderr: '' }
        if (command === 'rev-parse --abbrev-ref HEAD') return { stdout: 'develop\n', stderr: '' }
        if (command === 'rev-parse HEAD') return { stdout: 'abc123\n', stderr: '' }
        if (command === 'status --porcelain') return { stdout: ' M src/app.ts\n', stderr: '' }
        throw new Error(`unexpected git command: ${command}`)
      }
    })

    try {
      const status = await inspector.status(workspace)

      expect(status).toMatchObject({
        path: workspace,
        isGitRepository: true,
        branch: 'develop',
        headSha: 'abc123',
        isDirty: true,
        fileChangeCount: 1
      })
      expect(calls).toEqual([
        { args: ['rev-parse', '--is-inside-work-tree'], cwd: workspace },
        { args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: workspace },
        { args: ['rev-parse', 'HEAD'], cwd: workspace },
        { args: ['status', '--porcelain'], cwd: workspace }
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
