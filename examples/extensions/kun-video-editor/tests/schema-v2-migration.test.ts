import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROJECT_LIMITS,
  ProjectService,
  VideoEngineError,
  VideoProjectSchema,
  migrateProject,
  migrateProjectWithReport,
  validateProjectRoundTrip
} from '../src/engine/index.js'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('schema-v2 migration', () => {
  it('matches the deterministic golden fixture and remains round-trip stable', async () => {
    const v1 = JSON.parse(await readFile(join(import.meta.dirname, 'golden/project-v1.json'), 'utf8'))
    const expected = JSON.parse(await readFile(join(import.meta.dirname, 'golden/project-v2.json'), 'utf8'))

    const first = migrateProjectWithReport(v1)
    const second = migrateProject(structuredClone(v1))

    expect(first).toMatchObject({ sourceVersion: 1, migrated: true })
    expect(first.project).toEqual(expected)
    expect(second).toEqual(expected)
    expect(validateProjectRoundTrip(first.project)).toEqual(expected)
    expect(first.project.sequences[0]).toMatchObject({
      id: 'sequence-main',
      items: v1.items,
      captions: v1.captions,
      tracks: v1.tracks
    })
    expect(first.project.currentRevision).toBe(3)
  })

  it('persists an immutable v1 backup before promoting project.json to v2', async () => {
    const root = await workspace()
    const v1Text = await readFile(join(import.meta.dirname, 'golden/project-v1.json'), 'utf8')
    const projectDirectory = join(root, '.kun-video/projects/golden-project')
    await mkdir(join(projectDirectory, 'revisions'), { recursive: true })
    await writeFile(join(projectDirectory, 'project.json'), v1Text)

    const project = await new ProjectService(root).loadProject('golden-project')

    expect(project.schemaVersion).toBe(2)
    expect(await readFile(join(projectDirectory, 'backups/project.schema-v1.json'), 'utf8')).toBe(v1Text)
    expect(JSON.parse(await readFile(join(projectDirectory, 'project.json'), 'utf8'))).toEqual(project)
  })

  it('refuses and preserves unsupported future projects without creating a backup', async () => {
    const root = await workspace()
    const future = JSON.parse(await readFile(join(import.meta.dirname, 'golden/project-v2.json'), 'utf8'))
    future.schemaVersion = 99
    const raw = `${JSON.stringify(future, null, 2)}\n`
    const projectDirectory = join(root, '.kun-video/projects/golden-project')
    await mkdir(join(projectDirectory, 'revisions'), { recursive: true })
    await writeFile(join(projectDirectory, 'project.json'), raw)

    await expect(new ProjectService(root).loadProject('golden-project')).rejects.toMatchObject({
      code: 'unsupported_schema_version'
    })
    expect(await readFile(join(projectDirectory, 'project.json'), 'utf8')).toBe(raw)
    await expect(stat(join(projectDirectory, 'backups'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enforces bounded sequence, selection, keyframe, effect, and derived contracts', async () => {
    const project = migrateProject(
      JSON.parse(await readFile(join(import.meta.dirname, 'golden/project-v1.json'), 'utf8'))
    )
    project.items[0]!.effects = [{
      id: 'effect-1',
      type: 'color.basic',
      enabled: true,
      parameters: { exposure: 0.5, mode: 'linear', preserveSkin: true }
    }]
    project.items[0]!.keyframes = [{
      id: 'keyframes-opacity',
      property: 'opacity',
      interpolation: 'linear',
      points: [
        { id: 'keyframe-1', frame: 0, value: 0 },
        { id: 'keyframe-2', frame: 30, value: 1 }
      ]
    }]
    project.sequences[0]!.items = structuredClone(project.items)
    project.selection.selectedItemIds = ['item-1']
    project.derivedReferences.push({
      id: 'proof-1',
      kind: 'proof',
      sourceAssetId: 'asset-1',
      dependencyIds: [],
      producerVersion: '1.0.0',
      status: 'ready',
      bytes: 1_024,
      pinned: true,
      updatedAt: '2026-01-02T00:00:00.000Z'
    })
    expect(VideoProjectSchema.parse(project)).toEqual(project)

    project.selection.selectedItemIds = Array.from(
      { length: PROJECT_LIMITS.selectedIds + 1 },
      (_, index) => `item-${index}`
    )
    expect(() => VideoProjectSchema.parse(project)).toThrow(VideoEngineError)
  })
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-video-schema-v2-'))
  roots.push(root)
  return root
}
