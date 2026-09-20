import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Plus, Square } from 'lucide-react'
import './mobile-composer.css'

export type MobileComposerProps = {
  value: string
  onChange: (text: string) => void
  onSend: () => void
  onStop: () => void
  onAttachments: (() => void) | null
  onOptions: () => void
  running: boolean
  disabled: boolean
  sending: boolean
  canSend: boolean
  labels: { placeholder: string; send: string; stop: string; attachments: string; options: string }
  attachments?: ReactNode
  pendingActions?: ReactNode
  error?: string | null
}

/** The caller owns submission/queue semantics and per-conversation draft persistence. */
export function MobileComposer(props: MobileComposerProps) {
  const { value, onChange, onSend, onStop, onAttachments, onOptions, running,
    disabled, sending, canSend, labels, attachments, pendingActions, error } = props
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const [focused, setFocused] = useState(false)
  const expanded = focused || value.includes('\n') || Boolean(attachments)
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [value])

  return <section className="kun-mobile-composer" data-expanded={expanded}>
    {pendingActions}
    {error ? <p role="alert" className="kun-mobile-composer-error">{error}</p> : null}
    {attachments}
    <div className="kun-mobile-composer-row">
      {onAttachments ? <button type="button" className="kun-mobile-composer-action" onClick={onAttachments}
        disabled={disabled || sending} aria-label={labels.attachments}><Plus size={20} aria-hidden /></button> : null}
      <textarea ref={inputRef} rows={1} value={value} disabled={disabled}
        aria-label={labels.placeholder} placeholder={labels.placeholder}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={() => { composing.current = false }}
        onKeyDown={(event) => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
            event.preventDefault()
            if (canSend && !disabled && !sending) onSend()
          }
        }} />
      {running ? <button type="button" className="kun-mobile-composer-action" onClick={onStop}
        disabled={disabled} aria-label={labels.stop}><Square size={18} aria-hidden /></button> : null}
      <button type="button" className="kun-mobile-composer-action kun-mobile-composer-send"
        disabled={!canSend || disabled || sending} onClick={onSend} aria-label={labels.send}>
        <ArrowUp size={20} aria-hidden />
      </button>
    </div>
    <button type="button" className="kun-mobile-composer-options" onClick={onOptions} disabled={disabled}>
      {labels.options}
    </button>
  </section>
}
