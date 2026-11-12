import { create } from 'zustand'
import type { LatexBuild, LatexConfig, LatexEdit, LatexPdf, LatexProject, LatexTools, LatexView } from '@shared/latex-project'
import { isLatexFilePath } from '@shared/latex-project'

export type LatexBuffer = { content: string; saved: string; truncated?: boolean }
export type LatexSession = {
  workspaceRoot: string
  project: LatexProject
  activeFile: string
  buffers: Record<string, LatexBuffer>
  revision: number
  savedRevision: number
  build: LatexBuild | null
  buildId: string | null
  pdf: LatexPdf | null
  pdfRevision: number
  tools: LatexTools | null
  log: string
  saving: boolean
  error: string | null
  review: LatexEdit[]
  reviewOrigin: 'ai' | 'external'
  reviewAccepted: boolean
  proposing: boolean
  view: LatexView
  ratio: number
  jump: { file: string; line: number; token: number } | null
  needsMainChoice: boolean
}
type State = { sessions: Record<string, LatexSession>; patch: (key: string, update: Partial<LatexSession> | ((session: LatexSession) => Partial<LatexSession>)) => void }
export const useLatexProjectStore = create<State>((set) => ({
  sessions: {},
  patch: (key, update) => set((state) => {
    const current = state.sessions[key]
    if (!current) return state
    return { sessions: { ...state.sessions, [key]: { ...current, ...(typeof update === 'function' ? update(current) : update) } } }
  })
}))
const normalizeLatexPath = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '')
export const latexSessionKey = (workspaceRoot: string, mainPath: string): string => `${normalizeLatexPath(workspaceRoot)}\0${normalizeLatexPath(mainPath)}`
export const latexSession = (key: string): LatexSession | undefined => useLatexProjectStore.getState().sessions[key]
export const patchLatex = (key: string, update: Parameters<State['patch']>[1]): void => useLatexProjectStore.getState().patch(key, update)
export const latexTarget = (session: LatexSession) => ({ workspaceRoot: session.workspaceRoot, path: session.project.mainPath })
export const latexDirty = (session: LatexSession): boolean => Object.values(session.buffers).some((buffer) => buffer.content !== buffer.saved)

export async function openLatexSession(workspaceRoot: string, requested: string): Promise<LatexSession> {
  const result = await window.kunGui.latexReadProject({ workspaceRoot, path: requested })
  if (!result.ok) throw new Error(result.message)
  const existing = Object.values(useLatexProjectStore.getState().sessions).find((session) => normalizeLatexPath(session.workspaceRoot) === normalizeLatexPath(workspaceRoot) && normalizeLatexPath(session.project.rootPath) === normalizeLatexPath(result.project.rootPath))
  const project = existing ? { ...result.project, mainPath: existing.project.mainPath } : result.project
  const key = latexSessionKey(workspaceRoot, project.mainPath)
  const normalized = requested.replaceAll('\\', '/')
  const file = project.requestedFile ?? project.files.find((file) => `${project.rootPath.replaceAll('\\', '/')}/${file}` === normalized) ?? project.config.mainFile
  if (!latexSession(key)) {
    const session: LatexSession = { workspaceRoot, project, activeFile: file, buffers: {}, revision: 0, savedRevision: 0,
      build: null, buildId: null, pdf: null, pdfRevision: -1, tools: null, log: '', saving: false, error: null,
      review: [], reviewOrigin: 'ai', reviewAccepted: false, proposing: false, view: 'split', ratio: .48, jump: null,
      needsMainChoice: project.needsMainChoice ?? (project.mainCandidates.length > 1 && !project.mainCandidates.includes(file)) }
    useLatexProjectStore.setState((state) => ({ sessions: { ...state.sessions, [key]: session } }))
    const cached = await window.kunGui.latexReadPdf(latexTarget(session))
    if (cached.ok && cached.pdf) patchLatex(key, { pdf: cached.pdf, pdfRevision: cached.currentSourceHash === cached.pdf.sourceHash ? 0 : -1 })
  }
  await selectLatexFile(key, file)
  await loadLatexBuffer(key, project.config.mainFile)
  const session = latexSession(key)!
  for (const bib of project.files.filter((f) => /\.bib$/i.test(f))) await loadLatexBuffer(key, bib)
  return latexSession(key) ?? session
}

export async function loadLatexBuffer(key: string, file: string): Promise<void> {
  const session = latexSession(key)
  if (!session || session.buffers[file]) return
  const result = await window.kunGui.latexReadSource({ workspaceRoot: session.workspaceRoot, path: `${session.project.rootPath}/${file}` })
  if (!result.ok) throw new Error(result.message)
  patchLatex(key, (current) => ({ buffers: current.buffers[file] ? current.buffers : { ...current.buffers, [file]: { content: result.content, saved: result.content, truncated: result.truncated } } }))
}

