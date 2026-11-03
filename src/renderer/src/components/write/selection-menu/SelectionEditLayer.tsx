import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowUp, Check, CornerUpLeft, MessageCircle, RotateCcw, Sparkle, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { writeFocusModeFloatingLayerClassName } from '../../../write/write-focus-mode'
import { barPlacement } from './edit-bar-placement'
import { useEditBarKeys } from './use-edit-bar-keys'
import type { SelectionEditController } from './use-selection-edit'
import { WriteEditToast } from '../WriteEditToast'

export function SelectionEditLayer({ controller, focusMode = false }: {
  controller: SelectionEditController; focusMode?: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLDivElement>(null)
  const [followUp, setFollowUp] = useState('')
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  const { session } = controller
  useEditBarKeys(controller)
  const handle = controller.getHandle()
  useLayoutEffect(() => {
    if (!session || !handle) return
    let frame: number | null = null
    const measure = (): void => {
      frame = null
      const scale = Number.parseFloat(getComputedStyle(document.body).zoom) || 1
      const editor = handle.getElement()
      const bounds = editor?.closest('.write-editor-group,.write-rich-scroll-wrap,.write-codemirror-host')?.getBoundingClientRect()
      setPosition(barPlacement(handle.getReviewAnchorRect(), {
        width: session.phase === 'running' ? 520 : 560, height: ref.current?.offsetHeight ?? 46,
        viewportWidth: innerWidth, viewportHeight: innerHeight, scale, bounds
      }))
    }
    const schedule = (): void => { if (frame === null) frame = requestAnimationFrame(measure) }
    measure()
    const observer = new ResizeObserver(schedule)
    const editor = handle.getElement()
    if (editor) observer.observe(editor)
    if (ref.current) observer.observe(ref.current)
    const unsubscribe = handle.subscribeReviewLayout(schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => { if (frame !== null) cancelAnimationFrame(frame); observer.disconnect(); unsubscribe(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule) }
  }, [handle, session])
  if (!session) return controller.applied ? <WriteEditToast onUndo={controller.undo} onDismiss={controller.dismissToast} /> : null
  const running = session.phase === 'running'
  const submit = (): void => { if (followUp.trim()) { controller.followUp(followUp); setFollowUp('') } }
  return <div ref={ref} className={`write-selection-edit ${running ? 'is-running' : 'is-review'} ${writeFocusModeFloatingLayerClassName(focusMode, 'z-50')}`}
    role="region" aria-label={t(running ? 'writeEditRunning' : 'writeEditDone', { label: session.label })}
    data-selection-ignore="true" style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>
    <div className="write-selection-edit-main">
      <span className="write-selection-edit-icon"><Sparkle /></span>
      <span className="write-selection-edit-label" role="status">{t(running ? 'writeEditRunning' : 'writeEditDone', { label: session.label })}
        {running && <span className="write-selection-edit-dots" aria-hidden="true"><i>·</i><i>·</i><i>·</i></span>}</span>
      {!running && <span className="write-selection-edit-count">· {t('writeEditHunks', { count: session.hunks })}</span>}
      <div className="write-selection-edit-controls">
        {running ? <button type="button" onClick={controller.stop} aria-keyshortcuts="Escape"><Square /><span>{t('writeEditStop')}</span><kbd aria-hidden="true">Esc</kbd></button> : <>
          <button type="button" title={t('writeEditRetry')} aria-label={t('writeEditRetry')} onClick={() => controller.retry()}><RotateCcw /></button>
          <button type="button" title={t('writeEditToChat')} aria-label={t('writeEditToChat')} onClick={controller.toChat}><MessageCircle /><span>{t('writeEditToChat')}</span></button>
          <span className="write-selection-edit-divider" />
          <button type="button" title={t('writeEditReject')} aria-label={t('writeEditReject')} onClick={controller.reject} aria-keyshortcuts="Escape"><X className="compact-only" /><span>{t('writeEditReject')}</span><kbd aria-hidden="true">Esc</kbd></button>
          <button type="button" className="is-primary" onClick={controller.accept} aria-keyshortcuts="Enter"><Check /><span>{t('writeEditAccept')}</span><kbd aria-hidden="true">↵</kbd></button>
        </>}
      </div>
    </div>
    {!running && <div className="write-selection-edit-follow-up"><CornerUpLeft />
      <input value={followUp} onChange={(event) => setFollowUp(event.target.value)} aria-label={t('writeEditFollowUpPlaceholder')} placeholder={t('writeEditFollowUpPlaceholder')}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submit() }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFollowUp(''); event.currentTarget.blur(); controller.getHandle()?.getElement()?.focus() }
        }} />
      <button type="button" disabled={!followUp.trim()} className={followUp.trim() ? 'is-primary' : ''} aria-label={t('writeSelectionAskEdit')} onClick={submit}><ArrowUp /></button>
    </div>}
  </div>
}
