import type { ReactElement } from 'react'
import type { CoreApprovalActionJson } from '../../agent/kun-contract-approval'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type ApprovalEmail = {
  from?: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []

/** Reads the Gmail send envelope; anything else (or a truncated envelope) falls back to the plain summary. */
export function approvalEmail(action: CoreApprovalActionJson | undefined): ApprovalEmail | null {
  if (action?.toolName !== 'gmail_send' || action.kind !== 'external-effect') return null
  const args = action.arguments ?? {}
  const to = strings(args.to)
  if (!to.length || typeof args.body !== 'string' || args.__truncated__ === true) return null
  return {
    from: typeof args.from === 'string' ? args.from : undefined,
    to,
    cc: strings(args.cc),
    bcc: strings(args.bcc),
    subject: typeof args.subject === 'string' ? args.subject : '',
    body: args.body
  }
}

/** The exact message the user is approving, laid out like a mail header instead of a text dump. */
export function ApprovalEmailPreview({ email, t, compact = false }: {
  email: ApprovalEmail
  t: Translate
  compact?: boolean
}): ReactElement {
  const rows: Array<[string, string]> = [
    ...(email.from ? [[t('approvalEmailFrom'), email.from] as [string, string]] : []),
    [t('approvalEmailTo'), email.to.join(', ')],
    ...(email.cc.length ? [[t('approvalEmailCc'), email.cc.join(', ')] as [string, string]] : []),
    ...(email.bcc.length ? [[t('approvalEmailBcc'), email.bcc.join(', ')] as [string, string]] : [])
  ]
  return (
    <div className="overflow-hidden rounded-[12px] border border-ds-border-muted" data-testid="approval-email-preview">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3.5 pt-3 text-[12.5px] leading-5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ds-faint">{label}</dt>
            <dd className="min-w-0 break-words text-ds-ink [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mx-3.5 mt-2.5 border-t border-ds-border-muted pb-1 pt-2.5">
        <p className="break-words text-[14px] font-semibold leading-5 text-ds-ink [overflow-wrap:anywhere]">
          {email.subject || <span className="font-normal text-ds-faint">{t('approvalEmailNoSubject')}</span>}
        </p>
      </div>
      <div
        tabIndex={0}
        className={`overflow-y-auto whitespace-pre-wrap break-words px-3.5 pb-3 pt-1 text-[13px] leading-[1.6] text-ds-ink [overflow-wrap:anywhere] ${
          compact ? 'max-h-32' : 'max-h-56'
        }`}
      >
        {email.body}
      </div>
    </div>
  )
}
