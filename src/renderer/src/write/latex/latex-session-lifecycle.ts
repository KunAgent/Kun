import { latexDirty, latexSessionKey, latexTarget, patchLatex, useLatexProjectStore } from './latex-project-store'

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
    if (session.workspaceRoot === workspaceRoot && (discard || (!latexDirty(session) && !session.review.length && !session.proposing))) releaseLatexSession(workspaceRoot, session.project.mainPath)
  }
}

export function forgetLatexEntry(workspaceRoot: string, path: string): void {
  const deleted = path.replaceAll('\\', '/')
  const removed = (candidate: string): boolean => {
    const normalized = candidate.replaceAll('\\', '/')
    return normalized === deleted || normalized.startsWith(`${deleted}/`)
  }
  for (const [key, session] of Object.entries(useLatexProjectStore.getState().sessions)) {
    if (session.workspaceRoot !== workspaceRoot) continue
    if (removed(session.project.mainPath)) { releaseLatexSession(workspaceRoot, session.project.mainPath); continue }
    const keep = (file: string): boolean => !removed(`${session.project.rootPath}/${file}`)
    if (session.project.files.every(keep)) continue
    const mainCandidates = session.project.mainCandidates.filter(keep)
    const mainFile = keep(session.project.config.mainFile) ? session.project.config.mainFile : mainCandidates[0] ?? session.project.config.mainFile
    patchLatex(key, { project: { ...session.project, files: session.project.files.filter(keep), mainCandidates, config: { ...session.project.config, mainFile } },
      buffers: Object.fromEntries(Object.entries(session.buffers).filter(([file]) => keep(file))),
      activeFile: keep(session.activeFile) ? session.activeFile : mainFile,
      review: session.review.filter((edit) => keep(edit.file)), pdfRevision: -1,
      needsMainChoice: session.needsMainChoice || !keep(session.project.config.mainFile) })
  }
}

export function relocateLatexSessions(workspaceRoot: string, previous: string, next: string): void {
  const normalized = (path: string): string => path.replaceAll('\\', '/').replace(/\/$/, '')
  const from = normalized(previous), to = normalized(next)
  const relocate = (path: string): string => normalized(path) === from ? to : normalized(path).startsWith(`${from}/`) ? `${to}${normalized(path).slice(from.length)}` : path
  useLatexProjectStore.setState((state) => {
    const sessions = { ...state.sessions }
    for (const [key, session] of Object.entries(state.sessions)) {
      if (session.workspaceRoot !== workspaceRoot) continue
      const rootPath = relocate(session.project.rootPath)
      const mainPath = relocate(session.project.mainPath)
      const relative = (file: string): string => relocate(`${session.project.rootPath}/${file}`).slice(normalized(rootPath).length + 1)
      if (rootPath === session.project.rootPath && mainPath === session.project.mainPath && session.project.files.every((file) => relative(file) === file)) continue
      if (session.buildId) void window.kunGui.latexAbortBuild({ ...latexTarget(session), buildId: session.buildId }).catch(() => {})
      delete sessions[key]
      sessions[latexSessionKey(workspaceRoot, mainPath)] = { ...session, activeFile: relative(session.activeFile),
        project: { ...session.project, rootPath, mainPath, files: session.project.files.map(relative), mainCandidates: session.project.mainCandidates.map(relative),
          config: { ...session.project.config, mainFile: relative(session.project.config.mainFile), bibFile: relative(session.project.config.bibFile) } },
        buffers: Object.fromEntries(Object.entries(session.buffers).map(([file, buffer]) => [relative(file), buffer])),
        review: session.review.map((edit) => ({ ...edit, file: relative(edit.file) })), buildId: null, pdfRevision: -1, jump: null }
    }
    return { sessions }
  })
}
