import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLatexProject, configureLatexProject } from './project'
import { LatexBuildService } from './build'
import { syncLatexSource } from './synctex'

const mocks = vi.hoisted(() => ({ run: vi.fn(), detect: vi.fn() }))
vi.mock('./process', () => ({ runLatexProcess: mocks.run }))
vi.mock('./detect', () => ({ detectLatexTools: mocks.detect }))
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-synctex-'))
  mocks.run.mockReset()
  mocks.detect.mockResolvedValue({ synctex: '/tex/synctex' })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('SyncTeX source boundary', () => {
  it('maps inverse results relative to a nested main document and ignores outside files', async () => {
    const created = await createLatexProject({ workspaceRoot: root, name: 'paper', template: 'english', autoBuild: true })
    await mkdir(join(created.rootPath, 'src'))
    await writeFile(join(created.rootPath, 'src/main.tex'), '\\documentclass{article}\n\\begin{document}Text\\end{document}')
    const project = await configureLatexProject({ workspaceRoot: root, path: created.mainPath }, { ...created.config, mainFile: 'src/main.tex' })
    const service = new LatexBuildService(join(root, 'cache'))
    const snapshotPath = join(root, 'cache/source')
    vi.spyOn(service, 'artifact').mockResolvedValue({ buildId: 'built', sourceHash: 'hash', outputPath: join(root, 'cache/output'), snapshotPath, pdfPath: join(root, 'cache/output/main.pdf'), mtimeMs: 1 })
    mocks.run.mockResolvedValue({ code: 0, log: 'SyncTeX result begin\nInput:../sections/introduction.tex\nLine:27\nSyncTeX result end', cancelled: false })
    const target = { workspaceRoot: root, path: project.mainPath, buildId: 'built', direction: 'inverse' as const, page: 2, x: 100, y: 200 }
    expect(await syncLatexSource(service, project, target)).toEqual({ file: 'sections/introduction.tex', line: 27, page: 2, x: 0, y: 0 })
    mocks.run.mockResolvedValue({ code: 0, log: 'Input:../../outside.tex\nLine:1', cancelled: false })
    expect(await syncLatexSource(service, project, target)).toBeNull()
    expect(await syncLatexSource(service, project, { ...target, buildId: 'older' })).toBeNull()
  })
  it('uses the first forward match when one source line has several PDF positions', async () => {
    const project = await createLatexProject({ workspaceRoot: root, name: 'paper', template: 'blank', autoBuild: true })
    const service = new LatexBuildService(join(root, 'cache'))
    vi.spyOn(service, 'artifact').mockResolvedValue({ buildId: 'built', sourceHash: 'hash', outputPath: '/cache/output', snapshotPath: '/cache/source', pdfPath: '/cache/output/main.pdf', mtimeMs: 1 })
    mocks.run.mockResolvedValue({ code: 0, log: 'Page:2\nh:120.5\nv:340\nPage:3\nh:30\nv:80', cancelled: false })
    expect(await syncLatexSource(service, project, { workspaceRoot: root, path: project.mainPath, buildId: 'built', direction: 'forward', file: 'main.tex', line: 4 }))
      .toEqual({ file: 'main.tex', line: 4, page: 2, x: 120.5, y: 340 })
  })
})
