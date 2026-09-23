import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room } from '@shared/rooms-api'
import { useDirectChat } from '../../components/rooms/RoomDirectChat'
import { RoomApprovalCard } from '../../components/rooms/RoomApprovalCard'
import { MobileRoomUserInput } from './MobileRoomUserInput'
import { MobileSheet } from '../sheets/MobileSheet'

/** Private-chat gates must be reachable without opening the desktop run inspector. */
export function MobileRoomPendingActions({ room, onUpdated }: { room: Room; onUpdated: () => Promise<void> }) {
  const { t } = useTranslation('common')
  const direct = useDirectChat(room, onUpdated)
  const [approvalsOpen, setApprovalsOpen] = useState(false)
  const inputs = direct.data?.userInputs ?? []
  const approvals = direct.data?.approvals ?? []
  if (!inputs.length && !approvals.length && !direct.error) return null
  const refresh = async () => { direct.refresh(); await onUpdated() }
  return <div className="kun-mobile-room-gates">
    {inputs.slice(0, 1).map((input) => <MobileRoomUserInput key={input.id} input={input} onUpdated={refresh} />)}
    {approvals.length ? <button type="button" className="kun-mobile-input-trigger" onClick={() => setApprovalsOpen(true)}>
      {t('approvalRequired')} · {approvals.length}
    </button> : null}
    {direct.error ? <p role="alert">{direct.error}</p> : null}
    <MobileSheet open={approvalsOpen && approvals.length > 0} title={t('approvalRequired')}
      closeLabel={t('mobileInputCollapse')} onClose={() => setApprovalsOpen(false)}>
      {approvals.map((approval) => <RoomApprovalCard key={approval.id} approval={approval} onUpdated={refresh} />)}
    </MobileSheet>
  </div>
}
