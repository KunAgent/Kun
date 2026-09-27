import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canWritePath,
  externalWriteTargetsForApproval,
  sandboxBlockForTool
} from './sandbox-policy.js'
import { sameFilesystemPath } from './workspace-path.js'

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

  it('treats explicitly added workspace roots as workspace-write boundaries', () => {
    const context = {
      workspace: '/repo/workspace',
      additionalWorkspaces: ['/repo/shared'],
      sandboxMode: 'workspace-write' as const
    }

    expect(canWritePath('/repo/shared/src/app.ts', context)).toEqual({ ok: true })
    expect(canWritePath('/repo/other/app.ts', context)).toMatchObject({ ok: false })
  })

  it('resolves only explicitly declared external write targets for approval', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'kun-sandbox-policy-'))
    const workspace = join(parent, 'workspace')
    try {
      await mkdir(workspace)
      const tool = {
        toolKind: 'file_change' as const,
        externalWritePathArguments: ['path']
      }
      const physicalParent = await realpath(parent)
      await writeFile(join(parent, 'outside.txt'), 'existing')
      const targets = await externalWriteTargetsForApproval(
        tool,
        { arguments: { path: '../outside.txt' } },
        { workspace, sandboxMode: 'workspace-write' }
      )
      expect(targets).toHaveLength(1)
      expect(targets[0]).toMatchObject({
        path: resolve(physicalParent, 'outside.txt')
      })
      expect(typeof targets[0]?.device).toBe('bigint')
      expect(typeof targets[0]?.inode).toBe('bigint')
      expect(typeof targets[0]?.parentDevice).toBe('bigint')
      expect(typeof targets[0]?.parentInode).toBe('bigint')
      await expect(externalWriteTargetsForApproval(
        tool,
        { arguments: { path: 'src/app.ts' } },
        { workspace, sandboxMode: 'workspace-write' }
      )).resolves.toEqual([])
      await expect(externalWriteTargetsForApproval(
        { toolKind: 'file_change' },
        { arguments: { path: '../outside.txt' } },
        { workspace, sandboxMode: 'workspace-write' }
      )).resolves.toEqual([])
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('fails closed before approval when the workspace fixture does not exist', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'kun-sandbox-missing-workspace-'))
    try {
      await expect(externalWriteTargetsForApproval(
        {
          toolKind: 'file_change',
          externalWritePathArguments: ['path']
        },
        { arguments: { path: join(parent, 'outside.txt') } },
        { workspace: join(parent, 'missing-workspace'), sandboxMode: 'workspace-write' }
      )).rejects.toThrow(/workspace root does not exist/)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('fails closed for a nonexistent external write target', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'kun-sandbox-missing-target-'))
    const workspace = join(parent, 'workspace')
    try {
      await mkdir(workspace)
      await expect(externalWriteTargetsForApproval(
        {
          toolKind: 'file_change',
          externalWritePathArguments: ['path']
        },
        { arguments: { path: join(parent, 'new-external.txt') } },
        { workspace, sandboxMode: 'workspace-write' }
      )).rejects.toThrow(/requires an existing regular file/)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('allows only the exact target carried by the active grant', () => {
    expect(canWritePath('/repo/other/app.ts', {
      workspace: '/repo/workspace',
      sandboxMode: 'workspace-write',
      approvedExternalWriteTargets: [{
        path: '/repo/other/app.ts',
        device: 1n,
        inode: 2n,
        parentDevice: 1n,
        parentInode: 3n
      }]
    })).toEqual({ ok: true })
    expect(canWritePath('/repo/other/sibling.ts', {
      workspace: '/repo/workspace',
      sandboxMode: 'workspace-write',
      approvedExternalWriteTargets: [{
        path: '/repo/other/app.ts',
        device: 1n,
        inode: 2n,
        parentDevice: 1n,
        parentInode: 3n
      }]
    })).toMatchObject({ ok: false })
  })

  it('uses case-insensitive exact matching only for Windows paths', () => {
    expect(sameFilesystemPath(
      'C:\\Users\\Example\\Target.txt',
      'c:/users/example/TARGET.txt',
      'win32'
    )).toBe(true)
    expect(sameFilesystemPath(
      'C:\\Users\\Example\\Target.txt',
      'C:\\Users\\Example\\Sibling.txt',
      'win32'
    )).toBe(false)
    expect(sameFilesystemPath('/Users/Example/Target.txt', '/users/example/target.txt', 'linux')).toBe(false)
    expect(sameFilesystemPath(`/repo/target${'/'.repeat(100_000)}`, '/repo/target', 'linux')).toBe(true)
    expect(sameFilesystemPath('/repo/target\\', '/repo/target', 'linux')).toBe(false)
  })

  it('advertises command execution in workspace-write for the explicit approval layer', () => {
    expect(sandboxBlockForTool(
      { name: 'bash', toolKind: 'command_execution' },
      { sandboxMode: 'workspace-write' }
    )).toBeNull()
    expect(sandboxBlockForTool(
      { name: 'bash', toolKind: 'command_execution' },
      { sandboxMode: 'read-only' }
    )).toMatchObject({ code: 'sandbox_command_blocked' })
    expect(sandboxBlockForTool(
      { name: 'bash', toolKind: 'command_execution' },
      { sandboxMode: 'external-sandbox' }
    )).toMatchObject({ code: 'sandbox_command_blocked' })
    expect(sandboxBlockForTool(
      { name: 'lsp', toolKind: 'command_execution' },
      { sandboxMode: 'workspace-write' }
    )).toMatchObject({ code: 'sandbox_command_blocked' })
  })

  it('lets MCP-provided command tools reach the workspace-write approval layer', () => {
    const mcp = { kind: 'mcp' as const }
    expect(sandboxBlockForTool(
      { name: 'mcp_github_mutate', toolKind: 'command_execution' },
      { sandboxMode: 'workspace-write' },
      mcp
    )).toBeNull()
    expect(sandboxBlockForTool(
      { name: 'mcp_github_mutate', toolKind: 'command_execution' },
      { sandboxMode: 'read-only' },
      mcp
    )).toMatchObject({ code: 'sandbox_command_blocked' })
    expect(sandboxBlockForTool(
      { name: 'mcp_github_mutate', toolKind: 'command_execution' },
      { sandboxMode: 'external-sandbox' },
      mcp
    )).toMatchObject({ code: 'sandbox_command_blocked' })
    // Delegated narrow path boundaries still block unconditionally.
    const delegatedContext = {
      workspace: '/repo/workspace',
      sandboxMode: 'workspace-write' as const,
      allowedReadPaths: ['src'],
      allowedWritePaths: ['src']
    }
    expect(sandboxBlockForTool(
      { name: 'mcp_github_mutate', toolKind: 'command_execution' },
      delegatedContext,
      mcp
    )).toMatchObject({ code: 'sandbox_command_blocked' })
    // Non-MCP command tools keep the strict boundary.
    expect(sandboxBlockForTool(
      { name: 'lsp', toolKind: 'command_execution' },
      { sandboxMode: 'workspace-write' },
      { kind: 'built-in' }
    )).toMatchObject({ code: 'sandbox_command_blocked' })
  })

  it('enforces delegated write scopes and blocks shell escape for narrow scopes', () => {
    const context = {
      workspace: '/repo/workspace',
      sandboxMode: 'danger-full-access' as const,
      allowedReadPaths: ['src'],
      allowedWritePaths: ['src/generated']
    }
    expect(canWritePath('/repo/workspace/src/generated/app.ts', context)).toEqual({ ok: true })
    expect(canWritePath('/repo/workspace/src/other.ts', context)).toMatchObject({
      ok: false,
      block: { code: 'sandbox_write_blocked' }
    })
    expect(sandboxBlockForTool(
      { name: 'bash', toolKind: 'command_execution' },
      context
    )).toMatchObject({
      code: 'sandbox_command_blocked'
    })
  })
})
