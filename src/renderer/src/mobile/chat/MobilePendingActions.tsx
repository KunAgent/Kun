import { useTranslation } from 'react-i18next'
import type { ChatBlock } from '../../agent/types'
import { useComposerUserInput } from '../../components/chat/use-composer-user-input'
import { FloatingComposerUserInputPanel } from '../../components/chat/FloatingComposerUserInputPanel'
import type { ChatState } from '../../store/chat-store-types'
import './mobile-pending-actions.css'

type PendingApproval = Extract<ChatBlock, { kind: 'approval' }>
type PendingInput = Extract<ChatBlock, { kind: 'user_input' }>

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
  const input = lastMatching(blocks, (block): block is PendingInput =>
    block.kind === 'user_input' && block.status === 'pending' && block.live !== false)
  const controller = useComposerUserInput(input, resolveUserInput)
  if (input) return <FloatingComposerUserInputPanel controller={controller} t={t} variant="compact" />
  if (!approval) return null
  const disabled = approval.status === 'submitting'
  return <section className="kun-mobile-approval" aria-label={t('approvalRequired')}>
    <strong>{approval.toolName || t('approvalRequired')}</strong>
    <p>{approval.summary}</p>
    <div><button type="button" disabled={disabled} onClick={() => void resolveApproval(approval.id, 'deny')}>{t('deny')}</button>
      <button type="button" disabled={disabled} onClick={() => void resolveApproval(approval.id, 'allow')}>{t('allow')}</button></div>
  </section>
}
