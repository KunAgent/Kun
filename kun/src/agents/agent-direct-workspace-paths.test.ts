import { posix, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoomRuntime } from '../rooms/room-runtime.js'

// Isolate the production workspace update without loading the agent runtime.
// None of these collaborators implements the containment check under test.
vi.mock('./agent-lifecycle-state.js', () => ({ contextGeneration: vi.fn() }))
vi.mock('./agent-direct-cancellation.js', () => ({ stopDirectRequest: vi.fn() }))
vi.mock('./agent-direct-execution.js', () => ({ privateExecutionBinding: vi.fn() }))
vi.mock('./agent-legacy-files.js', () => ({ legacyAgentFiles: vi.fn() }))
vi.mock('./agent-artifact-library.js', () => ({ artifactReference: vi.fn() }))
vi.mock('./agent-permission-snapshot.js', () => ({ freezeAgentPermissions: vi.fn() }))
vi.mock('../rooms/room-store.js', () => ({ RoomStoreConflictError: class extends Error {} }))
vi.mock('../rooms/room-service.js', () => ({ roomFingerprint: JSON.stringify }))
vi.mock('./agent-direct-runner.js', () => ({ agentWorkspace: vi.fn() }))
vi.mock('./agent-identity-service.js', () => ({ agentStableId: vi.fn() }))

describe.each([
  { name: 'POSIX', paths: posix, base: '/profiles' },
  { name: 'Windows drive', paths: win32, base: 'C:\\profiles' },
  { name: 'Windows UNC', paths: win32, base: '\\\\server\\share\\profiles' }
])('direct workspace containment: $name', ({ paths, base }) => {
  const dataDir = paths.join(base, 'kun')

  afterEach(() => {
    vi.doUnmock('node:path')
    vi.doUnmock('node:fs/promises')
    vi.resetModules()
  })

  async function load(aliases: Record<string, string> = {}) {
    vi.resetModules()
    vi.doMock('node:path', () => paths)
    const realpath = vi.fn(async (path: string) => aliases[path] ?? path)
    vi.doMock('node:fs/promises', () => ({
      realpath,
      stat: vi.fn(async () => ({ isDirectory: () => true }))
    }))
    const { updateDirectWorkspace } = await import('./agent-direct-service.js')
    const room = { id: 'room', conversationKind: 'user_agent', revision: 1,
      members: [{ participantAgentId: 'agent' }] }
    const commit = vi.fn(async () => undefined)
    const wake = vi.fn()
    const rooms = {
      deps: { dataDir, store: { getRequest: vi.fn(async () => null), commit } },
      service: { get: vi.fn(async () => room) },
      agents: { active: vi.fn(async () => ({})) },
      wake
    } as unknown as RoomRuntime
    const update = (path: string) => updateDirectWorkspace(rooms, room.id, {
      clientRequestId: 'workspace-update', expectedRevision: 1, action: 'workspace', path
    })
    return { update, commit, wake, realpath }
  }

  it('rejects the private root and descendants, including legitimate ..name segments', async () => {
    const { update, commit, wake } = await load()
    for (const path of [dataDir, paths.join(dataDir, 'agents', 'project'), paths.join(dataDir, '..name')]) {
      await expect(update(path), path).rejects.toThrow('Select a project outside Kun private data')
    }
    if (paths === win32) {
      await expect(update(dataDir.toUpperCase())).rejects.toThrow('Select a project outside Kun private data')
      await expect(update(paths.join(dataDir, 'project').replaceAll('\\', '/')))
        .rejects.toThrow('Select a project outside Kun private data')
    }
    expect(commit).not.toHaveBeenCalled()
    expect(wake).not.toHaveBeenCalled()
  })

  it('accepts same-volume outside directories, siblings, and other roots', async () => {
    const { update, commit, wake } = await load()
    const candidates = [
      base,
      paths.parse(dataDir).root,
      paths.join(base, 'project'),
      dataDir + '-sibling',
      paths.join(dataDir + '-sibling', 'project'),
      paths.join(base, '..name'),
      paths.join(dataDir, '..', 'project'),
      ...(paths === win32 ? ['D:\\project', '\\\\other\\share\\project', '\\\\server\\other-share\\project'] : [])
    ]
    for (const path of candidates) {
      await expect(update(path), path).resolves.toMatchObject({ id: 'room' })
      expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({
        puts: [expect.objectContaining({ value: expect.objectContaining({ privateWorkspace: path }) })]
      }))
    }
    expect(commit).toHaveBeenCalledTimes(candidates.length)
    expect(wake).toHaveBeenCalledTimes(candidates.length)
  })

  it('checks canonical workspace targets and persists an allowed canonical target', async () => {
    const outsideLink = paths.join(base, 'project-link')
    const protectedTarget = paths.join(dataDir, 'agents', 'project')
    const insideLink = paths.join(dataDir, 'external-link')
    const allowedTarget = paths.join(base, 'project')
    const { update, commit } = await load({ [outsideLink]: protectedTarget, [insideLink]: allowedTarget })
    await expect(update(outsideLink)).rejects.toThrow('Select a project outside Kun private data')
    expect(commit).not.toHaveBeenCalled()
    await expect(update(insideLink)).resolves.toMatchObject({ id: 'room' })
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      puts: [expect.objectContaining({ value: expect.objectContaining({ privateWorkspace: allowedTarget }) })]
    }))
  })

  it('protects the canonical data root when the configured data directory is a symlink', async () => {
    const canonicalDataDir = paths.join(base, 'storage', 'private')
    const { update, commit, realpath } = await load({ [dataDir]: canonicalDataDir })
    for (const path of [canonicalDataDir, paths.join(canonicalDataDir, 'agents'), paths.join(canonicalDataDir, '..name')]) {
      await expect(update(path), path).rejects.toThrow('Select a project outside Kun private data')
    }
    expect(realpath).toHaveBeenCalledWith(dataDir)
    expect(commit).not.toHaveBeenCalled()
    await expect(update(canonicalDataDir + '-sibling')).resolves.toMatchObject({ id: 'room' })
  })
})
