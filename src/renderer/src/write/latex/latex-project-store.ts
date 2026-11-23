import { create } from 'zustand'
import type { LatexBuild, LatexConfig, LatexEdit, LatexPdf, LatexProject, LatexTools, LatexView } from '@shared/latex-project'
import { isLatexFilePath } from '@shared/latex-project'

export type LatexBuffer = { content: string; saved: string; truncated?: boolean }
export type LatexSession = {
  instanceId: string
  workspaceRoot: string
  project: LatexProject
  projectRevision: number
  activeFile: string
  buffers: Record<string, LatexBuffer>
  revision: number
  savedRevision: number
  build: LatexBuild | null
  buildId: string | null
  pdf: LatexPdf | null
  pdfRevision: number
  sourceObservation: { hash: string; revision: number } | null
  tools: LatexTools | null
  log: string
  saving: boolean
  deleting: boolean
  error: string | null
  review: LatexEdit[]
  reviewRevision: number
  reviewOrigin: 'ai' | 'external'
  reviewAccepted: boolean
  proposing: boolean
  proposalIds: string[]
  view: LatexView
  ratio: number
  jump: { file: string; line: number; token: number } | null
  needsMainChoice: boolean
}
type SessionPatch = Partial<LatexSession> | ((session: LatexSession) => Partial<LatexSession>)
type State = { sessions: Record<string, LatexSession>; patch: (key: string, update: SessionPatch) => void }
function sameProjectData(first: LatexProject, second: LatexProject): boolean {
  return first.rootPath === second.rootPath && first.mainPath === second.mainPath &&
    JSON.stringify(first.config) === JSON.stringify(second.config) && first.files.join('\0') === second.files.join('\0') &&
    first.mainCandidates.join('\0') === second.mainCandidates.join('\0')
}
export const useLatexProjectStore = create<State>((set) => ({
  sessions: {},
  patch: (key, update) => set((state) => {
    const current = state.sessions[key]
    if (!current) return state
    const patch = typeof update === 'function' ? update(current) : update
    if (!Object.keys(patch).length) return state
    const next = { ...current, ...patch }
    if (patch.project && !sameProjectData(patch.project, current.project)) next.projectRevision = current.projectRevision + 1
    if (patch.review && patch.review !== current.review) next.reviewRevision = current.reviewRevision + 1
    return { sessions: { ...state.sessions, [key]: next } }
  })
}))
export const normalizeLatexPath = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '')
export const latexSessionKey = (workspaceRoot: string, mainPath: string): string => `${normalizeLatexPath(workspaceRoot)}\0${normalizeLatexPath(mainPath)}`
export const latexSession = (key: string): LatexSession | undefined => useLatexProjectStore.getState().sessions[key]
export const patchLatex = (key: string, update: SessionPatch): void => useLatexProjectStore.getState().patch(key, update)
export const isLatexSessionCurrent = (key: string, instanceId: string): boolean => latexSession(key)?.instanceId === instanceId
export function patchLatexSession(key: string, instanceId: string, update: SessionPatch): void {
  if (isLatexSessionCurrent(key, instanceId)) patchLatex(key, update)
}
// The Work tab can keep its original path while another main document is selected.
export const latexTarget = (session: LatexSession) => ({ workspaceRoot: session.workspaceRoot, path: `${session.project.rootPath}/${session.project.config.mainFile}` })
export const latexDirty = (session: LatexSession): boolean => Object.values(session.buffers).some((buffer) => buffer.content !== buffer.saved)

type SaveJob = { instanceId: string; rootPath: string; workspaceRoot: string; promise: Promise<boolean> }
const saves = new Map<string, SaveJob>()

