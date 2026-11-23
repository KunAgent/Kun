import i18n from '../../i18n'
import { latexDirty, latexSessionKey, latexTarget, normalizeLatexPath, patchLatexSession, saveLatexSession, useLatexProjectStore } from './latex-project-store'

export type LatexPathChange = { previousPath: string; nextPath: string }
type DeletionOwner = { key: string; instanceId: string }
export type LatexDeletionPreparation = { ok: true; owners: DeletionOwner[] } | { ok: false; message: string }
const under = (path: string, parent: string): boolean => normalizeLatexPath(path) === normalizeLatexPath(parent) || normalizeLatexPath(path).startsWith(`${normalizeLatexPath(parent)}/`)

export function releaseLatexSession(workspaceRoot: string, path: string): void {
  const key = latexSessionKey(workspaceRoot, path)
  const session = useLatexProjectStore.getState().sessions[key]
  if (session?.buildId) void window.kunGui.latexAbortBuild({ ...latexTarget(session), buildId: session.buildId }).catch(() => {})
  useLatexProjectStore.setState((state) => {
    const sessions = { ...state.sessions }
    delete sessions[key]
    return { sessions }
  })
}

export function releaseLatexWorkspace(workspaceRoot: string, discard = false): void {
  for (const session of Object.values(useLatexProjectStore.getState().sessions)) {
    if (session.workspaceRoot === workspaceRoot && (discard || (!latexDirty(session) && !session.review.length && !session.proposing && !session.deleting))) releaseLatexSession(workspaceRoot, session.project.mainPath)
  }
}

export function finishLatexEntryDeletion(owners: DeletionOwner[]): void {
  for (const owner of owners) patchLatexSession(owner.key, owner.instanceId, { deleting: false })
}

export async function prepareLatexEntryDeletion(workspaceRoot: string, path: string): Promise<LatexDeletionPreparation> {
  const owners: DeletionOwner[] = []
  try {
    for (const [key, session] of Object.entries(useLatexProjectStore.getState().sessions)) {
      if (session.workspaceRoot !== workspaceRoot || !under(session.project.mainPath, path)) continue
      const survivors = session.project.files.filter((file) => !under(`${session.project.rootPath}/${file}`, path))
      const nextMain = survivors.find((file) => /\.(tex|ltx)$/i.test(file))
      const survivingReview = session.review.some((edit) => survivors.includes(edit.file))
      if (!nextMain && (survivingReview || (survivors.length > 0 && session.proposing))) throw new Error(i18n.t('common:latexDeletePendingReview'))
      if (session.deleting) throw new Error(i18n.t('common:latexDeleteInProgress'))
      owners.push({ key, instanceId: session.instanceId })
      patchLatexSession(key, session.instanceId, { deleting: true })
      // If the tab cannot move to another main file, persist the other sources
      // before removing its anchor. The deletion confirmation covers only path.
      if (!nextMain && survivors.some((file) => {
        const buffer = session.buffers[file]
        return buffer && buffer.content !== buffer.saved
      }) && !await saveLatexSession(workspaceRoot, session.project.mainPath)) {
        throw new Error(i18n.t('common:latexDeleteSaveFailed'))
      }
    }
    return { ok: true, owners }
  } catch (error) {
    finishLatexEntryDeletion(owners)
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function forgetLatexEntry(workspaceRoot: string, path: string): LatexPathChange[] {
  const changes: LatexPathChange[] = []
  for (const [key, session] of Object.entries(useLatexProjectStore.getState().sessions)) {
    if (session.workspaceRoot !== workspaceRoot) continue
    const keep = (file: string): boolean => !under(`${session.project.rootPath}/${file}`, path)
    if (session.project.files.every(keep) && !under(session.project.mainPath, path)) continue
    const files = session.project.files.filter(keep)
    const mainCandidates = session.project.mainCandidates.filter(keep)
    const mainFile = keep(session.project.config.mainFile) ? session.project.config.mainFile
      : mainCandidates[0] ?? files.find((file) => /\.(tex|ltx)$/i.test(file))
    const anchorRemoved = under(session.project.mainPath, path)
    if (anchorRemoved && !mainFile) { releaseLatexSession(workspaceRoot, session.project.mainPath); continue }
    const nextPath = anchorRemoved ? `${normalizeLatexPath(session.project.rootPath)}/${mainFile}` : session.project.mainPath
    const moved = { ...session, projectRevision: session.projectRevision + 1, project: { ...session.project, mainPath: nextPath, files, mainCandidates,
      config: { ...session.project.config, mainFile: mainFile ?? session.project.config.mainFile } },
      buffers: Object.fromEntries(Object.entries(session.buffers).filter(([file]) => keep(file))),
      activeFile: keep(session.activeFile) ? session.activeFile : mainFile ?? session.activeFile,
      review: session.review.filter((edit) => keep(edit.file)), reviewRevision: session.reviewRevision + 1,
      pdfRevision: -1, revision: session.revision + 1, needsMainChoice: session.needsMainChoice || !keep(session.project.config.mainFile) }
    if (anchorRemoved) {
      if (session.buildId) void window.kunGui.latexAbortBuild({ ...latexTarget(session), buildId: session.buildId }).catch(() => {})
      Object.assign(moved, { instanceId: crypto.randomUUID(), buildId: null, saving: false, proposing: false, proposalIds: [], deleting: false })
      useLatexProjectStore.setState((state) => {
        const sessions = { ...state.sessions }
        delete sessions[key]
        return { sessions: { ...sessions, [latexSessionKey(workspaceRoot, nextPath)]: moved } }
      })
      changes.push({ previousPath: session.project.mainPath, nextPath })
    } else patchLatexSession(key, session.instanceId, moved)
  }
  return changes
}

export function relocateLatexSessions(workspaceRoot: string, previous: string, next: string): void {
  const from = normalizeLatexPath(previous), to = normalizeLatexPath(next)
  const relocate = (path: string): string => under(path, from) ? `${to}${normalizeLatexPath(path).slice(from.length)}` : path
  useLatexProjectStore.setState((state) => {
    const sessions = { ...state.sessions }
    for (const [key, session] of Object.entries(state.sessions)) {
      if (session.workspaceRoot !== workspaceRoot) continue
      const rootPath = relocate(session.project.rootPath)
      const mainPath = relocate(session.project.mainPath)
      const relative = (file: string): string => relocate(`${session.project.rootPath}/${file}`).slice(normalizeLatexPath(rootPath).length + 1)
      if (rootPath === session.project.rootPath && mainPath === session.project.mainPath && session.project.files.every((file) => relative(file) === file)) continue
      if (session.buildId) void window.kunGui.latexAbortBuild({ ...latexTarget(session), buildId: session.buildId }).catch(() => {})
      delete sessions[key]
      sessions[latexSessionKey(workspaceRoot, mainPath)] = { ...session, instanceId: crypto.randomUUID(), projectRevision: session.projectRevision + 1, activeFile: relative(session.activeFile),
        project: { ...session.project, rootPath, mainPath, files: session.project.files.map(relative), mainCandidates: session.project.mainCandidates.map(relative),
          config: { ...session.project.config, mainFile: relative(session.project.config.mainFile), bibFile: relative(session.project.config.bibFile) } },
        buffers: Object.fromEntries(Object.entries(session.buffers).map(([file, buffer]) => [relative(file), buffer])),
        review: session.review.map((edit) => ({ ...edit, file: relative(edit.file) })), reviewRevision: session.reviewRevision + 1,
        buildId: null, saving: false, proposing: false, proposalIds: [], deleting: false, pdfRevision: -1, jump: null }
    }
    return { sessions }
  })
}
