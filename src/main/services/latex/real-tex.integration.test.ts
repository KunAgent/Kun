import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { shutdownOwnedProcesses } from '../../../../kun/src/process/owned-process'
import { LatexBuildService } from './build'
import { createLatexProject, readLatexProject } from './project'
import { detectLatexTools } from './detect'
import { syncLatexSource } from './synctex'

const [pdfTools, xeTools] = await Promise.all([detectLatexTools('pdflatex'), detectLatexTools('xelatex')])
let root: string
let service: LatexBuildService
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'kun-real-tex-')))
  service = new LatexBuildService(join(root, 'cache'))
})
afterEach(async () => { service?.stop(); if (root) await rm(root, { recursive: true, force: true }) })
afterAll(async () => { await shutdownOwnedProcesses({ graceMs: 0, timeoutMs: 3000 }) })

describe('real local TeX toolchain', () => {
  it.skipIf(!pdfTools.latexmk || !pdfTools.engine)('compiles a supplied .bbl, maps SyncTeX and retains the PDF after a real error', async () => {
    const created = await createLatexProject({ workspaceRoot: root, name: 'paper', template: 'blank', autoBuild: false })
    await writeFile(created.mainPath, '\\documentclass{article}\n\\begin{document}\nA citation: \\cite{paper}.\n\\input{references.bbl}\n\\end{document}\n')
    await rm(join(created.rootPath, 'references.bib'))
    await writeFile(join(created.rootPath, 'references.bbl'), '\\begin{thebibliography}{1}\n\\bibitem{paper} A paper.\n\\end{thebibliography}\n')
    const project = await readLatexProject({ workspaceRoot: root, path: created.mainPath })
    const result = await service.build({ workspaceRoot: root, path: project.mainPath, buildId: 'success', sourceRevision: 1 })
    expect(result.status, result.log).toBe('succeeded')
    expect(Buffer.from(result.pdf!.dataBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
    const artifact = await service.artifact(project)
    expect(await readFile(join(artifact!.snapshotPath, 'references.bbl'), 'utf8')).toContain('thebibliography')
    if (pdfTools.synctex) {
      const forward = await syncLatexSource(service, project, { workspaceRoot: root, path: project.mainPath, buildId: 'success', direction: 'forward', file: 'main.tex', line: 3 })
      expect(forward?.page).toBe(1)
      const inverse = await syncLatexSource(service, project, { workspaceRoot: root, path: project.mainPath, buildId: 'success', direction: 'inverse', page: forward!.page, x: forward!.x, y: forward!.y })
      expect(inverse?.file).toBe('main.tex')
    }
    await writeFile(project.mainPath, '\\documentclass{article}\n\\begin{document}\n\\kunUndefinedCommand\n\\end{document}\n')
    const failed = await service.build({ workspaceRoot: root, path: project.mainPath, buildId: 'failure', sourceRevision: 2 })
    expect(failed.status).toBe('failed')
    expect(failed.diagnostics.some((diagnostic) => diagnostic.code === 'undefined-command')).toBe(true)
    expect((await service.readPdf(project))?.buildId).toBe('success')
  }, 60_000)

  it.skipIf(!xeTools.latexmk || !xeTools.engine)('compiles the Chinese template with a real XeLaTeX installation', async () => {
    const project = await createLatexProject({ workspaceRoot: root, name: 'chinese-paper', template: 'chinese', autoBuild: false })
    const result = await service.build({ workspaceRoot: root, path: project.mainPath, buildId: 'chinese', sourceRevision: 1 })
    expect(result.status, result.log).toBe('succeeded')
    expect(Buffer.from(result.pdf!.dataBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
  }, 60_000)
})
