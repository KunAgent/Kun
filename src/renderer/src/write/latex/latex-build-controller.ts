import { isLatexSessionCurrent, latexDirty, latexSession, latexTarget, patchLatexSession, refreshLatexSources, saveLatexSession } from './latex-project-store'
import i18n from '../../i18n'

type BuildJob = { instanceId: string; queued: boolean; promise: Promise<boolean> }
const builds = new Map<string, BuildJob>()
export async function buildLatex(key: string): Promise<boolean> {
  const owner = latexSession(key)
  if (!owner || owner.deleting) return false
  const pending = builds.get(key)
  if (pending) {
    if (pending.instanceId === owner.instanceId) { pending.queued = true; return pending.promise }
    await pending.promise.catch(() => false)
    return isLatexSessionCurrent(key, owner.instanceId) ? buildLatex(key) : false
  }
  const job: BuildJob = { instanceId: owner.instanceId, queued: false, promise: Promise.resolve(false) }
  const promise = (async (): Promise<boolean> => {
    try {
      let success = false
      do {
        job.queued = false
        if (!isLatexSessionCurrent(key, owner.instanceId)) return false
        await refreshLatexSources(key)
        const beforeSave = latexSession(key)
        if (!beforeSave || beforeSave.instanceId !== owner.instanceId || beforeSave.deleting || beforeSave.needsMainChoice ||
          !await saveLatexSession(beforeSave.workspaceRoot, beforeSave.project.mainPath)) return false
        const session = latexSession(key)
        if (!session || session.instanceId !== owner.instanceId || session.deleting) return false
        if (session.review.length) return false
        if (latexDirty(session)) { job.queued = true; continue }
        const revision = session.revision
        const buildId = crypto.randomUUID()
        const ownsBuild = (): boolean => isLatexSessionCurrent(key, owner.instanceId) && latexSession(key)?.buildId === buildId
        patchLatexSession(key, owner.instanceId, { buildId, log: '', error: null })
        const unsubscribe = window.kunGui.onLatexBuildLog((event) => {
          if (event.buildId === buildId && ownsBuild()) patchLatexSession(key, owner.instanceId, (current) => ({ log: (current.log + event.text).slice(-256 * 1024) }))
        })
        try {
          const result = await window.kunGui.latexBuild({ ...latexTarget(session), buildId, sourceRevision: revision })
          if (!ownsBuild()) return false
          if (!result.ok) throw new Error(result.message)
          const build = result.build
          if (build.sourceRevision !== revision) throw new Error('The compiler returned a different source revision.')
          success = build.status === 'succeeded'
          const current = latexSession(key)!
          const observation = current.sourceObservation
          const knownDifferent = observation !== session.sourceObservation && observation?.revision === current.revision && observation.hash !== build.sourceHash
          const canRecordSnapshot = current.revision === revision && !latexDirty(current) && !current.review.length && !knownDifferent
          patchLatexSession(key, owner.instanceId, { build, tools: build.tools, log: build.log,
            ...(build.sourceHash && canRecordSnapshot ? { sourceObservation: { hash: build.sourceHash, revision } } : {}),
            ...(build.pdf ? { pdf: build.pdf, pdfRevision: knownDifferent ? -1 : revision } : {}) })
          if (build.status === 'cancelled' || build.status === 'missing-tools') job.queued = false
        } catch (error) {
          if (!ownsBuild()) return false
          patchLatexSession(key, owner.instanceId, { error: error instanceof Error ? error.message : String(error) })
          success = false
        } finally {
          unsubscribe()
          if (ownsBuild()) patchLatexSession(key, owner.instanceId, { buildId: null })
        }
      } while (job.queued && isLatexSessionCurrent(key, owner.instanceId))
      return success
    } catch (error) {
      patchLatexSession(key, owner.instanceId, { error: error instanceof Error ? error.message : String(error) })
      return false
    }
  })()
  job.promise = promise
  builds.set(key, job)
  try { return await promise } finally { if (builds.get(key) === job) builds.delete(key) }
}

export async function abortLatexBuild(key: string): Promise<void> {
  const session = latexSession(key)
  const job = builds.get(key)
  if (job && job.instanceId === session?.instanceId) job.queued = false
  if (session?.buildId) await window.kunGui.latexAbortBuild({ ...latexTarget(session), buildId: session.buildId })
}

export async function exportLatex(key: string, format: 'pdf' | 'source'): Promise<void> {
  const owner = latexSession(key)
  if (!owner || owner.deleting || !await saveLatexSession(owner.workspaceRoot, owner.project.mainPath)) return
  if (!isLatexSessionCurrent(key, owner.instanceId)) return
  if (format === 'pdf' && !await buildLatex(key)) return
  const current = latexSession(key)
  if (!current || current.instanceId !== owner.instanceId) return
  if (format === 'pdf' && (current.pdfRevision !== current.revision || latexDirty(current) || current.review.length)) {
    patchLatexSession(key, owner.instanceId, { error: i18n.t('common:latexExportStale') })
    return
  }
  const result = await window.kunGui.latexExport({ ...latexTarget(current), format, sourceHash: current.pdf?.sourceHash })
  if (!result.ok) patchLatexSession(key, owner.instanceId, { error: result.message })
}
