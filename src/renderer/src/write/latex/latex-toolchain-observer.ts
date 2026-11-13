import { isLatexSessionCurrent, latexSession, latexTarget, patchLatexSession } from './latex-project-store'

/** Keep the paper's status current even after the installation dialog is dismissed. */
export function observeLatexToolchain(key: string): () => void {
  const owner = latexSession(key)
  if (!owner) return () => {}
  let disposed = false
  const unsubscribe = window.kunGui.onLatexToolchainState((state) => {
    if (state.phase !== 'ready' || !isLatexSessionCurrent(key, owner.instanceId)) return
    const session = latexSession(key)!
    void window.kunGui.latexDetectTools(latexTarget(session)).then((result) => {
      const current = latexSession(key)
      if (disposed || !result.ok || !current || current.instanceId !== owner.instanceId || current.projectRevision !== session.projectRevision) return
      patchLatexSession(key, owner.instanceId, { tools: result.tools,
        ...(result.tools.latexmk && result.tools.engine && current.build?.status === 'missing-tools' ? { build: null } : {}) })
    }).catch(() => {})
  })
  return () => { disposed = true; unsubscribe() }
}
