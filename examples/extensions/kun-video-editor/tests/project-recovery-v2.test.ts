import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectService, type VideoProject } from '../src/engine/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('schema-v2 recovery and relink', () => {
  it('opens a corrupt project from its newest snapshot, blocks writes, and preserves evidence on confirm', async () => {
    const { root, service } = await setup()
    const created = await service.createProject({ id: 'recover-project', name: 'Recover me' })
    const projectPath = join(root, '.kun-video/projects/recover-project/project.json')
    const corrupt = '{"schemaVersion":2,"broken":'
    await writeFile(projectPath, corrupt)

    const recovered = await service.loadProject(created.id)

    expect(recovered).toMatchObject({
      currentRevision: 0,
      recovery: {
        mode: 'write-blocked',
        recoveredFromRevision: 0,
        unreadableManifestKinds: ['project']
      }
    })
    expect(await readFile(projectPath, 'utf8')).toBe(corrupt)
    await expect(service.saveProject({ ...recovered, name: 'Autosave must fail' }, 0, {
      author: 'manual',
      sourceOperation: 'ui.autosave',
      summary: 'Autosave'
    })).rejects.toMatchObject({ code: 'recovery_required' })
    expect(await readFile(projectPath, 'utf8')).toBe(corrupt)

    const confirmed = await service.confirmRecovery(created.id, 0)
    expect(confirmed.project.recovery.mode).toBe('healthy')
    expect(await readFile(
      join(root, '.kun-video/projects/recover-project/backups/unreadable-project-manifest.json'),
      'utf8'
    )).toBe(corrupt)
    expect((await service.loadProject(created.id)).recovery.mode).toBe('healthy')
  })

  it('keeps unreadable auxiliary manifests, marks media offline, and never replaces them during autosave', async () => {
    const { root, service } = await setup()
    const project = await withAsset(service, 'manifest-project')
    const mediaManifest = join(root, '.kun-video/projects/manifest-project/media-manifest.json')
    const corrupt = 'not-json: keep me'
    await writeFile(mediaManifest, corrupt)

    const recovered = await service.loadProject(project.id)

    expect(recovered.recovery).toMatchObject({
      mode: 'write-blocked',
      unreadableManifestKinds: ['media']
    })
    expect(recovered.assets[0]).toMatchObject({
      availability: 'offline',
      recovery: { reason: 'manifest-unreadable', previousMediaHandleId: 'media_old' }
    })
    await expect(service.saveProject(recovered, recovered.currentRevision, {
      author: 'manual', sourceOperation: 'ui.autosave', summary: 'Autosave'
    })).rejects.toMatchObject({ code: 'recovery_required' })
    expect(await readFile(mediaManifest, 'utf8')).toBe(corrupt)

    await service.confirmRecovery(project.id, project.currentRevision)
    expect(await readFile(
      join(root, '.kun-video/projects/manifest-project/backups/unreadable-media-manifest.json'),
      'utf8'
    )).toBe(corrupt)
    await expect(stat(mediaManifest)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reconciles changed sources and interrupted derived work without deleting source records', async () => {
    const { root, service } = await setup()
    let project = await withAsset(service, 'reconcile-project')
    const candidate = structuredClone(project)
    candidate.assets[0]!.sourceIdentity = fingerprint('a')
    candidate.derivedReferences.push({
      id: 'proxy-1',
      kind: 'proxy',
      sourceAssetId: 'asset-1',
      dependencyIds: [],
      producerVersion: 'ffmpeg-1',
      status: 'processing',
      bytes: 0,
      pinned: false,
      sourceFingerprint: fingerprint('a'),
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    project = await service.saveProject(candidate, project.currentRevision, {
      author: 'system', sourceOperation: 'derived.start', summary: 'Started proxy'
    })

    const restarted = new ProjectService(root, {
      now: () => new Date('2026-03-01T00:00:00.000Z'),
      sourceProbe: async () => ({ availability: 'online', sourceIdentity: fingerprint('b') })
    })
    const reconciled = await restarted.loadProject(project.id)

    expect(reconciled.assets).toHaveLength(1)
    expect(reconciled.assets[0]!.availability).toBe('changed')
    expect(reconciled.derivedReferences[0]).toMatchObject({
      id: 'proxy-1',
      status: 'invalid',
      errorCode: 'source_changed'
    })
    expect(reconciled.recovery.interruptedJobIds).toEqual(['proxy-1'])
    expect((await restarted.loadProject(project.id)).derivedReferences[0]!.status).toBe('invalid')
  })

  it('relinks opaque media, invalidates dependent cache, and cleans only disposable derived records', async () => {
    const { service } = await setup()
    let project = await withAsset(service, 'relink-project')
    const candidate = structuredClone(project)
    candidate.assets[0]!.availability = 'revoked'
    candidate.derivedReferences.push(
      {
        id: 'proxy-unpinned',
        kind: 'proxy',
        sourceAssetId: 'asset-1',
        dependencyIds: [],
        producerVersion: 'ffmpeg-1',
        status: 'ready',
        bytes: 100,
        pinned: false,
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'proof-pinned',
        kind: 'proof',
        sourceAssetId: 'asset-1',
        dependencyIds: ['proxy-unpinned'],
        producerVersion: 'ffmpeg-1',
        status: 'ready',
        bytes: 50,
        pinned: true,
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'waveform-unpinned',
        kind: 'waveform',
        sourceAssetId: 'asset-1',
        dependencyIds: [],
        producerVersion: 'ffmpeg-1',
        status: 'ready',
        bytes: 75,
        pinned: false,
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    )
    project = await service.saveProject(candidate, project.currentRevision, {
      author: 'system', sourceOperation: 'media.revoked', summary: 'Grant revoked'
    })

    const relinked = await service.relinkMedia(project.id, project.currentRevision, {
      assetId: 'asset-1',
      mediaHandleId: 'media_new',
      sourceIdentity: fingerprint('c')
    })

    expect(relinked.project.assets[0]).toMatchObject({
      id: 'asset-1',
      mediaHandleId: 'media_new',
      availability: 'online',
      recovery: { previousMediaHandleId: 'media_old' }
    })
    expect(relinked.project.derivedReferences.every(({ status }) => status === 'invalid')).toBe(true)
    expect(relinked.receipt).toMatchObject({
      changedIds: expect.arrayContaining([
        { kind: 'asset', id: 'asset-1' },
        { kind: 'derived', id: 'proxy-unpinned' }
      ]),
      proofInvalidated: true
    })

    const cleaned = await service.cleanupDerivedCache(
      project.id,
      relinked.project.currentRevision
    )
    expect(cleaned.project.assets.map(({ id }) => id)).toEqual(['asset-1'])
    expect(cleaned.project.derivedReferences.map(({ id }) => id)).toEqual([
      'proxy-unpinned',
      'proof-pinned'
    ])
    expect(cleaned.receipt.removedIds).toEqual([{ kind: 'derived', id: 'waveform-unpinned' }])
  })
})

async function setup(): Promise<{ root: string; service: ProjectService }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-video-recovery-v2-'))
  roots.push(root)
  return {
    root,
    service: new ProjectService(root, { now: () => new Date('2026-02-01T00:00:00.000Z') })
  }
}

async function withAsset(service: ProjectService, projectId: string): Promise<VideoProject> {
  const project = await service.createProject({ id: projectId, name: 'Recovery project' })
  const candidate = structuredClone(project)
  candidate.assets.push({
    id: 'asset-1',
    name: 'source.mp4',
    kind: 'video',
    mediaHandleId: 'media_old',
    durationUs: 2_000_000,
    container: 'mp4',
    video: { codec: 'h264', width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 } },
    transcriptIds: []
  })
  return await service.saveProject(candidate, 0, {
    author: 'manual', sourceOperation: 'fixture.asset', summary: 'Added source asset'
  })
}

function fingerprint(character: string): NonNullable<VideoProject['assets'][number]['sourceIdentity']> {
  return { algorithm: 'sha256', value: character.repeat(64), sizeBytes: 1_024 }
}
