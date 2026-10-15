import { useMemo } from 'react'
import type { CoreApprovalActionJson } from '../../agent/kun-contract-approval'
import { ToolDetailsContent } from './ToolDetailsContent'
import { approvalToolPresentation } from './approval-tool-presentation'

export function ApprovalDetails({ action }: { action?: CoreApprovalActionJson }) {
  const presentation = useMemo(() => approvalToolPresentation(action), [action])
  return presentation ? <div className="mt-2" data-testid="approval-tool-details">
    <ToolDetailsContent presentation={presentation} workspaceRoot={action?.workspace} approval />
  </div> : null
}
