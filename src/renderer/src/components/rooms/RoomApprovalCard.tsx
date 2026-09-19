import { useState } from 'react'
import { ShieldCheck, Terminal, Folder, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomApprovalView } from '@shared/room-approval-presentation'
import { roomApprovalPresentation } from '@shared/room-approval-presentation'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import './rooms-approval.css'

export function RoomApprovalCard({ approval, onUpdated }: { approval: RoomApprovalView; onUpdated: () => Promise<void> }) {
  const { t } = useTranslation('common')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const data = roomApprovalPresentation(approval)
  const decide = async (decision: 'allow' | 'deny') => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await window.kunGui.resolveKunApproval({ approvalId: approval.id, decision, source: 'user', presentation: 'room' })
      if (result.confirmed && !result.response.ok) throw new Error(result.response.body)
      await onUpdated()
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <section className="room-approval-card" aria-label={t('roomApprovalTitle')}>
    <header><span className="room-approval-icon"><ShieldCheck size={18} /></span><div><strong>{t('roomApprovalTitle')}</strong><small>{t('roomApproval_' + data.kind)} · {data.tool}</small></div></header>
    <pre className="room-approval-command"><Terminal size={14} aria-hidden /><code>{data.content}</code></pre>
    {data.workspace ? <p className="room-approval-workspace"><Folder size={13} /><span title={data.workspace}>{data.workspace}</span></p> : null}
    <footer><details><summary>{t('roomApprovalDetails')}<ChevronDown size={12} /></summary><p>{data.details}</p></details>
      <button type="button" disabled={busy} onClick={(event) => runTrustedUserActivation(event, () => void decide('deny'))}>{t('roomsDeny')}</button>
      <button type="button" className="room-approval-allow" disabled={busy} onClick={(event) => runTrustedUserActivation(event, () => void decide('allow'))}>{t(busy ? 'roomsLoading' : 'roomApprovalReviewAllow')}</button></footer>
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
  </section>
}