async function reconcileLatexPdf(key: string): Promise<void> {
  const session = latexSession(key)
  if (!session || session.deleting || session.saving || saves.has(key)) return
  const result = await window.kunGui.latexReadPdf({ ...latexTarget(session), metadataOnly: true })
  const current = latexSession(key)
  if (!result.ok) {
    if (current?.instanceId === session.instanceId) throw new Error(result.message)
    return
  }
  if (!result.currentSourceHash || !current || current.instanceId !== session.instanceId || current.deleting || current.saving ||
    saves.has(key) || current.revision !== session.revision || current.savedRevision !== session.savedRevision ||
    current.projectRevision !== session.projectRevision || current.reviewRevision !== session.reviewRevision || current.sourceObservation !== session.sourceObservation) return
  const clean = !latexDirty(current) && !current.review.length
  const matches = current.pdf?.sourceHash === result.currentSourceHash
  const changed = current.sourceObservation?.hash !== result.currentSourceHash
  const revision = current.revision + (changed && clean ? 1 : 0)
  patchLatexSession(key, session.instanceId, { sourceObservation: { hash: result.currentSourceHash, revision: clean ? revision : -1 },
    revision, ...(clean ? { savedRevision: revision } : {}), pdfRevision: matches && clean && revision === current.revision ? current.pdfRevision : -1 })
}

export async function reconcileLatexProject(key: string, discovered?: LatexProject): Promise<void> {
  const session = latexSession(key)
  if (!session || session.deleting) return
  let project = discovered
  if (!project) {
    const result = await window.kunGui.latexReadProject(latexTarget(session))
    if (!isLatexSessionCurrent(key, session.instanceId)) return
    if (!result.ok) throw new Error(result.message)
    project = result.project
  }
  if (!isLatexSessionCurrent(key, session.instanceId)) return
  const current = latexSession(key)!
  if (current.deleting) return
  if (current.projectRevision !== session.projectRevision) { await refreshLatexSources(key); return }
  const nextProject = { ...project, mainPath: session.project.mainPath }
  const changed = !sameProjectData(current.project, nextProject)
  patchLatexSession(key, session.instanceId, {
    project: nextProject,
    needsMainChoice: project.needsMainChoice ?? current.needsMainChoice,
    ...(changed ? { revision: current.revision + 1, pdfRevision: -1, tools: null } : {})
  })
  await refreshLatexSources(key)
  await reconcileLatexPdf(key)
}

export async function openLatexSession(workspaceRoot: string, requested: string): Promise<LatexSession> {
  const before = Object.values(useLatexProjectStore.getState().sessions).find((session) => normalizeLatexPath(session.workspaceRoot) === normalizeLatexPath(workspaceRoot) &&
    (normalizeLatexPath(requested) === normalizeLatexPath(session.project.rootPath) || normalizeLatexPath(requested).startsWith(`${normalizeLatexPath(session.project.rootPath)}/`)))
  const result = await window.kunGui.latexReadProject({ workspaceRoot, path: requested })
  if (!result.ok) throw new Error(result.message)
  const existing = Object.values(useLatexProjectStore.getState().sessions).find((session) => normalizeLatexPath(session.workspaceRoot) === normalizeLatexPath(workspaceRoot) && normalizeLatexPath(session.project.rootPath) === normalizeLatexPath(result.project.rootPath))
  const project = existing ? { ...result.project, mainPath: existing.project.mainPath } : result.project
  const key = latexSessionKey(workspaceRoot, project.mainPath)
  const pending = [...saves.values()].filter((job) => normalizeLatexPath(job.workspaceRoot) === normalizeLatexPath(workspaceRoot) && normalizeLatexPath(job.rootPath) === normalizeLatexPath(project.rootPath))
  await Promise.all(pending.map((job) => job.promise))
  if (!latexSession(key)) {
    const session: LatexSession = { instanceId: crypto.randomUUID(), workspaceRoot, project,
      projectRevision: 0, activeFile: project.config.mainFile, buffers: {}, revision: 0, savedRevision: 0,
      build: null, buildId: null, pdf: null, pdfRevision: -1, sourceObservation: null,
      tools: null, log: '', saving: false, deleting: false, error: null,
      review: [], reviewRevision: 0, reviewOrigin: 'ai', reviewAccepted: false, proposing: false, proposalIds: [],
      view: 'split', ratio: .48, jump: null, needsMainChoice: project.needsMainChoice ?? false }
    useLatexProjectStore.setState((state) => ({ sessions: { ...state.sessions, [key]: session } }))
    const cached = await window.kunGui.latexReadPdf(latexTarget(session))
    if (cached.ok) patchLatexSession(key, session.instanceId, (current) => current.sourceObservation ? {} : {
      sourceObservation: cached.currentSourceHash ? { hash: cached.currentSourceHash, revision: current.revision === 0 ? 0 : -1 } : null,
      ...(cached.pdf ? { pdf: cached.pdf, pdfRevision: cached.currentSourceHash === cached.pdf.sourceHash && current.revision === 0 ? 0 : -1 } : {})
    })
  } else {
    await reconcileLatexProject(key, before && (before.instanceId !== existing?.instanceId || before.projectRevision !== existing?.projectRevision) ? undefined : project)
  }
  const owner = latexSession(key)
  if (!owner) throw new Error('Paper closed while opening its sources.')
  const normalized = normalizeLatexPath(requested)
  const activeProject = owner.project
  const file = activeProject.files.find((file) => `${normalizeLatexPath(activeProject.rootPath)}/${file}` === normalized) ?? activeProject.requestedFile ?? activeProject.config.mainFile
  await selectLatexFile(key, file)
  await loadLatexBuffer(key, activeProject.config.mainFile)
  for (const bib of activeProject.files.filter((file) => /\.bib$/i.test(file))) await loadLatexBuffer(key, bib)
  if (!isLatexSessionCurrent(key, owner.instanceId)) throw new Error('Paper changed while opening its sources.')
  return latexSession(key)!
}

