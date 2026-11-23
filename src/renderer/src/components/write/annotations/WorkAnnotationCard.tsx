import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowUp, AtSign, Check, CheckCheck, Copy, CornerDownLeft, Crosshair, LoaderCircle, MessageSquare, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AssistantMarkdown } from '../../chat/AssistantMarkdown'
import {
  annotationComposerIntent,
  type WorkAnnotationLayerProps, type WorkAnnotationMessageView, type WorkAnnotationView
} from './work-annotation-view'

type Props = Pick<WorkAnnotationLayerProps, 'onClose' | 'onSubmit' | 'onPreview' | 'onResolve' | 'onReattach' | 'onRetry'> & {
  annotation: WorkAnnotationView
}

function AnnotationMessage({ message, canPreview, onPreview }: {
  message: WorkAnnotationMessageView
  canPreview: boolean
  onPreview: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const suggestion = message.suggestion
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(suggestion?.text ?? message.text)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  useEffect(() => {
    if (copyState === 'idle') return
    const timer = setTimeout(() => setCopyState('idle'), 2200)
    return () => clearTimeout(timer)
  }, [copyState])
  return (
    <li className="work-annotation-message">
      <div className="work-annotation-author">
        <strong>{message.author === 'kun' ? 'Kun' : t('writeAnnotationMe')}</strong>
        {message.author === 'kun' && (message.text || suggestion) ? (
          <button type="button" className="work-annotation-icon" onClick={() => void copy()}
            title={t('writeAnnotationCopy')} aria-label={t('writeAnnotationCopy')}>
            {copyState === 'copied' ? <Check /> : <Copy />}
          </button>
        ) : null}
      </div>
      {message.text && (message.author === 'kun'
        ? <AssistantMarkdown text={message.text} streaming={false} safeMarkdown className="work-annotation-answer" />
        : <div className="work-annotation-note">{message.text}</div>)}
      {copyState === 'failed' && <span role="alert">{t('writeAnnotationCopyFailed')}</span>}
      {suggestion && (
        <div className="work-annotation-suggestion">
          <strong>{t(suggestion.kind === 'insertAfter' ? 'writeAnnotationInsertAfter' : 'writeAnnotationReplace')}</strong>
          <div className="work-annotation-note">{suggestion.text}</div>
          {suggestion.applied ? <span className="work-annotation-applied"><CheckCheck />{t('writeAnnotationApplied')}</span>
            : canPreview && <button type="button" className="work-annotation-action" onClick={onPreview}>{t('writeAnnotationPreview')}</button>}
        </div>
      )}
    </li>
  )
}

export function WorkAnnotationCard({ annotation, onClose, onSubmit, onResolve, onReattach, onPreview, onRetry }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const locked = useRef(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const { askKun, canSend } = annotationComposerIntent(value)
  const pending = sending || Boolean(annotation.busy)
  useLayoutEffect(() => {
    const target = composer.current ?? closeButton.current
    target?.focus({ preventScroll: true })
  }, [annotation.id])
  useLayoutEffect(() => {
    if (following.current && history.current) history.current.scrollTop = history.current.scrollHeight
  }, [annotation.messages, annotation.error, annotation.busy])

  const submit = async (ask: boolean): Promise<void> => {
    if (locked.current || annotation.resolved || !canSend || (ask && annotation.busy)) return
    locked.current = true
    setSending(true)
    setSubmitError('')
    try {
      await onSubmit(annotation.id, value.trim(), ask)
      setValue('')
      following.current = true
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    } finally {
      locked.current = false
      setSending(false)
    }
  }
  const ask = (): void => {
    if (canSend) { void submit(true); return }
    setValue('@Kun ')
    composer.current?.focus()
  }
  return (
    <section className="work-annotation-card" role="dialog" aria-label={t('writeAnnotationAdd')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}>
      <header className="work-annotation-header">
        <MessageSquare /><strong>{t('writeAnnotationAdd')}</strong>
        {annotation.messages.length > 0 && (
          <button type="button" className="work-annotation-action" disabled={pending}
            onClick={() => onResolve(annotation.id, !annotation.resolved)}>
            {annotation.resolved ? <RotateCcw /> : <Check />}
            {t(annotation.resolved ? 'writeAnnotationReopen' : 'writeAnnotationResolve')}
          </button>
        )}
        <button ref={closeButton} type="button" className="work-annotation-icon" onClick={onClose}
          aria-label={t('close')} title={t('close')}><X /></button>
      </header>
      <blockquote className="work-annotation-quote" title={annotation.quote}>{annotation.quote}</blockquote>
      {annotation.detached && <div className="work-annotation-warning">
        <span>{t('writeAnnotationDetached')}</span>
        <button type="button" className="work-annotation-action" onClick={() => onReattach(annotation.id)}>
          <Crosshair />{t('writeAnnotationReattach')}
        </button>
      </div>}
      <div className="work-annotation-history" ref={history} onScroll={(event) => {
        const view = event.currentTarget
        following.current = view.scrollHeight - view.clientHeight - view.scrollTop < 36
      }}>
        <ol>{annotation.messages.filter((message) => message.text || message.suggestion).map((message) => (
          <AnnotationMessage key={message.id} message={message}
            canPreview={Boolean(onPreview) && annotation.canPreview !== false && !annotation.detached && !annotation.resolved && !pending}
            onPreview={() => onPreview?.(annotation.id, message.id)} />
        ))}</ol>
        {annotation.busy && <div className="work-annotation-status" role="status"><LoaderCircle className="animate-spin" />{t('writeAnnotationThinking')}</div>}
        {(annotation.error || submitError) && <div className="work-annotation-warning" role="alert">
          <span>{annotation.error || submitError}</span>
          {annotation.error && onRetry && annotation.retryable !== false && !pending && !annotation.resolved &&
            <button type="button" className="work-annotation-action" onClick={() => onRetry(annotation.id)}>{t('writeEditRetry')}</button>}
        </div>}
      </div>
      {!annotation.resolved && <form className="work-annotation-composer" onSubmit={(event) => {
        event.preventDefault()
        void submit(askKun)
      }}>
        <textarea ref={composer} rows={2} maxLength={16_000} aria-label={t('writeAnnotationReply')} placeholder={t('writeAnnotationPlaceholder')}
          value={value} disabled={sending} onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit(askKun)
            }
          }} />
        <div className="work-annotation-composer-actions">
          {!askKun && <button className="work-annotation-action" type="button" disabled={pending} onClick={ask}>
            <AtSign />{t('writeAnnotationAsk')}
          </button>}
          <button className="work-annotation-send" type="submit" disabled={!canSend || sending || (askKun && annotation.busy)}>
            {askKun ? <ArrowUp /> : <CornerDownLeft />}{t(askKun ? 'writeAnnotationAsk' : 'writeAnnotationSave')}
          </button>
        </div>
      </form>}
    </section>
  )
}
