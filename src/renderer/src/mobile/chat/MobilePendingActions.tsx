import { useTranslation } from 'react-i18next'
import type { ChatBlock } from '../../agent/types'
import { MobileUserInput } from './MobileUserInput'
import { selectLivePendingUserInput } from '../../components/chat/user-input-panel-logic'
import type { ChatState } from '../../store/chat-store-types'
import './mobile-pending-actions.css'

type PendingApproval = Extract<ChatBlock, { kind: 'approval' }>

function lastMatching<T extends ChatBlock>(
  blocks: ChatBlock[], predicate: (block: ChatBlock) => block is T
): T | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (predicate(block)) return block
  }
  return null
}

export function MobilePendingActions({ blocks, resolveApproval, resolveUserInput }: {
  blocks: ChatBlock[]
  resolveApproval: ChatState['resolveApproval']
  resolveUserInput: ChatState['resolveUserInput']
}) {
  const { t } = useTranslation('common')
  const approval = lastMatching(blocks, (block): block is PendingApproval =>
    block.kind === 'approval' && (block.status === 'pending' || block.status === 'submitting'))
  const input = selectLivePendingUserInput(blocks)
  if (input) return <MobileUserInput input={input} resolve={resolveUserInput} />
  if (!approval) return null
  const disabled = approval.status === 'submitting'
  return <section className="kun-mobile-approval" aria-label={t('approvalTitle')}>
    <strong>{approval.toolName || t('approvalTitle')}</strong>
    <p>{approval.summary}</p>
    <div><button type="button" disabled={disabled} onClick={() => void resolveApproval(approval.id, 'deny')}>{t('approvalDeny')}</button>
      <button type="button" disabled={disabled} onClick={() => void resolveApproval(approval.id, 'allow')}>{t('approvalAllow')}</button></div>
  </section>
}