export async function loadLatexBuffer(key: string, file: string): Promise<void> {
  const session = latexSession(key)
  if (!session || session.buffers[file]) return
  const result = await window.kunGui.latexReadSource({ workspaceRoot: session.workspaceRoot, path: `${session.project.rootPath}/${file}` })
  if (!isLatexSessionCurrent(key, session.instanceId)) return
  if (!result.ok) throw new Error(result.message)
  patchLatexSession(key, session.instanceId, (current) => ({ buffers: current.buffers[file] ? current.buffers : { ...current.buffers, [file]: { content: result.content, saved: result.content, truncated: result.truncated } } }))
}

export async function selectLatexFile(key: string, file: string, line?: number): Promise<void> {
  const session = latexSession(key)
  if (!session) return
  try {
    await loadLatexBuffer(key, file)
    patchLatexSession(key, session.instanceId, (current) => ({ activeFile: file, ...(line ? { view: current.view === 'pdf' ? 'source' : current.view, jump: { file, line, token: Date.now() } } : {}) }))
  } catch (error) { patchLatexSession(key, session.instanceId, { error: String(error) }) }
}

export function editLatexBuffer(key: string, file: string, content: string): void {
  patchLatex(key, (session) => {
    const buffer = session.buffers[file]
    if (!buffer || session.deleting || buffer.truncated || buffer.content === content) return {}
    return { buffers: { ...session.buffers, [file]: { ...buffer, content } }, revision: session.revision + 1, error: null }
  })
}

