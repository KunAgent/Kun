import { useEffect, useMemo, useRef, type RefObject } from 'react'
import type { ChatBlock } from '../../agent/types'
import type { ComposerUserInputController } from './use-composer-user-input'

export type ComposerApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

/**
 * The request that currently takes the composer shell's place. The shell and
 * its toolbar stay mounted (hidden + inert) underneath so the draft,
 * attachments and editor state survive the interruption.
 */
export type ComposerInterrupt =
  | { kind: 'approval'; approvals: ComposerApprovalBlock[] }
  | { kind: 'user-input'; controller: ComposerUserInputController }

/**
 * Pending approvals win (the panel pages among them); otherwise the live
 * ask-user request. `approvals` is already gated by
 * listPendingComposerApprovals (main-thread composers, only while busy).
 */
export function resolveComposerInterrupt(
  approvals: readonly ComposerApprovalBlock[] | null | undefined,
  userInput: ComposerUserInputController
): ComposerInterrupt | null {
  if (approvals && approvals.length > 0) return { kind: 'approval', approvals: [...approvals] }
  if (userInput.active) return { kind: 'user-input', controller: userInput }
  return null
}

/**
 * Resolves the active interrupt and hands the caret back to the editor when
 * the card goes away, unless the user has moved focus somewhere else.
 */
export function useComposerInterrupt({
  pendingApprovals,
  userInput,
  focusComposer,
  composerRootRef
}: {
  pendingApprovals: readonly ComposerApprovalBlock[]
  userInput: ComposerUserInputController
  focusComposer: () => void
  composerRootRef: RefObject<HTMLElement | null>
}): ComposerInterrupt | null {
  const interrupt = useMemo(
    () => resolveComposerInterrupt(pendingApprovals, userInput),
    [pendingApprovals, userInput]
  )
  const active = interrupt !== null
  const wasActiveRef = useRef(active)
  useEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = active
    if (!wasActive || active || typeof document === 'undefined') return
    const current = document.activeElement
    const root = composerRootRef.current
    if (!current || current === document.body || Boolean(root?.contains(current))) focusComposer()
  }, [active, composerRootRef, focusComposer])
  return interrupt
}
