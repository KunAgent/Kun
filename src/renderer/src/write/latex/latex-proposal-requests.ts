import { isLatexSessionCurrent, latexSession, patchLatexSession } from './latex-project-store'

export type LatexProposalRequest = {
  key: string
  instanceId: string
  id: string
  revision: number
  reviewRevision: number
}

export function beginLatexProposal(key: string): LatexProposalRequest | null {
  const session = latexSession(key)
  if (!session || session.deleting) return null
  const id = crypto.randomUUID()
  patchLatexSession(key, session.instanceId, { proposing: true, proposalIds: [...session.proposalIds, id] })
  return { key, instanceId: session.instanceId, id, revision: session.revision, reviewRevision: session.reviewRevision }
}

export function canStageLatexProposal(request: LatexProposalRequest): boolean {
  const session = latexSession(request.key)
  return !!session && session.instanceId === request.instanceId && session.proposalIds.includes(request.id) &&
    session.revision === request.revision && session.reviewRevision === request.reviewRevision && !session.review.length && !session.deleting
}

export function finishLatexProposal(request: LatexProposalRequest): void {
  if (!isLatexSessionCurrent(request.key, request.instanceId)) return
  patchLatexSession(request.key, request.instanceId, (session) => {
    const proposalIds = session.proposalIds.filter((id) => id !== request.id)
    return { proposalIds, proposing: proposalIds.length > 0 }
  })
}