export async function saveLatexSession(workspaceRoot: string, mainPath: string): Promise<boolean> {
  const key = latexSessionKey(workspaceRoot, mainPath)
  const owner = latexSession(key)
  if (!owner) return true
  const prior = saves.get(key)
  if (prior) {
    if (prior.instanceId === owner.instanceId) return prior.promise
    await prior.promise
    return isLatexSessionCurrent(key, owner.instanceId) ? saveLatexSession(workspaceRoot, mainPath) : false
  }
  const save = (async (): Promise<boolean> => {
    patchLatexSession(key, owner.instanceId, { saving: true })
    try {
      for (;;) {
        const session = latexSession(key)
        if (!session || session.instanceId !== owner.instanceId) return false
        if (session.review.length) return false
        const edits = Object.entries(session.buffers).filter(([, buffer]) => buffer.content !== buffer.saved)
          .map(([file, buffer]) => ({ file, before: buffer.saved, after: buffer.content }))
        if (!edits.length) { patchLatexSession(key, owner.instanceId, { savedRevision: session.revision }); return true }
        const result = await window.kunGui.latexSave({ ...latexTarget(session), edits })
        if (!result.ok) throw new Error(result.message)
        patchLatexSession(key, owner.instanceId, (current) => ({ buffers: Object.fromEntries(Object.entries(current.buffers).map(([file, buffer]) => {
          const edit = edits.find((edit) => edit.file === file)
          return [file, edit ? { ...buffer, saved: edit.after } : buffer]
        })), savedRevision: session.revision, error: null }))
      }
    } catch (error) { patchLatexSession(key, owner.instanceId, { error: error instanceof Error ? error.message : String(error) }); return false }
    finally { patchLatexSession(key, owner.instanceId, { saving: false }) }
  })()
  const job = { instanceId: owner.instanceId, rootPath: owner.project.rootPath, workspaceRoot, promise: save }
  saves.set(key, job)
  let saved = false
  try { saved = await save; return saved }
  finally {
    if (saves.get(key) === job) saves.delete(key)
    if (!saved && isLatexSessionCurrent(key, owner.instanceId)) void refreshLatexSources(key).catch((error) => patchLatexSession(key, owner.instanceId, { error: String(error) }))
  }
}

export async function configureLatex(key: string, config: LatexConfig): Promise<void> {
  const session = latexSession(key)
  if (!session || session.deleting) return
  const result = await window.kunGui.latexConfigure({ ...latexTarget(session), config })
  if (!isLatexSessionCurrent(key, session.instanceId)) return
  if (!result.ok) throw new Error(result.message)
  patchLatexSession(key, session.instanceId, (current) => ({ project: { ...result.project, mainPath: session.project.mainPath },
    revision: current.revision + 1, tools: null, needsMainChoice: false, pdfRevision: -1 }))
}

export async function refreshLatexSources(key: string): Promise<void> {
  const session = latexSession(key)
  if (!session || session.deleting || session.saving || saves.has(key) || session.review.length) return
  const review: LatexEdit[] = []
  const confirmed = new Map<string, string>()
  for (const [file, buffer] of Object.entries(session.buffers)) {
    const result = await window.kunGui.latexReadSource({ workspaceRoot: session.workspaceRoot, path: `${session.project.rootPath}/${file}` })
    if (!result.ok || result.content === buffer.saved) continue
    if (result.content === buffer.content) confirmed.set(file, result.content)
    else review.push({ file, before: buffer.content, after: result.content })
  }
  const current = latexSession(key)
  if (!current || current.instanceId !== session.instanceId || current.revision !== session.revision ||
    current.reviewRevision !== session.reviewRevision || current.deleting || current.saving || saves.has(key)) return
  if (!review.length && !confirmed.size) return
  patchLatexSession(key, session.instanceId, { ...(review.length ? {
    review, reviewOrigin: 'external', reviewAccepted: false, pdfRevision: -1, revision: current.revision + 1
  } : {}), buffers: Object.fromEntries(Object.entries(current.buffers).map(([file, buffer]) => {
    const edit = review.find((edit) => edit.file === file)
    const saved = edit?.after ?? confirmed.get(file)
    return [file, saved !== undefined ? { ...buffer, saved } : buffer]
  })) })
}

export async function loadLatexFixContext(key: string): Promise<Array<{ file: string; content: string }>> {
  const session = latexSession(key)
  if (!session) return []
  const candidates = [...new Set([session.activeFile, session.project.config.mainFile,
    ...(session.build?.diagnostics.map((diagnostic) => diagnostic.file).filter((file): file is string => !!file && session.project.files.includes(file)) ?? []),
    ...session.project.files.filter(isLatexFilePath)])].slice(0, 30)
  const files: Array<{ file: string; content: string }> = []
  let bytes = 0
  for (const file of candidates) {
    await loadLatexBuffer(key, file)
    if (!isLatexSessionCurrent(key, session.instanceId)) return []
    const buffer = latexSession(key)?.buffers[file]
    if (!buffer || buffer.truncated) continue
    bytes += new TextEncoder().encode(buffer.content).length
    if (bytes > 300_000) break
    files.push({ file, content: buffer.content })
  }
  return files
}
