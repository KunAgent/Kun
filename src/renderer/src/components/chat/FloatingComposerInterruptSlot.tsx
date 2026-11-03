import type { ReactElement } from 'react'
import { FloatingComposerApprovalPanel } from './FloatingComposerApprovalPanel'
import { FloatingComposerUserInputPanel } from './FloatingComposerUserInputPanel'
import type { ComposerInterrupt } from './use-composer-interrupt'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Picks the card that takes the composer shell's place. Each card renders
 * its own root (InterruptCard from ./interrupt-card for the redesigned
 * cards) with the shell's width, radius and border; the slot adds no chrome.
 */
export function FloatingComposerInterruptSlot({
  interrupt,
  compact,
  t
}: {
  interrupt: ComposerInterrupt
  compact: boolean
  t: Translate
}): ReactElement {
  const variant = compact ? 'compact' : 'main'
  if (interrupt.kind === 'approval') {
    return <FloatingComposerApprovalPanel approvals={interrupt.approvals} t={t} variant={variant} />
  }
  return <FloatingComposerUserInputPanel controller={interrupt.controller} t={t} variant={variant} />
}
