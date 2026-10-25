import type { ApprovalChoice, ApprovalPermissionOption } from '@shared/approval-choice'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'

type Translate = (key: string, options?: Record<string, unknown>) => string
type Action = { label: string; decision: 'allow' | 'deny'; choice?: ApprovalChoice; scope?: string }

/**
 * Decision list of a pending approval. Runtime-offered scopes keep their own
 * order and are followed by "cancel request"; a plain request offers deny and
 * allow. `rows` lays them out as the numbered rows the interrupt card uses
 * (allow first), `buttons` as the compact button strip mobile cards use.
 */
export function approvalActionList(
  options: ApprovalPermissionOption[] | undefined,
  t: Translate,
  allowLabel: string | undefined,
  layout: 'buttons' | 'rows'
): Action[] {
  if (options?.length) {
    return [
      ...options.map((option): Action => ({
        label: option.name || t(`approvalOption_${option.kind}`),
        decision: option.kind.startsWith('allow') ? 'allow' : 'deny',
        choice: { optionId: option.optionId },
        scope: t(`approvalOption_${option.kind}`)
      })),
      { label: t('approvalCancelRequest'), decision: 'deny', choice: { cancelled: true } }
    ]
  }
  const allow: Action = { label: allowLabel ?? t('approvalAllow'), decision: 'allow' }
  const deny: Action = { label: t('approvalDeny'), decision: 'deny' }
  return layout === 'rows' ? [allow, deny] : [deny, allow]
}

export function ApprovalActions({ options, submitting, onDecide, t, allowLabel, layout = 'buttons' }: {
  options?: ApprovalPermissionOption[]
  /** Verb for the primary button when the runtime offers plain allow/deny (e.g. "Send"). */
  allowLabel?: string
  submitting: boolean
  onDecide: (decision: 'allow' | 'deny', choice?: ApprovalChoice) => void
  t: Translate
  layout?: 'buttons' | 'rows'
}) {
  const actions = approvalActionList(options, t, allowLabel, layout)
  if (layout === 'rows') {
    return <div className="flex max-h-[40dvh] min-w-0 flex-col gap-0.5 overflow-y-auto" data-testid="approval-actions" data-layout="rows">
      {actions.map((action, index) => <button key={index} type="button" disabled={submitting}
        title={action.scope}
        data-approval-action-row={index + 1}
        className="flex w-full min-w-0 items-start gap-2 rounded-[10px] px-2.5 py-[7px] text-left text-[14px] leading-[21px] text-ds-ink transition-colors duration-100 hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/45 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
        onClick={(event) => runTrustedUserActivation(event, () => onDecide(action.decision, action.choice))}>
        <span className="w-[18px] shrink-0 font-semibold tabular-nums text-ds-faint">{index + 1}.</span>
        <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
          <span className="font-medium">{action.label}</span>
          {action.scope && action.scope !== action.label ? <span className="ml-2 text-[13px] text-ds-muted">{action.scope}</span> : null}
        </span>
      </button>)}
      {submitting ? <span role="status" className="px-2.5 pt-1 text-[12px] text-ds-muted">{t('approvalSubmitting')}</span> : null}
    </div>
  }
  return <div className="flex max-h-[30dvh] min-w-0 flex-wrap items-center gap-2 overflow-y-auto" data-testid="approval-actions">
    {actions.map((action, index) => <button key={index} type="button" disabled={submitting}
      title={action.scope}
      className={`max-w-full whitespace-normal break-words rounded-lg border px-3 py-1.5 text-left text-[13px] font-medium disabled:cursor-wait disabled:opacity-60 ${action.decision === 'allow' ? 'border-accent bg-accent text-white hover:brightness-110' : 'border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover'}`}
      onClick={(event) => runTrustedUserActivation(event, () => onDecide(action.decision, action.choice))}>
      <span>{action.label}</span>
      {action.scope && action.scope !== action.label ? <span className="ml-1.5 text-[11px] opacity-75">{action.scope}</span> : null}
    </button>)}
    {submitting ? <span role="status" className="text-[12px] text-ds-muted">{t('approvalSubmitting')}</span> : null}
  </div>
}
