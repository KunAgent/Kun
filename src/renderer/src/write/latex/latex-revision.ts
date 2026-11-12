import { buildLatex } from './latex-build-controller'
import { editLatexBuffer, latexSession, latexTarget, loadLatexFixContext, patchLatex, saveLatexSession } from './latex-project-store'

export async function proposeLatexRevision(key: string, instruction: string, providerId?: string, model?: string): Promise<void> {
  const session = latexSession(key)
  if (!session || session.proposing || session.review.length) return
  patchLatex(key, { proposing: true, error: null })
  try {
    const files = await loadLatexFixContext(key)
    const result = await window.kunGui.latexProposeFix({ ...latexTarget(session), instruction, providerId, model,
      diagnostics: session.build?.diagnostics ?? [], files })
    if (!result.ok) throw new Error(result.message)
    patchLatex(key, { review: result.edits, reviewOrigin: 'ai', reviewAccepted: false })
  } catch (error) { patchLatex(key, { error: error instanceof Error ? error.message : String(error) }) }
  finally { patchLatex(key, { proposing: false }) }
}

export async function resolveLatexRevision(key: string, decision: 'accept' | 'reject', file?: string): Promise<void> {
  const session = latexSession(key)
  if (!session) return
  const edits = session.review.filter((edit) => !file || edit.file === file)
  for (const edit of decision === 'accept' ? edits : []) {
    const buffer = latexSession(key)?.buffers[edit.file]
    if (!buffer || buffer.truncated || buffer.content !== edit.before) { patchLatex(key, { error: `Source changed during review: ${edit.file}` }); return }
  }
  if (decision === 'accept') for (const edit of edits) editLatexBuffer(key, edit.file, edit.after)
  patchLatex(key, { review: session.review.filter((edit) => !edits.includes(edit)), reviewAccepted: session.reviewAccepted || decision === 'accept' })
  const current = latexSession(key)!
  if (!current.review.length) {
    if (decision === 'reject' && current.reviewOrigin === 'ai' && !current.reviewAccepted) return
    if (await saveLatexSession(current.workspaceRoot, current.project.mainPath) && current.reviewAccepted) await buildLatex(key)
  }
}
