import type { ApprovalChoice, ApprovalPermissionOption } from '@shared/approval-choice'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'

type Translate = (key: string, options?: Record<string, unknown>) => string
type Action = { label: string; decision: 'allow' | 'deny'; choice?: ApprovalChoice; scope?: string }

export function ApprovalActions({ options, submitting, onDecide, t }: {
  options?: ApprovalPermissionOption[]
  submitting: boolean
  onDecide: (decision: 'allow' | 'deny', choice?: ApprovalChoice) => void
  t: Translate
}) {
  const actions: Action[] = options?.length ? [
    ...options.map((option): Action => ({
      label: option.name || t(`approvalOption_${option.kind}`),
      decision: option.kind.startsWith('allow') ? 'allow' : 'deny',
      choice: { optionId: option.optionId },
      scope: t(`approvalOption_${option.kind}`)
    })),
    { label: t('approvalCancelRequest'), decision: 'deny', choice: { cancelled: true } }
  ] : [
    { label: t('approvalDeny'), decision: 'deny' },
    { label: t('approvalAllow'), decision: 'allow' }
  ]
  return <div className="flex max-h-[30dvh] min-w-0 flex-wrap items-center gap-2 overflow-y-auto" data-testid="approval-actions">
    {actions.map((action, index) => <button key={index} type="button" disabled={submitting}
      title={action.scope}
      className={`max-w-full whitespace-normal break-words rounded-lg border px-3 py-1.5 text-left text-[13px] font-medium disabled:cursor-wait disabled:opacity-60 ${action.decision === 'allow' ? 'border-accent bg-accent text-white hover:bg-accent/90' : 'border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover'}`}
      onClick={(event) => runTrustedUserActivation(event, () => onDecide(action.decision, action.choice))}>
      <span>{action.label}</span>
      {action.scope && action.scope !== action.label ? <span className="ml-1.5 text-[11px] opacity-75">{action.scope}</span> : null}
    </button>)}
    {submitting ? <span role="status" className="text-[12px] text-ds-muted">{t('approvalSubmitting')}</span> : null}
  </div>
}
