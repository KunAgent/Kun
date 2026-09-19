import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'

export function RoomPollCreator({ roomId, replyToMessageId, onClose }: { roomId: string; replyToMessageId?: string; onClose: () => void }) {
  const { t } = useTranslation('common')
  const [question, setQuestion] = useState(''), [options, setOptions] = useState(['', ''])
  const [multiple, setMultiple] = useState(false), [closesAt, setClosesAt] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef({ fingerprint: '', id: '' })
  const create = async () => {
    if (busy) return
    const content = { question: question.trim(), options: options.map((value) => value.trim()), multiple,
      ...(closesAt ? { closesAt: new Date(closesAt).toISOString() } : {}), replyToMessageId }
    const fingerprint = JSON.stringify(content)
    if (pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, id: roomRequestId() }
    setBusy(true); setError('')
    try { await roomsRequest(`${roomPath(roomId)}/polls`, 'POST', { ...content, clientRequestId: pending.current.id }); onClose() }
    catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <div className="rooms-poll-create" role="group" aria-label={t('roomsCreatePoll')}
    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation() } }}>
    <div className="rooms-poll-create-header"><strong>{t('roomsCreatePoll')}</strong><button type="button" aria-label={t('roomsCancel')} onClick={onClose}><X size={14} /></button></div>
    <p className="rooms-interaction-note">{t('roomsPollPresentationOnly')}</p>
    <input aria-label={t('roomsPollQuestion')} placeholder={t('roomsPollQuestion')} maxLength={300} value={question} disabled={busy}
      onChange={(event) => setQuestion(event.target.value)} />
    {options.map((value, index) => <div className="rooms-poll-option-edit" key={index}>
      <input aria-label={t('roomsPollOption', { index: index + 1 })} placeholder={t('roomsPollOption', { index: index + 1 })} value={value} maxLength={200}
        disabled={busy} onChange={(event) => setOptions((all) => all.map((text, position) => position === index ? event.target.value : text))} />
      {options.length > 2 ? <button type="button" disabled={busy} aria-label={t('roomsPollRemoveOption')} onClick={() => setOptions((all) => all.filter((_, position) => position !== index))}><X size={14} /></button> : null}
    </div>)}
    {options.length < 10 ? <button type="button" className="rooms-poll-inline-action" disabled={busy} onClick={() => setOptions((all) => [...all, ''])}><Plus size={14} />{t('roomsPollAddOption')}</button> : null}
    <label className="rooms-poll-check"><input type="checkbox" checked={multiple} disabled={busy} onChange={(event) => setMultiple(event.target.checked)} />{t('roomsPollMultiple')}</label>
    <label>{t('roomsPollDeadline')}<input type="datetime-local" aria-label={t('roomsPollDeadline')} value={closesAt} disabled={busy} onChange={(event) => setClosesAt(event.target.value)} /></label>
    <button type="button" className="rooms-poll-primary" disabled={busy || !question.trim() || options.some((option) => !option.trim()) || new Set(options.map((value) => value.trim())).size !== options.length}
      onClick={() => void create()}>{t(busy ? 'roomsSending' : 'roomsPollPublish')}</button>
    {error ? <p role="alert" className="rooms-interaction-error">{error}</p> : null}
  </div>
}
