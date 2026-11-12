import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLatexProject } from './project'
import { LatexBuildService } from './build'
import { currentLatexPdf } from './import-export'

const mocks = vi.hoisted(() => ({ run: vi.fn(), detect: vi.fn() }))
vi.mock('./process', () => ({ runLatexProcess: mocks.run }))
vi.mock('./detect', () => ({ detectLatexTools: mocks.detect }))
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-latex-build-'))
  mocks.detect.mockResolvedValue({ latexmk: '/tex/latexmk', engine: '/tex/pdflatex', synctex: '/tex/synctex', searchedPaths: ['/tex'] })
  mocks.run.mockReset()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('LaTeX build boundary', () => {
  it('compiles a source snapshot with safe flags and retains its successful PDF after a failed build', async () => {
    const project = await createLatexProject({ workspaceRoot: root, name: 'paper', template: 'blank', autoBuild: true })
    const service = new LatexBuildService(join(root, 'cache'))
    mocks.run.mockImplementationOnce(async (_command, args: string[], options) => {
      expect(args).toContain('-norc')
      expect(args).toContain('-no-shell-escape')
      expect(options.env.openout_any).toBe('p')
      expect(await readFile(join(options.cwd, 'main.tex'), 'utf8')).toContain('\\documentclass')
      const output = args.find((arg) => arg.startsWith('-outdir='))!.slice(8)
      await writeFile(join(output, 'main.pdf'), '%PDF-1.4\nfixture')
      return { code: 0, log: 'Output written on main.pdf.', cancelled: false }
    })
    const first = await service.build({ workspaceRoot: root, path: project.mainPath, buildId: 'first', sourceRevision: 1 })
    expect(first.status).toBe('succeeded')
    expect(first.pdf?.sourceHash).toBe(first.sourceHash)
    expect(await currentLatexPdf(service, project, first.sourceHash)).toBeInstanceOf(Buffer)
    mocks.run.mockResolvedValueOnce({ code: 1, log: './main.tex:4: Undefined control sequence.', cancelled: false })
    const second = await service.build({ workspaceRoot: root, path: project.mainPath, buildId: 'second', sourceRevision: 2 })
    expect(second.status).toBe('failed')
    expect(second.pdf).toBeNull()
    expect((await service.readPdf(project))?.buildId).toBe('first')
    await writeFile(project.mainPath, '\\documentclass{article}\nChanged')
    await expect(currentLatexPdf(service, project, first.sourceHash)).rejects.toThrow('older')
  })
  it('rejects disk conflicts before writing any file in a multi-file save', async () => {
    const project = await createLatexProject({ workspaceRoot: root, name: 'paper', template: 'english', autoBuild: true })
    const service = new LatexBuildService(join(root, 'cache'))
    const main = await readFile(project.mainPath, 'utf8')
    await expect(service.save({ workspaceRoot: root, path: project.mainPath }, [
      { file: 'main.tex', before: main, after: 'new main' },
      { file: 'sections/introduction.tex', before: 'old version', after: 'new section' }
    ])).rejects.toThrow('changed on disk')
    expect(await readFile(project.mainPath, 'utf8')).toBe(main)
  })
  it('prevents overlapping builds and propagates cancellation to the process', async () => {
    const project = await createLatexProject({ workspaceRoot: root, name: 'paper', template: 'blank', autoBuild: true })
    const service = new LatexBuildService(join(root, 'cache'))
    let signal: AbortSignal | undefined
    mocks.run.mockImplementationOnce(async (_command, _args, options) => {
      signal = options.signal
      await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }))
      return { code: null, log: '', cancelled: true }
    })
    const first = service.build({ workspaceRoot: root, path: project.mainPath, buildId: 'first', sourceRevision: 1 })
    await vi.waitFor(() => expect(signal).toBeDefined())
    await expect(service.build({ workspaceRoot: root, path: project.mainPath, buildId: 'second', sourceRevision: 1 })).rejects.toThrow('already compiling')
    await service.abort({ workspaceRoot: root, path: project.mainPath, buildId: 'first' })
    expect((await first).status).toBe('cancelled')
    expect(signal?.aborted).toBe(true)
  })
  it('reports missing tools without starting a process or altering source', async () => {
    const project = await createLatexProject({ workspaceRoot: root, name: 'paper', template: 'blank', autoBuild: true })
    const service = new LatexBuildService(join(root, 'cache'))
    mocks.detect.mockResolvedValue({ latexmk: null, engine: null, synctex: null, searchedPaths: ['/tex'] })
    const result = await service.build({ workspaceRoot: root, path: project.mainPath, buildId: 'first', sourceRevision: 0 })
    expect(result.status).toBe('missing-tools')
    expect(mocks.run).not.toHaveBeenCalled()
    expect(await readFile(project.mainPath, 'utf8')).toContain('\\documentclass')
  })
})
