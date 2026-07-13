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

  it('identifies an external file path for per-operation approval', () => {
    expect(externalPathForApproval(
      { toolKind: 'file_change' },
      { arguments: { path: '../outside.txt' } },
      { workspace: '/repo/workspace', sandboxMode: 'workspace-write' }
    )).toBe('../outside.txt')
    expect(externalPathForApproval(
      { toolKind: 'file_change' },
      { arguments: { path: 'src/app.ts' } },
      { workspace: '/repo/workspace', sandboxMode: 'workspace-write' }
    )).toBeUndefined()
  })

  it('allows a path only when the current call carries an approved grant', () => {
    expect(canWritePath('/repo/other/app.ts', {
      workspace: '/repo/workspace',
      sandboxMode: 'workspace-write',
      allowExternalPaths: true
    })).toEqual({ ok: true })
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
