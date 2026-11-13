import { buildLatex } from './latex-build-controller'
import { editLatexBuffer, isLatexSessionCurrent, latexSession, latexTarget, loadLatexFixContext, patchLatex, patchLatexSession, saveLatexSession } from './latex-project-store'
import { beginLatexProposal, canStageLatexProposal, finishLatexProposal } from './latex-proposal-requests'
import i18n from '../../i18n'

export async function proposeLatexRevision(key: string, instruction: string, providerId?: string, model?: string): Promise<void> {
  const session = latexSession(key)
  if (!session || session.deleting || session.proposing || session.review.length) return
  const request = beginLatexProposal(key)!
  patchLatexSession(key, session.instanceId, { error: null })
  try {
    const files = await loadLatexFixContext(key)
    if (!canStageLatexProposal(request)) return
    const result = await window.kunGui.latexProposeFix({ ...latexTarget(session), instruction, providerId, model,
      diagnostics: session.build?.diagnostics ?? [], files })
    if (!isLatexSessionCurrent(key, session.instanceId)) return
    if (!result.ok) throw new Error(result.message)
    if (!canStageLatexProposal(request)) {
      patchLatexSession(key, session.instanceId, { error: i18n.t('common:latexProposalStale') })
      return
    }
    if (result.edits.some((edit) => latexSession(key)?.buffers[edit.file]?.content !== edit.before)) {
      throw new Error(i18n.t('common:latexProposalStale'))
    }
    patchLatexSession(key, session.instanceId, { review: result.edits, reviewOrigin: 'ai', reviewAccepted: false })
  } catch (error) { patchLatexSession(key, session.instanceId, { error: error instanceof Error ? error.message : String(error) }) }
  finally { finishLatexProposal(request) }
}

export async function resolveLatexRevision(key: string, decision: 'accept' | 'reject', file?: string): Promise<void> {
  const session = latexSession(key)
  if (!session || session.deleting) return
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
