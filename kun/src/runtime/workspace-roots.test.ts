import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertAdditionalRootsSupported,
  assertIsolatedWorkspaceRoots,
  harnessWorkspaceSupport,
  resolveWorkspaceRoots,
  transportSupportsAdditionalRoots,
  WorkspaceRootSetError
} from './workspace-roots.js'

let base = ''

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'kun-roots-')))
  for (const name of ['repo', 'lib', 'web', join('repo', 'sub')]) {
    await mkdir(join(base, name), { recursive: true })
  }
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('resolveWorkspaceRoots', () => {
  it('canonicalizes the set, drops nested or duplicate roots and ignores order', async () => {
    const forward = await resolveWorkspaceRoots({
      workspace: join(base, 'repo'),
      additionalWorkspaces: [
        join(base, 'web'),
        join(base, 'lib'),
        join(base, 'lib'),
        join(base, 'repo', 'sub')
      ]
    })
    const reversed = await resolveWorkspaceRoots({
      workspace: join(base, 'repo'),
      additionalWorkspaces: [join(base, 'lib'), join(base, 'web')]
    })
    // `repo/sub` is already granted by `repo`; `lib` was declared twice.
    expect(forward.roots).toEqual([join(base, 'repo'), join(base, 'lib'), join(base, 'web')])
    expect(forward.extras).toEqual([join(base, 'lib'), join(base, 'web')])
    expect(forward.identity).toBe(reversed.identity)
  })

  it('resolves relative declarations against the base directory', async () => {
    const roots = await resolveWorkspaceRoots({
      workspace: 'repo',
      additionalWorkspaces: ['lib'],
      baseDir: base
    })
    expect(roots.roots).toEqual([join(base, 'repo'), join(base, 'lib')])
  })

  it('never promotes an extra root to primary when the primary is missing', async () => {
    await expect(resolveWorkspaceRoots({
      workspace: '   ',
      additionalWorkspaces: [join(base, 'lib')]
    })).rejects.toMatchObject({ code: 'workspace_root_invalid' })
  })

  it('fails closed when a declared root is missing instead of narrowing scope', async () => {
    await expect(resolveWorkspaceRoots({
      workspace: join(base, 'repo'),
      additionalWorkspaces: [join(base, 'gone')]
    })).rejects.toMatchObject({ code: 'workspace_root_missing' })
    await expect(resolveWorkspaceRoots({
      workspace: join(base, 'repo', 'sub', '..'),
      additionalWorkspaces: [join(base, 'lib', '..', 'lib')]
    })).resolves.toMatchObject({ extras: [join(base, 'lib')] })
  })

  it('changes identity when a symlinked root points somewhere else', async () => {
    const link = join(base, 'linked')
    await symlink(join(base, 'lib'), link)
    const first = await resolveWorkspaceRoots({
      workspace: join(base, 'repo'),
      additionalWorkspaces: [link]
    })
    expect(first.extras).toEqual([join(base, 'lib')])

    await rm(link)
    await symlink(join(base, 'web'), link)
    const second = await resolveWorkspaceRoots({
      workspace: join(base, 'repo'),
      additionalWorkspaces: [link]
    })
    expect(second.extras).toEqual([join(base, 'web')])
    expect(second.identity).not.toBe(first.identity)
  })
})

describe('workspace root failure boundaries', () => {
  it('rejects an unavailable primary in a multi-root workspace', async () => {
    await expect(resolveWorkspaceRoots({ workspace: join(base, 'missing'), additionalWorkspaces: [join(base, 'lib')] }))
      .rejects.toMatchObject({ code: 'workspace_root_missing' })
  })

  it('preserves the legacy missing-cwd behavior only for a single root', async () => {
    expect((await resolveWorkspaceRoots({ workspace: join(base, 'missing') })).primary).toBe(join(base, 'missing'))
  })

  it.each(['local', 'directory'] as const)('allows explicit nonisolated %s task workspaces', (isolation) => {
    expect(() => assertIsolatedWorkspaceRoots('tw_1', ['/repo/api'], { get: () => ({ isolation }) })).not.toThrow()
  })

  it('rejects worktree and unknown task-workspace bindings', () => {
    expect(() => assertIsolatedWorkspaceRoots('tw_1', ['/repo/api'], { get: () => ({ isolation: 'worktree' }) })).toThrow(/isolated task/)
    expect(() => assertIsolatedWorkspaceRoots('tw_1', ['/repo/api'], { get: () => undefined })).toThrow(/could not be verified/)
  })
})

describe('transport workspace support', () => {
  it('declares extra roots only for transports that can enforce them natively', () => {
    expect(transportSupportsAdditionalRoots('native-loop')).toBe(true)
    expect(transportSupportsAdditionalRoots('agent-sdk')).toBe(true)
    expect(transportSupportsAdditionalRoots('codex-app-server')).toBe(true)
    for (const transport of ['acp', 'cursor-sdk', 'pi-rpc', 'antigravity-cli', undefined]) {
      expect(transportSupportsAdditionalRoots(transport)).toBe(false)
      expect(harnessWorkspaceSupport(transport)).toEqual({ additionalRoots: false })
    }
    expect(harnessWorkspaceSupport('codex-app-server')).toEqual({ additionalRoots: true })
  })

  it('rejects extra roots for a host-managed isolated task workspace', () => {
    expect(() => assertIsolatedWorkspaceRoots(undefined, ['/repo/api'])).not.toThrow()
    expect(() => assertIsolatedWorkspaceRoots('tw_1', [])).not.toThrow()
    expect(() => assertIsolatedWorkspaceRoots('tw_1', ['/repo/api'])).toThrow(WorkspaceRootSetError)
  })

  it('rejects multi-root turns on an unsupported transport at the host boundary', () => {
    expect(() => assertAdditionalRootsSupported('acp', [])).not.toThrow()
    expect(() => assertAdditionalRootsSupported('acp', ['/x'])).toThrow(WorkspaceRootSetError)
    try {
      assertAdditionalRootsSupported('cursor-sdk', ['/x'])
    } catch (error) {
      expect(error).toMatchObject({ code: 'additional_roots_unsupported' })
    }
    expect(() => assertAdditionalRootsSupported('codex-app-server', ['/x'])).not.toThrow()
  })
})
