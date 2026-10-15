import type { ReactElement } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { ApprovalChoice, ApprovalPermissionOption } from '@shared/approval-choice'
import type { CoreApprovalActionJson } from '../../agent/kun-contract-approval'
import { GmailLogo } from '../rooms/gmail-brand'
import { approvalEmail, type ApprovalEmail } from './ApprovalEmailPreview'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type ApprovalKind =
  | { kind: 'email'; email: ApprovalEmail }
  | { kind: 'command'; command: string; cwd?: string }
  | { kind: 'other' }

export function approvalKind(action: CoreApprovalActionJson | undefined): ApprovalKind {
  const email = approvalEmail(action)
  if (email) return { kind: 'email', email }
  const raw = action?.arguments ?? {}
  const command = action?.targets?.find((target) => target.kind === 'command')?.value ??
    (action?.kind === 'command' && typeof raw.command === 'string' ? raw.command : undefined)
  return command ? { kind: 'command', command, cwd: action?.cwd ?? action?.workspace } : { kind: 'other' }
}

export function approvalQuestion(kind: ApprovalKind, toolName: string | undefined, t: Translate): string {
  if (kind.kind === 'email') return t('approvalEmailQuestion')
  if (kind.kind === 'command') return t('approvalCommandQuestion')
  return toolName ? t('approvalToolQuestion', { name: toolName }) : t('approvalTitle')
}

export type ApprovalOptionRow = {
  label: string
  decision: 'allow' | 'deny'
  choice?: ApprovalChoice
}

/**
 * Numbered decision rows. Runtime-offered scopes (allow always, ...) come
 * first in their own order; the final "deny" row is rendered separately so
 * it can carry an optional note for the agent.
 */
export function approvalOptionRows(kind: ApprovalKind, options: ApprovalPermissionOption[] | undefined, t: Translate): {
  rows: ApprovalOptionRow[]
  deny: ApprovalOptionRow
} {
  const denyLabel = kind.kind === 'email' ? t('approvalEmailDontSend') : t('approvalDeny')
  if (!options?.length) {
    const allowLabel = kind.kind === 'email' ? t('approvalEmailSend')
      : kind.kind === 'command' ? t('approvalCommandRun') : t('approvalAllow')
    return { rows: [{ label: allowLabel, decision: 'allow' }], deny: { label: denyLabel, decision: 'deny' } }
  }
  const rejectOnce = options.find((option) => option.kind === 'reject_once')
  const rows = options
    .filter((option) => option !== rejectOnce)
    .map((option): ApprovalOptionRow => ({
      label: option.name || t(`approvalOption_${option.kind}`),
      decision: option.kind.startsWith('allow') ? 'allow' : 'deny',
      choice: { optionId: option.optionId }
    }))
  return {
    rows,
    deny: { label: denyLabel, decision: 'deny', choice: rejectOnce ? { optionId: rejectOnce.optionId } : { cancelled: true } }
  }
}

/** Tile that tells the three request families apart at a glance. */
export function ApprovalKindIcon({ kind, size = 'md' }: { kind: ApprovalKind['kind']; size?: 'sm' | 'md' }): ReactElement {
  const box = size === 'sm' ? 'h-7 w-7 rounded-[9px]' : 'h-[34px] w-[34px] rounded-[10px]'
  if (kind === 'email') {
    return <span className={`flex shrink-0 items-center justify-center bg-ds-subtle ${box}`}>
      <GmailLogo size={size === 'sm' ? 16 : 20} />
    </span>
  }
  if (kind === 'command') {
    return <span className={`bg-[linear-gradient(180deg,#2a2e37_0%,#1b1e25_100%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_1px_2px_rgba(20,24,33,0.25)] flex shrink-0 items-center justify-center ${box}`}>
      <svg width={size === 'sm' ? 16 : 20} height={size === 'sm' ? 16 : 20} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5 6.5 8.5 10 5 13.5" stroke="#7ee2a8" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="10.5" y="12.4" width="5" height="2" rx="1" fill="#e6e8ec" />
      </svg>
    </span>
  }
  return <span className={`flex shrink-0 items-center justify-center bg-amber-500/10 text-amber-600 dark:text-amber-300 ${box}`}>
    <ShieldAlert className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={2} />
  </span>
}
