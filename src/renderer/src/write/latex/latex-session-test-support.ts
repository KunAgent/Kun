import { vi } from 'vitest'
import type { KunGuiLatexApi, LatexBuild, LatexProject } from '@shared/latex-project'
import { latexSessionKey, useLatexProjectStore } from './latex-project-store'

export function installLatexSessionFixture() {
  useLatexProjectStore.setState({ sessions: {} })
  let project: LatexProject = { rootPath: '/work/paper', mainPath: '/work/paper/main.tex', files: ['main.tex', 'refs.bib'], mainCandidates: ['main.tex'],
    config: { version: 1, title: 'Paper', mainFile: 'main.tex', engine: 'pdflatex', autoBuild: false, toolDirectory: '', bibFile: 'refs.bib' } }
  const disk = new Map([['main.tex', 'original source'], ['refs.bib', '']])
  const readProject = (path: string): LatexProject => {
    const file = path.replaceAll('\\', '/').slice(project.rootPath.length + 1)
    return structuredClone({ ...project, files: [...disk.keys()].sort(), ...(disk.has(file) ? { requestedFile: file } : {}) })
  }
  const api = {
    latexReadProject: vi.fn(async ({ path }: { path: string }) => ({ ok: true as const, project: readProject(path) })),
    latexReadSource: vi.fn(async ({ path }: { path: string }) => {
      const file = path.replaceAll('\\', '/').slice(project.rootPath.length + 1)
      return disk.has(file) ? { ok: true as const, content: disk.get(file)! } : { ok: false as const, message: 'File not found.' }
    }),
    latexReadPdf: vi.fn(async (): ReturnType<KunGuiLatexApi['latexReadPdf']> => ({ ok: true, pdf: null, currentSourceHash: '' })),
    latexSave: vi.fn(async ({ edits }: Parameters<KunGuiLatexApi['latexSave']>[0]) => {
      if (edits.some((edit) => (disk.get(edit.file) ?? '') !== edit.before)) return { ok: false as const, message: 'Source changed on disk.' }
      for (const edit of edits) disk.set(edit.file, edit.after)
      return { ok: true as const }
    }),
    latexConfigure: vi.fn(async ({ config }: Parameters<KunGuiLatexApi['latexConfigure']>[0]) => {
      project = { ...project, config, mainPath: `${project.rootPath}/${config.mainFile}` }
      return { ok: true as const, project: readProject(project.mainPath) }
    }),
    latexBuild: vi.fn(async (input: Parameters<KunGuiLatexApi['latexBuild']>[0]): ReturnType<KunGuiLatexApi['latexBuild']> => ({ ok: true, build: completedLatexBuild(input.buildId, input.sourceRevision, disk.get(project.config.mainFile)!) })),
    latexAbortBuild: vi.fn(async () => ({ ok: true as const })),
    latexProposeFix: vi.fn(async (_input: Parameters<KunGuiLatexApi['latexProposeFix']>[0]): ReturnType<KunGuiLatexApi['latexProposeFix']> => ({ ok: true, edits: [] })),
    onLatexBuildLog: vi.fn((_handler: Parameters<KunGuiLatexApi['onLatexBuildLog']>[0]) => () => {})
  }
  vi.stubGlobal('window', { kunGui: api })
  return { api, disk, project, key: latexSessionKey('/work', project.mainPath), setProject: (next: LatexProject) => { project = next } }
}

export function completedLatexBuild(buildId: string, sourceRevision: number, sourceHash: string): LatexBuild {
  return { buildId, status: 'succeeded', sourceRevision, sourceHash, durationMs: 1, completedAt: 1, diagnostics: [], log: '',
    tools: { latexmk: '/tex/latexmk', engine: '/tex/pdflatex', synctex: null, searchedPaths: [] },
    pdf: { buildId, sourceHash, dataBase64: 'pdf', size: 3, mtimeMs: 1 } }
}

export function latexGate<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
