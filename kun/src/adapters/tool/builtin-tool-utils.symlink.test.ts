import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { resolveWorkspacePath } from './builtin-tool-utils.js'

function context(workspace: string): ToolHostContext {
  return {
    threadId: 'thread_symlink',
    turnId: 'turn_symlink',
    workspace,
    approvalPolicy: 'always',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('resolveWorkspacePath symlink escape', () => {
  let base: string
  let workspace: string
  let outside: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'kun-symlink-'))
    workspace = join(base, 'ws')
    outside = join(base, 'outside')
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('rejects a DANGLING symlink whose target is outside the workspace (write/create case)', async () => {
    // `outside` deliberately does NOT exist — realpath() reports ENOENT for the
    // link exactly as for a missing file. This is the hole the fix closes.
    await symlink(outside, join(workspace, 'evil'))
    await expect(resolveWorkspacePath('evil', context(workspace))).rejects.toThrow(/escapes the workspace root/)
  })

  it('rejects a path that traverses through a dangling symlink to an outside dir', async () => {
    await symlink(outside, join(workspace, 'dlink'))
    await expect(resolveWorkspacePath('dlink/sub/new.txt', context(workspace))).rejects.toThrow(
      /escapes the workspace root/
    )
  })

  it('rejects an EXISTING symlink that points outside the workspace', async () => {
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(workspace, 'link'))
    await expect(resolveWorkspacePath('link/file.txt', context(workspace))).rejects.toThrow(
      /escapes the workspace root/
    )
  })

  it('allows a dangling symlink that stays inside the workspace', async () => {
    // Link target is absent but in-workspace — a legitimate write/create target.
    await symlink(join(workspace, 'data', 'note.txt'), join(workspace, 'good'))
    const resolved = await resolveWorkspacePath('good', context(workspace))
    expect(resolved.absolutePath).toBe(join(workspace, 'good'))
  })

  it('allows creating a new nested file with no symlinks involved', async () => {
    const resolved = await resolveWorkspacePath('sub/dir/new.txt', context(workspace))
    expect(resolved.absolutePath).toBe(join(workspace, 'sub', 'dir', 'new.txt'))
  })

  it('allows reading an existing in-workspace file', async () => {
    await writeFile(join(workspace, 'real.txt'), 'hi')
    const resolved = await resolveWorkspacePath('real.txt', context(workspace))
    expect(resolved.absolutePath).toBe(join(workspace, 'real.txt'))
    expect(resolved.relativePath).toBe('real.txt')
  })
})
