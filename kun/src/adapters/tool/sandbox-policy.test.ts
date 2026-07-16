import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canWritePath, externalPathForApproval, sandboxBlockForTool } from './sandbox-policy.js'

describe('sandbox policy', () => {
  it('limits workspace-write file mutations to the workspace', () => {
    const context = {
      workspace: '/repo/workspace',
      sandboxMode: 'workspace-write' as const
    }

    expect(canWritePath('/repo/workspace/src/app.ts', context)).toEqual({ ok: true })
    expect(canWritePath('/repo/other/app.ts', context)).toMatchObject({
      ok: false,
      block: {
        code: 'sandbox_write_blocked'
      }
    })
  })

  it('identifies an external file path for per-operation approval', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'kun-sandbox-policy-'))
    const workspace = join(parent, 'workspace')
    try {
      await mkdir(workspace)
      await expect(externalPathForApproval(
        { toolKind: 'file_change' },
        { arguments: { path: '../outside.txt' } },
        { workspace, sandboxMode: 'workspace-write' }
      )).resolves.toEqual([resolve(parent, 'outside.txt')])
      await expect(externalPathForApproval(
        { toolKind: 'file_change' },
        { arguments: { path: 'src/app.ts' } },
        { workspace, sandboxMode: 'workspace-write' }
      )).resolves.toEqual([])
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('allows a path only when the current call carries an approved grant', () => {
    expect(canWritePath('/repo/other/app.ts', {
      workspace: '/repo/workspace',
      sandboxMode: 'workspace-write',
      approvedExternalPaths: ['/repo/other/app.ts']
    })).toEqual({ ok: true })
    expect(canWritePath('/repo/other/second.ts', {
      workspace: '/repo/workspace',
      sandboxMode: 'workspace-write',
      approvedExternalPaths: ['/repo/other/app.ts']
    })).toMatchObject({ ok: false })
  })

  it('keeps command execution blocked in workspace-write mode', () => {
    expect(sandboxBlockForTool(
      { name: 'bash', toolKind: 'command_execution' },
      { sandboxMode: 'workspace-write' }
    )).toMatchObject({
      code: 'sandbox_command_blocked'
    })
  })
})
