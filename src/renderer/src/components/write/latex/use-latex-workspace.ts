import { useEffect } from 'react'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { projectFocusedDocument, writeDocumentKey } from '../../../write/write-editor-layout'
import { useWriteEditorBridge } from '../../../write/write-editor-bridge'
import { buildLatex } from '../../../write/latex/latex-build-controller'
import { latexDirty, patchLatex, refreshLatexSources, saveLatexSession, selectLatexFile, latexSession, type LatexSession } from '../../../write/latex/latex-project-store'
import { resolveLatexRevision } from '../../../write/latex/latex-revision'

export function useLatexWorkspace(sessionKey: string, session: LatexSession | undefined, mainPath: string, focused: boolean): void {
  const autoSaveEnabled = useWriteWorkspaceStore((state) => state.autoSaveEnabled)
  const delay = useWriteWorkspaceStore((state) => state.autoSaveDelayMs)
  useEffect(() => {
    const session = latexSession(sessionKey)
    if (!session) return
    const buffer = session.buffers[session.activeFile]
    const saveStatus = session.saving ? 'saving' : session.error ? 'error' : latexDirty(session) ? 'dirty' : 'saved'
    useWriteWorkspaceStore.setState((state) => {
      const key = writeDocumentKey(mainPath)
      const current = state.documentsByPath[key]
      if (!current || current.kind !== 'latex') return {}
      const documentsByPath = { ...state.documentsByPath, [key]: { ...current,
        fileContent: buffer?.content ?? '', persistedContent: buffer?.saved ?? '',
        saveStatus: saveStatus as typeof current.saveStatus, fileError: session.error,
        contentRevision: session.revision, reviewActive: !!session.review.length,
        latexTitle: session.project.config.title
      } }
      return { documentsByPath, ...projectFocusedDocument(state.editorLayout, documentsByPath) }
    })
  }, [session?.buffers, session?.activeFile, session?.saving, session?.error, session?.review, session?.revision, session?.project.config.title, mainPath, sessionKey])

  useEffect(() => {
    const session = latexSession(sessionKey)
    if (!session || !autoSaveEnabled || !latexDirty(session) || session.review.length || session.saving) return
    const timer = window.setTimeout(() => {
      void saveLatexSession(session.workspaceRoot, mainPath).then((saved) => {
        if (saved && session.project.config.autoBuild) void buildLatex(sessionKey)
      })
    }, Math.max(600, delay))
    return () => window.clearTimeout(timer)
  }, [session?.revision, session?.review.length, session?.saving, session?.project.config.autoBuild, autoSaveEnabled, delay, mainPath, sessionKey])

  const fileKey = session?.project.files.join('\0') ?? ''
  useEffect(() => {
    const session = latexSession(sessionKey)
    if (!session) return
    let disposed = false
    let assetTimer: ReturnType<typeof setTimeout> | undefined
    const ids = new Set<string>()
    const unsubscribe = window.kunGui.onWorkspaceFileChanged((event) => {
      if (!ids.has(event.watchId)) return
      const current = latexSession(sessionKey)
      if (!current) return
      const file = event.path.replaceAll('\\', '/').slice(current.project.rootPath.replaceAll('\\', '/').length + 1)
      if (current.buffers[file]) void refreshLatexSources(sessionKey).catch((error) => patchLatex(sessionKey, { error: String(error) }))
      else {
        patchLatex(sessionKey, (current) => ({ revision: current.revision + 1, savedRevision: current.revision + 1, pdfRevision: -1 }))
        if (assetTimer) clearTimeout(assetTimer)
        if (current.project.config.autoBuild) assetTimer = setTimeout(() => { void buildLatex(sessionKey) }, 700)
      }
    })
    for (const file of session.project.files.filter((file) => file !== '.kun-latex.json' && file !== session.project.config.mainFile.replace(/\.(tex|ltx)$/i, '.pdf'))) {
      void window.kunGui.watchWorkspaceFile({ workspaceRoot: session.workspaceRoot, path: `${session.project.rootPath}/${file}`, mode: 'signal' }).then((result) => {
        if (!result.ok) return
        if (disposed) void window.kunGui.unwatchWorkspaceFile(result.watchId)
        else ids.add(result.watchId)
      }).catch(() => {})
    }
    const refresh = (): void => { void refreshLatexSources(sessionKey).catch((error) => patchLatex(sessionKey, { error: String(error) })) }
    window.addEventListener('focus', refresh)
    return () => { disposed = true; if (assetTimer) clearTimeout(assetTimer); unsubscribe(); window.removeEventListener('focus', refresh); for (const id of ids) void window.kunGui.unwatchWorkspaceFile(id) }
  }, [sessionKey, fileKey])

  useEffect(() => {
    const session = latexSession(sessionKey)
    if (!session || !focused) return
    const headings = Object.entries(session.buffers).flatMap(([file, buffer]) => [...buffer.content.matchAll(/\\(subsubsection|subsection|section|chapter)\*?\{([^}]+)\}/g)]
      .map((match) => ({ file, line: buffer.content.slice(0, match.index).split('\n').length,
        text: match[2], level: { chapter: 1, section: 1, subsection: 2, subsubsection: 3 }[match[1]] ?? 1 })))
    useWriteEditorBridge.getState().publish(sessionKey, {
      outline: headings.map((heading, pos) => ({ pos, text: heading.text, level: heading.level, slug: `${heading.file}:${heading.line}` })),
      reviewActive: !!session.review.length,
      reviewChunks: session.review.map((edit) => ({ id: edit.file, kind: 'modified', before: edit.before, after: edit.after })),
      commands: {
        jumpToHeading: (pos) => { const heading = headings[pos]; if (heading) void selectLatexFile(sessionKey, heading.file, heading.line) },
        resolveChunk: (file, decision) => { void resolveLatexRevision(sessionKey, decision, file) },
        resolveAll: (decision) => { void resolveLatexRevision(sessionKey, decision) },
        focusChunk: (index) => { const edit = session.review[index]; if (edit) void selectLatexFile(sessionKey, edit.file, 1) }
      }
    })
    return () => useWriteEditorBridge.getState().release(sessionKey)
  }, [sessionKey, session?.buffers, session?.review, focused])
}
