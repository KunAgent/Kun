import { access, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionMediaHandleError,
  ExtensionMediaHandleService,
  fileIdentityFromStat,
  identifiesSameFile,
  matchesFileIdentity
} from './extension-media-handle-service.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-extension-media-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'clip.mp4'), Buffer.from('video-fixture'))
  const principal: ExtensionPrincipal = {
    extensionId: 'acme.video',
    extensionVersion: '1.0.0',
    permissions: ['media.read', 'media.process', 'media.export', 'workspace.read', 'workspace.write'],
    workspaceRoots: [workspace],
    workspaceTrusted: true
  }
  return { root, workspace, dataDir, principal }
}

describe('ExtensionMediaHandleService', () => {
  it('omits filesystem identifiers that cannot be safely persisted in JSON', () => {
    const identity = fileIdentityFromStat({
      size: 128,
      mtimeMs: 1_700_000_000_000,
      dev: Number.MAX_SAFE_INTEGER + 2,
      ino: Number.MAX_SAFE_INTEGER + 4
    })

    expect(identity).toEqual({ size: 128, mtimeMs: 1_700_000_000_000 })
    expect(matchesFileIdentity(identity, {
      size: 128,
      mtimeMs: 1_700_000_000_000,
      device: 42,
      inode: 99
    })).toBe(true)
    expect(identifiesSameFile(identity, identity)).toBe(false)
  })

  it('registers workspace media without projecting an absolute path', async () => {
    const { workspace, dataDir, principal } = await fixture()
    const service = new ExtensionMediaHandleService({ dataDir })
    const handle = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'clip.mp4',
      mode: 'read',
      source: 'workspace'
    })
    expect(handle).toMatchObject({
      displayName: 'clip.mp4',
      mode: 'read',
      mimeType: 'video/mp4',
      workspaceRelativePath: 'clip.mp4',
      available: true
    })
    expect(handle).not.toHaveProperty('absolutePath')
    const resolved = await service.resolve(principal, handle.id, 'read')
    expect(resolved.absolutePath).toBe(await realpath(join(workspace, 'clip.mp4')))
  })

  it('persists successful View access time across runtime restart without paths', async () => {
    const { workspace, dataDir, principal } = await fixture()
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    const service = new ExtensionMediaHandleService({ dataDir, now: () => new Date(now) })
    const handle = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'clip.mp4',
      mode: 'read',
      source: 'workspace'
    })
    expect(handle.lastAccessedAt).toBe('2026-01-01T00:00:00.000Z')

    now += 60_000
    const touched = await service.touch(principal, handle.id)
    expect(touched).toMatchObject({
      id: handle.id,
      lastAccessedAt: '2026-01-01T00:01:00.000Z'
    })
    expect(touched).not.toHaveProperty('absolutePath')

    const restarted = new ExtensionMediaHandleService({ dataDir, now: () => new Date(now) })
    await expect(restarted.stat(principal, handle.id)).resolves.toMatchObject({
      lastAccessedAt: '2026-01-01T00:01:00.000Z'
    })
  })

  it('revokes handles only for the owning extension workspace', async () => {
    const { root, workspace, dataDir, principal } = await fixture()
    const workspaceB = join(root, 'workspace-b')
    await mkdir(workspaceB)
    await writeFile(join(workspaceB, 'clip.mp4'), Buffer.from('video-fixture-b'))
    const principalB = { ...principal, workspaceRoots: [workspaceB] }
    const foreignPrincipal = { ...principal, extensionId: 'other.video' }
    const service = new ExtensionMediaHandleService({ dataDir })
    const handleA = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'clip.mp4',
      mode: 'read',
      source: 'workspace'
    })
    const handleB = await service.register(principalB, {
      workspaceRoot: workspaceB,
      path: 'clip.mp4',
      mode: 'read',
      source: 'workspace'
    })
    const foreignHandle = await service.register(foreignPrincipal, {
      workspaceRoot: workspace,
      path: 'clip.mp4',
      mode: 'read',
      source: 'workspace'
    })

    await expect(service.revokeExtensionWorkspace(
      principal.extensionId,
      extensionWorkspaceKey(workspace),
      workspace
    )).resolves.toBe(1)

    await expect(service.stat(principal, handleA.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(service.stat(principalB, handleB.id)).resolves.toMatchObject({ available: true })
    await expect(service.stat(foreignPrincipal, foreignHandle.id))
      .resolves.toMatchObject({ available: true })
  })

  it('accepts an external file only through a picker source and keeps its path opaque', async () => {
    const { root, workspace, dataDir, principal } = await fixture()
    const external = join(root, 'external.mov')
    await writeFile(external, Buffer.from('external'))
    const service = new ExtensionMediaHandleService({ dataDir })
    await expect(service.register(principal, {
      workspaceRoot: workspace,
      path: external,
      mode: 'read',
      source: 'workspace'
    })).rejects.toMatchObject({ code: 'path_escape' })
    const selected = await service.register(principal, {
      workspaceRoot: workspace,
      path: external,
      mode: 'read',
      source: 'picker'
    })
    expect(selected.workspaceRelativePath).toBeUndefined()
    expect(JSON.stringify(selected)).not.toContain(external)
  })

  it('rejects missing permissions, foreign versions, and wrong access modes', async () => {
    const { workspace, dataDir, principal } = await fixture()
    const service = new ExtensionMediaHandleService({ dataDir })
    const handle = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'clip.mp4',
      mode: 'read',
      source: 'workspace'
    })
    await expect(service.stat({ ...principal, permissions: [] }, handle.id))
      .rejects.toMatchObject({ code: 'permission_denied' })
    await expect(service.stat({ ...principal, extensionVersion: '2.0.0' }, handle.id))
      .rejects.toMatchObject({ code: 'not_found' })
    await expect(service.resolve(principal, handle.id, 'write'))
      .rejects.toMatchObject({ code: 'mode_denied' })
  })

  it('detects replacement and makes release idempotent', async () => {
    const { workspace, dataDir, principal } = await fixture()
    const service = new ExtensionMediaHandleService({ dataDir })
    const handle = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'clip.mp4',
      mode: 'read',
      source: 'workspace'
    })
    await writeFile(join(workspace, 'clip.mp4'), Buffer.from('changed-longer'))
    await expect(service.resolve(principal, handle.id, 'read'))
      .rejects.toMatchObject({ code: 'file_changed' })
    expect(await service.release(principal, handle.id)).toBe(true)
    expect(await service.release(principal, handle.id)).toBe(false)
    await expect(service.stat(principal, handle.id))
      .rejects.toBeInstanceOf(ExtensionMediaHandleError)
  })

  it('confines relative output targets to the workspace', async () => {
    const { workspace, dataDir, principal } = await fixture()
    await mkdir(join(workspace, 'exports'))
    const service = new ExtensionMediaHandleService({ dataDir })
    const target = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'exports/final.mp4',
      mode: 'write',
      source: 'workspace'
    })
    expect(target).toMatchObject({ mode: 'write', workspaceRelativePath: 'exports/final.mp4' })
    await expect(service.register(principal, {
      workspaceRoot: workspace,
      path: '../escape.mp4',
      mode: 'write',
      source: 'workspace'
    })).rejects.toMatchObject({ code: 'path_escape' })
  })

  it('allocates Host cache targets with processing authority without requiring export authority', async () => {
    const { workspace, dataDir, principal } = await fixture()
    const cacheDirectory = join(workspace, '.kun', 'extension-cache', principal.extensionId, 'waveform')
    const cachePrincipal = {
      ...principal,
      permissions: ['media.process', 'workspace.write']
    }
    const service = new ExtensionMediaHandleService({ dataDir })
    const target = await service.registerCacheTarget(cachePrincipal, {
      workspaceRoot: workspace,
      path: '.kun/extension-cache/acme.video/waveform/partial.png',
      displayName: 'partial.png',
      mimeType: 'image/png'
    })
    expect(target).toMatchObject({
      mode: 'write',
      source: 'workspace',
      lifecycle: 'cache',
      available: true
    })
    await expect(access(cacheDirectory)).resolves.toBeUndefined()
    await expect(service.stat(cachePrincipal, target.id)).resolves.toMatchObject({
      id: target.id,
      lifecycle: 'cache',
      mode: 'write'
    })
    await expect(service.reserveOutput(cachePrincipal, target.id, 'cache-job-1'))
      .resolves.toMatchObject({ id: target.id, lifecycle: 'cache', mode: 'write' })
    await writeFile(join(cacheDirectory, 'partial.png'), Buffer.from('cache-without-export'))
    await expect(service.completeOutput(cachePrincipal, target.id, 'cache-job-1'))
      .resolves.toMatchObject({ lifecycle: 'cache', mode: 'read', source: 'generated' })
    await expect(service.register(cachePrincipal, {
      workspaceRoot: workspace,
      path: 'ordinary-export.png',
      mode: 'write',
      source: 'workspace'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(service.registerCacheTarget(cachePrincipal, {
      workspaceRoot: workspace,
      path: '.kun/extension-cache/another.video/escape.png'
    })).rejects.toMatchObject({ code: 'path_escape' })
  })

  it('refuses symlinked Host cache directories without creating data outside the workspace', async () => {
    const { root, workspace, dataDir, principal } = await fixture()
    const external = join(root, 'external-cache')
    await mkdir(external)
    await symlink(external, join(workspace, '.kun'))
    const service = new ExtensionMediaHandleService({ dataDir })
    await expect(service.registerCacheTarget(principal, {
      workspaceRoot: workspace,
      path: '.kun/extension-cache/acme.video/waveform/partial.png',
      mimeType: 'image/png'
    })).rejects.toMatchObject({ code: 'path_escape' })
    await expect(access(join(external, 'extension-cache'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reserves each export target once and publishes a separate generated read handle', async () => {
    const { workspace, dataDir, principal } = await fixture()
    await mkdir(join(workspace, 'exports'))
    const service = new ExtensionMediaHandleService({ dataDir })
    const target = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'exports/final.mp4',
      mode: 'write',
      source: 'workspace'
    })
    await service.reserveOutput(principal, target.id, 'job-1')
    await expect(service.reserveOutput(principal, target.id, 'job-2'))
      .rejects.toMatchObject({ code: 'handle_reserved' })
    await writeFile(join(workspace, 'exports', 'final.mp4'), Buffer.from('completed-video'))
    const generated = await service.completeOutput(principal, target.id, 'job-1')
    expect(generated).toMatchObject({
      mode: 'read',
      source: 'generated',
      displayName: 'final.mp4',
      byteSize: 15,
      available: true
    })
    expect(generated.id).not.toBe(target.id)
    await expect(service.stat(principal, target.id)).rejects.toMatchObject({ code: 'not_found' })
    const resolved = await service.resolve(principal, generated.id, 'read')
    expect(resolved.absolutePath).toBe(await realpath(join(workspace, 'exports', 'final.mp4')))
  })

  it('deletes Host-owned cache output bytes when the readable handle is released', async () => {
    const { workspace, dataDir, principal } = await fixture()
    const directory = join(workspace, '.kun', 'extension-cache', 'acme.video', 'waveform')
    await mkdir(directory, { recursive: true })
    const output = join(directory, 'partial.png')
    const service = new ExtensionMediaHandleService({ dataDir })
    const target = await service.register(principal, {
      workspaceRoot: workspace,
      path: '.kun/extension-cache/acme.video/waveform/partial.png',
      mode: 'write',
      source: 'workspace',
      lifecycle: 'cache',
      mimeType: 'image/png'
    })
    await service.reserveOutput(principal, target.id, 'job-cache-1')
    await writeFile(output, Buffer.from('cache-image'))
    const generated = await service.completeOutput(principal, target.id, 'job-cache-1')
    const alias = await service.registerCacheTarget(principal, {
      workspaceRoot: workspace,
      path: '.kun/extension-cache/acme.video/waveform/partial.png',
      displayName: 'partial-alias.png',
      mimeType: 'image/png'
    })

    await expect(access(output)).resolves.toBeUndefined()
    expect((await service.list(principal)).find(({ id }) => id === generated.id))
      .toMatchObject({ lifecycle: 'cache', mode: 'read', source: 'generated', available: true })
    await expect(service.release(principal, generated.id)).resolves.toBe(true)
    await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(service.stat(principal, generated.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(service.stat(principal, alias.id)).rejects.toMatchObject({ code: 'not_found' })
    expect((await service.list(principal)).filter(({ id }) =>
      id === generated.id || id === alias.id).every(({ available }) => !available)).toBe(true)
  })

  it('deletes cache outputs during extension lifecycle revocation', async () => {
    const { workspace, dataDir, principal } = await fixture()
    const directory = join(workspace, '.kun', 'extension-cache', 'acme.video', 'filmstrip')
    await mkdir(directory, { recursive: true })
    const output = join(directory, 'partial.png')
    await writeFile(output, Buffer.from('cache-image'))
    const service = new ExtensionMediaHandleService({ dataDir })
    await service.register(principal, {
      workspaceRoot: workspace,
      path: '.kun/extension-cache/acme.video/filmstrip/partial.png',
      mode: 'read',
      source: 'workspace',
      lifecycle: 'cache',
      mimeType: 'image/png'
    })

    await expect(service.revokeExtension('acme.video')).resolves.toBe(1)
    await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('validates a completion batch atomically before consuming any export grant', async () => {
    const { workspace, dataDir, principal } = await fixture()
    await mkdir(join(workspace, 'exports'))
    const service = new ExtensionMediaHandleService({ dataDir })
    const first = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'exports/first.mp4',
      mode: 'write',
      source: 'workspace'
    })
    const second = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'exports/second.mp4',
      mode: 'write',
      source: 'workspace'
    })
    await service.reserveOutput(principal, first.id, 'job-1')
    await service.reserveOutput(principal, second.id, 'job-2')
    await writeFile(join(workspace, 'exports', 'first.mp4'), Buffer.from('first'))
    await writeFile(join(workspace, 'exports', 'second.mp4'), Buffer.from('second'))

    await expect(service.completeOutputs(principal, [
      { handleId: first.id, reservationId: 'job-1' },
      { handleId: second.id, reservationId: 'wrong-job' }
    ])).rejects.toMatchObject({ code: 'handle_reserved' })

    await expect(service.completeOutput(principal, first.id, 'job-1'))
      .resolves.toMatchObject({ mode: 'read', source: 'generated' })
    await expect(service.completeOutput(principal, second.id, 'job-2'))
      .resolves.toMatchObject({ mode: 'read', source: 'generated' })
  })

  it('detects a newly-created file at a previously empty export target', async () => {
    const { workspace, dataDir, principal } = await fixture()
    await mkdir(join(workspace, 'exports'))
    const service = new ExtensionMediaHandleService({ dataDir })
    const target = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'exports/final.mp4',
      mode: 'write',
      source: 'workspace'
    })
    await writeFile(join(workspace, 'exports', 'final.mp4'), Buffer.from('foreign-file'))
    await expect(service.reserveOutput(principal, target.id, 'job-1'))
      .rejects.toMatchObject({ code: 'file_changed' })
  })

  it('rejects workspace symlink escapes and foreign extension owners', async () => {
    const { root, workspace, dataDir, principal } = await fixture()
    const external = join(root, 'external.mp4')
    await writeFile(external, Buffer.from('external-video'))
    await symlink(external, join(workspace, 'linked.mp4'))
    const service = new ExtensionMediaHandleService({ dataDir })
    await expect(service.register(principal, {
      workspaceRoot: workspace,
      path: 'linked.mp4',
      mode: 'read',
      source: 'workspace'
    })).rejects.toMatchObject({ code: 'path_escape' })
    const handle = await service.register(principal, {
      workspaceRoot: workspace,
      path: 'clip.mp4',
      mode: 'read',
      source: 'workspace'
    })
    await expect(service.stat({ ...principal, extensionId: 'foreign.video' }, handle.id))
      .rejects.toMatchObject({ code: 'not_found' })
  })
})
