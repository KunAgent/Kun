import { Pin } from 'lucide-react'
import type { ReactElement } from 'react'
import type { CoreApprovalActionJson } from '../../agent/kun-contract-runtime'

const MEMORY_TOOLS = new Set(['memory_create', 'memory_update', 'memory_delete'])

export type MemoryApprovalDetails = {
  isDirective: boolean
  content: string | null
}

/** Extracts the user-reviewable memory payload from a bounded approval action. */
export function memoryApprovalDetails(
  toolName: string | undefined,
  action: CoreApprovalActionJson | undefined
): MemoryApprovalDetails | null {
  if (!toolName || !MEMORY_TOOLS.has(toolName)) return null
  const args = action?.arguments
  const content = args && typeof args.content === 'string' ? args.content.trim() : ''
  return {
    isDirective: args?.authority === 'directive',
    content: content ? content : null
  }
}

/**
 * Directive banner + full memory body for memory tool approvals. The content
 * is rendered un-truncated because this card is the user's only review
 * opportunity before the record is written.
 */
export function MemoryApprovalHint({
  toolName,
  action,
  t
}: {
  toolName: string | undefined
  action: CoreApprovalActionJson | undefined
  t: (key: string) => string
}): ReactElement | null {
  const details = memoryApprovalDetails(toolName, action)
  if (!details) return null
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {details.isDirective ? (
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
          <Pin className="h-3.5 w-3.5" strokeWidth={2} />
          {t('approvalMemoryDirectiveHint')}
        </div>
      ) : null}
      {details.content ? (
        <div className="whitespace-pre-wrap break-words rounded-[10px] border border-ds-border-muted bg-ds-main/40 px-3 py-2.5 font-mono text-[12px] leading-5 text-ds-ink [overflow-wrap:anywhere]">
          {details.content}
        </div>
      ) : null}
    </div>
  )
}
