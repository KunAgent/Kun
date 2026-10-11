import { useEffect, useRef, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { settingsButtonClass } from '../settings-button'

type T = (key: string, options?: Record<string, unknown>) => string

/** Removing an Agent you added is the only place the Agent Center uses red. */
export function AgentDeleteConfirm({ name, onCancel, onConfirm, t }: {
  name: string
  onCancel: () => void
  onConfirm: () => void
  t: T
}): ReactElement {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus() }, [])
  const content = <div className="ds-settings-surface fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4"
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}>
    <div role="alertdialog" aria-modal="true" aria-labelledby="agent-delete-title" aria-describedby="agent-delete-body" data-agent-delete-confirm
      className="w-full max-w-sm rounded-2xl border border-ds-border bg-ds-card p-5 shadow-2xl">
      <h2 id="agent-delete-title" className="text-[15px] font-semibold text-ds-ink">{t('agentCenter.delete.title', { name })}</h2>
      <p id="agent-delete-body" className="mt-2 text-[12.5px] leading-[1.55] text-ds-muted">{t('agentCenter.delete.body')}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onCancel} className={settingsButtonClass()}>{t('agentCenter.cancel')}</button>
        <button type="button" onClick={onConfirm} data-agent-delete-confirm-yes className={settingsButtonClass({ variant: 'danger' })}>{t('agentCenter.delete.confirm')}</button>
      </div>
    </div>
  </div>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
