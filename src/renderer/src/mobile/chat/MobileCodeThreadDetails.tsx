import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { formatRuntimeError } from '../../lib/format-runtime-error'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { MobileSheet } from '../sheets/MobileSheet'

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
    activeThreadId: value.activeThreadId,
    blocks: value.blocks,
    busy: value.busy,
    composerMode: value.composerMode,
    composerModel: value.composerModel,
    rename: value.renameThread,
    archive: value.archiveThread,
    archiveToTurn: value.archiveActiveThreadToTurn
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
  // The per-turn "archive through here" controls are desktop-only (U9); the
  // sheet offers the same operation anchored at the latest turn instead.
  const archiveAnchorTurnId = (() => {
    if (threadId !== state.activeThreadId) return ''
    for (let index = state.blocks.length - 1; index >= 0; index -= 1) {
      const turnId = state.blocks[index]?.turnId?.trim()
      if (turnId) return turnId
    }
    return ''
  })()
  const archiveEarlierHistory = async (): Promise<void> => {
    if (!archiveAnchorTurnId || busy || state.busy) return
    if (!window.confirm(t('archiveHistoryConfirm'))) return
    setBusy(true)
    try {
      await state.archiveToTurn(archiveAnchorTurnId)
      setError('')
    } catch (cause) {
      setError(formatRuntimeError(cause))
    } finally { setBusy(false) }
  }

  return <MobileSheet open={open} title={t('mobileThreadDetails')} closeLabel={t('close')} onClose={onClose}>
    <div className="kun-mobile-form">
      {error ? <p className="kun-mobile-form-error" role="alert">{error}</p> : null}
      <label className="kun-mobile-field">{t('sidebarThreadRename')}
        <input type="text" value={title ?? thread?.title ?? ''}
          placeholder={t('sidebarThreadRenamePrompt')}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={() => { if (title === null) setTitle(thread?.title ?? '') }} />
      </label>
      {editing ? <div className="kun-mobile-row-actions">
        <button type="button" data-variant="primary" disabled={busy} onClick={() => void saveTitle()}>{t('mobileSave')}</button>
        <button type="button" disabled={busy} onClick={() => setTitle(null)}>{t('cancel')}</button>
      </div> : null}
      <dl className="kun-mobile-kv">
        <dt>{t('mobileDetailsProject')}</dt><dd>{thread?.workspace ? workspaceLabelFromPath(thread.workspace) : '—'}</dd>
        <dt>{t('mobileDetailsPath')}</dt><dd>{thread?.workspace ?? '—'}</dd>
        <dt>{t('composerModel')}</dt><dd>{state.composerModel || t('autoLabel')}</dd>
        <dt>{t('mode')}</dt><dd>{modeLabel}</dd>
        <dt>{t('mobileDetailsSession')}</dt><dd data-mono>{threadId}</dd>
      </dl>
      {archiveAnchorTurnId ? (
        <div className="kun-mobile-row-actions">
          <button type="button" disabled={busy || state.busy} onClick={() => void archiveEarlierHistory()}>
            {t('archiveHistoryEarlier')}</button>
        </div>
      ) : null}
      <div className="kun-mobile-row-actions">
        <button type="button" onClick={() => void copySessionId()}>
          {copied ? t('copySuccess') : t('sidebarThreadCopyId')}</button>
        <button type="button" data-variant="danger" disabled={busy} onClick={() => void toggleArchive()}>
          {thread?.archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}</button>
      </div>
    </div>
  </MobileSheet>
}
