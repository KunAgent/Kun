import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function MemoryDestructiveConfirmation({ kind, memoryId, busy, onCancel, onConfirm }: {
  kind: 'forget' | 'erase'; memoryId: string; busy: boolean; onCancel: () => void; onConfirm: () => void
}) {
  const { t } = useTranslation('common')
  const [typed, setTyped] = useState('')
  return <div className="memory-confirmation" role="alertdialog" aria-label={t(kind === 'erase' ? 'memoryErase' : 'agentsForget')}>
    <strong>{t(kind === 'erase' ? 'memoryErase' : 'agentsForget')}</strong>
    <p>{t(kind === 'erase' ? 'memoryEraseWarning' : 'memoryForgetWarning')}</p>
    {kind === 'erase' ? <label>{t('memoryEraseTypeId', { id: memoryId })}
      <input aria-label={t('memoryEraseConfirmId')} value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
    </label> : null}
    <div className="agent-memory-actions">
      <button type="button" disabled={busy} onClick={onCancel}>{t('roomsCancel')}</button>
      <button type="button" disabled={busy || (kind === 'erase' && typed !== memoryId)} onClick={onConfirm}>{t(kind === 'erase' ? 'memoryEraseConfirm' : 'memoryForgetConfirm')}</button>
    </div>
  </div>
}
