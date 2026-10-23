import { useMemo } from 'react'
import type { ToolPresentation } from '@shared/tool-presentation'
import type { CoreApprovalActionJson } from '../../agent/kun-contract-approval'
import { ToolDetailsContent } from './ToolDetailsContent'
import { approvalToolPresentation } from './approval-tool-presentation'

/** What the approval card's preview box already shows above the details. */
export type ApprovalDetailsPreviewed = 'command' | 'diffs'

/*
 * Inside the card's preview box the details drop what the box already shows:
 * its truncation note always, and the command or the diff when the box is a
 * terminal or diff preview. The input payload and file links stay.
 */
function embeddedPresentation(presentation: ToolPresentation, previewed: ApprovalDetailsPreviewed | undefined): ToolPresentation {
  const { truncated: _truncated, command, diffs, ...rest } = presentation
  return {
    ...rest,
    ...(command !== undefined && previewed !== 'command' ? { command } : {}),
    ...(diffs !== undefined && previewed !== 'diffs' ? { diffs } : {})
  }
}

/**
 * Tool details (input, paths, diffs) of an approval. `embedded` places them in
 * the approval card's preview box, below a hairline, instead of under a card.
 */
export function ApprovalDetails({ action, embedded = false, previewed }: {
  action?: CoreApprovalActionJson
  embedded?: boolean
  previewed?: ApprovalDetailsPreviewed
}) {
  const presentation = useMemo(() => {
    const value = approvalToolPresentation(action)
    return value && embedded ? embeddedPresentation(value, previewed) : value
  }, [action, embedded, previewed])
  return presentation ? <div
    className={embedded ? 'border-t border-ds-border-muted px-3 py-2.5 text-[12.5px]' : 'mt-2'}
    data-testid="approval-tool-details"
  >
    <ToolDetailsContent presentation={presentation} workspaceRoot={action?.workspace} approval />
  </div> : null
}