export async function selectLatexFile(key: string, file: string, line?: number): Promise<void> {
  try {
    await loadLatexBuffer(key, file)
    patchLatex(key, (session) => ({ activeFile: file, ...(line ? { view: session.view === 'pdf' ? 'source' : session.view, jump: { file, line, token: Date.now() } } : {}) }))
  } catch (error) { patchLatex(key, { error: String(error) }) }
}

export function editLatexBuffer(key: string, file: string, content: string): void {
  patchLatex(key, (session) => {
    const buffer = session.buffers[file]
    if (!buffer || buffer.truncated || buffer.content === content) return {}
    return { buffers: { ...session.buffers, [file]: { ...buffer, content } }, revision: session.revision + 1, error: null }
  })
}

const saves = new Map<string, Promise<boolean>>()
export async function saveLatexSession(workspaceRoot: string, mainPath: string): Promise<boolean> {
  const key = latexSessionKey(workspaceRoot, mainPath)
  const prior = saves.get(key)
  if (prior) return prior
  const save = (async (): Promise<boolean> => {
    patchLatex(key, { saving: true })
    try {
      for (;;) {
        const session = latexSession(key)
        if (!session) return true
        if (session.review.length) return false
        const edits = Object.entries(session.buffers).filter(([, b]) => b.content !== b.saved)
          .map(([file, b]) => ({ file, before: b.saved, after: b.content }))
        if (!edits.length) { patchLatex(key, { savedRevision: session.revision }); return true }
        const result = await window.kunGui.latexSave({ ...latexTarget(session), edits })
        if (!result.ok) throw new Error(result.message)
        patchLatex(key, (current) => ({ buffers: Object.fromEntries(Object.entries(current.buffers).map(([file, buffer]) => {
          const edit = edits.find((edit) => edit.file === file)
          return [file, edit ? { ...buffer, saved: edit.after } : buffer]
        })), savedRevision: session.revision, error: null }))
      }
    } catch (error) { patchLatex(key, { error: error instanceof Error ? error.message : String(error) }); return false }
    finally { patchLatex(key, { saving: false }) }
  })()
  saves.set(key, save)
  let saved = false
  try { saved = await save; return saved }
  finally {
    if (saves.get(key) === save) saves.delete(key)
    if (!saved) void refreshLatexSources(key).catch((error) => patchLatex(key, { error: String(error) }))
  }
}

export async function configureLatex(key: string, config: LatexConfig): Promise<void> {
  const session = latexSession(key)
  if (!session) return
  const result = await window.kunGui.latexConfigure({ ...latexTarget(session), config })
  if (!result.ok) throw new Error(result.message)
  // The tab's identity stays stable when a different main file is selected.
  patchLatex(key, { project: { ...result.project, mainPath: session.project.mainPath }, tools: null, needsMainChoice: false, pdfRevision: -1 })
}

export async function refreshLatexSources(key: string): Promise<void> {
  const session = latexSession(key)
  if (!session || session.saving || saves.has(key) || session.review.length) return
  const review: LatexEdit[] = []
  for (const [file, buffer] of Object.entries(session.buffers)) {
    const result = await window.kunGui.latexReadSource({ workspaceRoot: session.workspaceRoot, path: `${session.project.rootPath}/${file}` })
    if (!result.ok || result.content === buffer.saved) continue
    if (result.content === buffer.content) {
      patchLatex(key, (current) => ({ buffers: { ...current.buffers, [file]: { ...current.buffers[file], saved: result.content } } }))
      continue
    }
    review.push({ file, before: buffer.content, after: result.content })
  }
  if (!review.length || latexSession(key)?.revision !== session.revision || latexSession(key)?.saving) return
  patchLatex(key, (current) => ({ review, reviewOrigin: 'external', reviewAccepted: false, pdfRevision: -1, buffers: Object.fromEntries(Object.entries(current.buffers).map(([file, buffer]) => {
    const edit = review.find((edit) => edit.file === file)
    return [file, edit ? { ...buffer, saved: edit.after } : buffer]
  })) }))
}

export async function loadLatexFixContext(key: string): Promise<Array<{ file: string; content: string }>> {
  const session = latexSession(key)!
  const candidates = [...new Set([session.activeFile, session.project.config.mainFile,
    ...(session.build?.diagnostics.map((d) => d.file).filter((f): f is string => !!f && session.project.files.includes(f)) ?? []),
    ...session.project.files.filter(isLatexFilePath)])].slice(0, 30)
  const files: Array<{ file: string; content: string }> = []
  let bytes = 0
  for (const file of candidates) {
    await loadLatexBuffer(key, file)
    const content = latexSession(key)?.buffers[file]?.content ?? ''
    if (latexSession(key)?.buffers[file]?.truncated) continue
    bytes += new TextEncoder().encode(content).length
    if (bytes > 300_000) break
    files.push({ file, content })
  }
  return files
}
