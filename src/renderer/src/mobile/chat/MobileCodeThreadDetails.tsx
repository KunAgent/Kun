import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { formatRuntimeError } from '../../lib/format-runtime-error'
import { MobileSheet } from '../sheets/MobileSheet'
import './mobile-code-options.css'

function projectName(root: string): string {
  return root.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || root
}

/**
 * Compact per-thread details for the Remote mobile shell: the desktop
 * inspector is not reachable on a phone, so rename/archive/copy-id live in a
 * sheet bound to the requested thread id.
 */
export function MobileCodeThreadDetails({ threadId, open, onClose, onArchived }: {
  threadId: string
  open: boolean
  onClose: () => void
  onArchived: () => void
}) {
  const { t } = useTranslation('common')
  const state = useChatStore(useShallow((value) => ({
    thread: value.threads.find((item) => item.id === threadId),
    composerMode: value.composerMode,
    composerModel: value.composerModel,
    rename: value.renameThread,
    archive: value.archiveThread
  })))
  const thread = state.thread
  const [title, setTitle] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const editing = title !== null
  const modeLabel = state.composerMode === 'plan' ? t('planMode')
    : state.composerMode === 'agent' ? t('agentMode') : t('autoLabel')

  // A closed sheet must not keep an unsaved rename draft or a stale error.
  useEffect(() => {
    if (open) return
    setTitle(null)
    setError('')
  }, [open])

  const saveTitle = async (): Promise<void> => {
    const next = (title ?? '').trim()
    setBusy(true)
    try {
      if (next && next !== thread?.title) await state.rename(threadId, next)
      setTitle(null)
      setError('')
    } catch (cause) {
      setError(formatRuntimeError(cause))
    } finally { setBusy(false) }
  }
  const copySessionId = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(threadId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable in insecure contexts */ }
  }
  const toggleArchive = async (): Promise<void> => {
    const archiving = thread?.archived !== true
    setBusy(true)
    try {
      await state.archive(threadId, archiving)
      setError('')
      if (archiving) onArchived()
    } catch (cause) {
      setError(formatRuntimeError(cause))
    } finally { setBusy(false) }
  }

  return <MobileSheet open={open} title={t('mobileThreadDetails')} closeLabel={t('close')} onClose={onClose}>
    <div className="kun-mobile-code-options">
      {error ? <p role="alert">{error}</p> : null}
      <label>{t('sidebarThreadRename')}
        <input type="text" value={title ?? thread?.title ?? ''}
          placeholder={t('sidebarThreadRenamePrompt')}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={() => { if (title === null) setTitle(thread?.title ?? '') }} />
      </label>
      {editing ? <div>
        <button type="button" disabled={busy} onClick={() => void saveTitle()}>{t('mobileSave')}</button>
        <button type="button" disabled={busy} onClick={() => setTitle(null)}>{t('cancel')}</button>
      </div> : null}
      <dl>
        <dt>{t('mobileDetailsProject')}</dt><dd>{thread?.workspace ? projectName(thread.workspace) : '—'}</dd>
        <dt>{t('mobileDetailsPath')}</dt><dd>{thread?.workspace ?? '—'}</dd>
        <dt>{t('composerModel')}</dt><dd>{state.composerModel || t('autoLabel')}</dd>
        <dt>{t('mode')}</dt><dd>{modeLabel}</dd>
        <dt>{t('mobileDetailsSession')}</dt><dd>{threadId}</dd>
      </dl>
      <div>
        <button type="button" onClick={() => void copySessionId()}>
          {copied ? t('copySuccess') : t('sidebarThreadCopyId')}</button>
        <button type="button" disabled={busy} onClick={() => void toggleArchive()}>
          {thread?.archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}</button>
      </div>
    </div>
  </MobileSheet>
}
