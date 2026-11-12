import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { configureLatexProject, createLatexProject, listProjectFiles, MAX_SOURCE_BYTES, readLatexProject, readLatexSource } from './project'
import { importLatexProject, latexSourceZip } from './import-export'

let root: string
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'kun-latex-project-'))) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('LaTeX project discovery and files', () => {
  it('discovers a large main document but only provides a bounded preview for editing', async () => {
    await writeFile(join(root, 'main.tex'), '\\documentclass{article}\n' + 'x'.repeat(MAX_SOURCE_BYTES + 10))
    const project = await readLatexProject({ workspaceRoot: root, path: join(root, 'main.tex') })
    expect(project.config.mainFile).toBe('main.tex')
    expect((await readLatexSource(root, 'main.tex', true)).length).toBe(MAX_SOURCE_BYTES)
    await expect(readLatexSource(root, 'main.tex')).rejects.toThrow('1.5 MB')
  })
  it('creates a Chinese template, identifies it from a subfile, and persists engine options', async () => {
    const project = await createLatexProject({ workspaceRoot: root, name: 'Research paper', template: 'chinese', autoBuild: false })
    expect(project.config.engine).toBe('xelatex')
    const fromChild = await readLatexProject({ workspaceRoot: root, path: join(project.rootPath, 'sections/introduction.tex') })
    expect(fromChild.mainPath).toBe(project.mainPath)
    const changed = await configureLatexProject({ workspaceRoot: root, path: project.mainPath }, { ...project.config, engine: 'lualatex' })
    expect(changed.config.engine).toBe('lualatex')
    expect(changed.config.autoBuild).toBe(false)
    expect(await readFile(project.mainPath, 'utf8')).toContain('\\documentclass[UTF8]{ctexart}')
  })
  it('ignores commented document classes and preserves multiple main candidates', async () => {
    await mkdir(join(root, 'sections'))
    await writeFile(join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}A\\end{document}')
    await writeFile(join(root, 'second.tex'), '\\documentclass{article}\n\\begin{document}B\\end{document}')
    await writeFile(join(root, 'sections/child.tex'), '% \\documentclass{fake}\nContent')
    const project = await readLatexProject({ workspaceRoot: root, path: join(root, 'sections/child.tex') })
    expect(project.rootPath).toBe(root)
    expect(project.mainCandidates).toEqual(['main.tex', 'second.tex'])
  })
  it('rejects traversal and symlink escapes', async () => {
    await expect(createLatexProject({ workspaceRoot: root, name: '../outside', template: 'blank', autoBuild: true })).rejects.toThrow('name')
    const project = await createLatexProject({ workspaceRoot: root, name: 'paper', template: 'blank', autoBuild: true })
    await expect(configureLatexProject({ workspaceRoot: root, path: project.mainPath }, { ...project.config, mainFile: '../outside.tex' })).rejects.toThrow()
    await symlink(join(root, 'paper'), join(root, 'paper/escape'))
    await expect(listProjectFiles(project.rootPath)).rejects.toThrow('Symbolic links')
  })
  it('exports source without build products or machine-specific tool paths and reimports it', async () => {
    const project = await createLatexProject({ workspaceRoot: root, name: 'paper', template: 'english', autoBuild: true })
    await writeFile(join(project.rootPath, 'main.aux'), 'generated')
    await writeFile(join(project.rootPath, 'main.pdf'), 'old output')
    const zipBytes = await latexSourceZip(project)
    const zip = await JSZip.loadAsync(zipBytes)
    expect(zip.file('main.tex')).not.toBeNull()
    expect(zip.file('main.aux')).toBeNull()
    expect(zip.file('main.pdf')).toBeNull()
    await writeFile(join(root, 'imported.zip'), zipBytes)
    const imported = await importLatexProject(root, join(root, 'imported.zip'), 'zip')
    expect(imported.config.mainFile).toBe('main.tex')
    expect(await readFile(imported.mainPath, 'utf8')).toBe(await readFile(project.mainPath, 'utf8'))
  })
  it('rejects unsafe ZIP paths and cleans only its new import directory', async () => {
    const zip = new JSZip().file('../outside.tex', 'unsafe')
    await writeFile(join(root, 'unsafe.zip'), await zip.generateAsync({ type: 'nodebuffer' }))
    await expect(importLatexProject(root, join(root, 'unsafe.zip'), 'zip')).rejects.toThrow('unsafe')
    expect(await readFile(join(root, 'unsafe.zip'))).toBeInstanceOf(Buffer)
  })
})
