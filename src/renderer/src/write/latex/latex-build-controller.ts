import { latexSession, latexTarget, patchLatex, saveLatexSession } from './latex-project-store'

const builds = new Map<string, Promise<boolean>>()
const queued = new Set<string>()
export async function buildLatex(key: string): Promise<boolean> {
  const existing = builds.get(key)
  if (existing) { queued.add(key); return existing }
  const promise = (async (): Promise<boolean> => {
    let success = false
    do {
      queued.delete(key)
      const beforeSave = latexSession(key)
      if (!beforeSave || beforeSave.needsMainChoice || !await saveLatexSession(beforeSave.workspaceRoot, beforeSave.project.mainPath)) return false
      const session = latexSession(key)
      if (!session) return false
      const revision = session.revision
      const buildId = crypto.randomUUID()
      patchLatex(key, { buildId, log: '', error: null })
      const unsubscribe = window.kunGui.onLatexBuildLog((event) => {
        if (event.buildId === buildId) patchLatex(key, (current) => ({ log: (current.log + event.text).slice(-256 * 1024) }))
      })
      try {
        const result = await window.kunGui.latexBuild({ ...latexTarget(session), buildId, sourceRevision: revision })
        if (!result.ok) throw new Error(result.message)
        const build = result.build
        success = build.status === 'succeeded'
        patchLatex(key, { build, tools: build.tools, log: build.log,
          ...(build.pdf ? { pdf: build.pdf, pdfRevision: revision } : {}) })
        if (build.status === 'cancelled' || build.status === 'missing-tools') queued.delete(key)
      } catch (error) {
        patchLatex(key, { error: error instanceof Error ? error.message : String(error) })
        queued.delete(key)
        return false
      } finally { unsubscribe(); patchLatex(key, { buildId: null }) }
    } while (queued.has(key))
    return success
  })()
  builds.set(key, promise)
  try { return await promise } finally { builds.delete(key) }
}

export async function abortLatexBuild(key: string): Promise<void> {
  queued.delete(key)
  const session = latexSession(key)
  if (session?.buildId) await window.kunGui.latexAbortBuild({ ...latexTarget(session), buildId: session.buildId })
}

export async function exportLatex(key: string, format: 'pdf' | 'source'): Promise<void> {
  const session = latexSession(key)
  if (!session || !await saveLatexSession(session.workspaceRoot, session.project.mainPath)) return
  // Compile every PDF export: external image/input edits also belong to its revision.
  if (format === 'pdf' && !await buildLatex(key)) return
  const current = latexSession(key)
  if (!current) return
  const result = await window.kunGui.latexExport({ ...latexTarget(current), format, sourceHash: current.pdf?.sourceHash })
  if (!result.ok) patchLatex(key, { error: result.message })
}
