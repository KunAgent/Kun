import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { PetOverlayBridge } from '@shared/pets'
import { useVoiceCapture } from '../components/chat/use-voice-capture'
import './pet-quick-chat.css'

function labelsFor(language: string) {
  return language.toLowerCase().startsWith('zh') ? {
    chat: '直接对话', voice: '语音输入', stop: '结束录音', hide: '收起通知', show: '展开通知',
    enableVisits: '开启伙伴来互动', disableVisits: '关闭伙伴来互动',
    placeholder: '开始新对话', send: '发送', close: '收起输入框', recording: '正在录音，再次点击语音按钮结束',
    transcribing: '正在识别语音…', sending: '正在发送…', failed: '发送失败，请重试',
    tooShort: '录音太短，请重试', micDenied: '无法访问麦克风，请检查系统权限', captureFailed: '录音失败，请重试',
    voiceFailed: (message: string) => `语音输入失败：${message}`
  } : {
    chat: 'New chat', voice: 'Voice input', stop: 'Finish recording', hide: 'Collapse notifications', show: 'Show notifications',
    enableVisits: 'Enable companion visits', disableVisits: 'Disable companion visits',
    placeholder: 'Start new chat', send: 'Send', close: 'Close composer', recording: 'Recording. Click voice input to finish.',
    transcribing: 'Transcribing…', sending: 'Sending…', failed: 'Could not send. Please try again.',
    tooShort: 'Recording too short. Please try again.', micDenied: 'Check your microphone permission.', captureFailed: 'Could not record. Please try again.',
    voiceFailed: (message: string) => `Voice input failed: ${message}`
  }
}

export function PetQuickChat(props: {
  bridge: PetOverlayBridge
  notificationCount: number
  bubblesHidden: boolean
  revealed: boolean
  visitsEnabled?: boolean
  onToggleVisits?: () => void
  onToggleBubbles: () => void
  onInteractiveChange: (interactive: boolean) => void
}): ReactElement {
  const { bridge, onInteractiveChange } = props
  const labels = useMemo(() => labelsFor(navigator.language), [])
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sendLock = useRef(false)
  const mounted = useRef(true)
  const messages = useMemo(() => ({
    failed: labels.voiceFailed, tooShort: labels.tooShort,
    micDenied: labels.micDenied, captureFailed: labels.captureFailed
  }), [labels])
  const voice = useVoiceCapture({
    messages, transcribe: bridge.transcribeSpeech,
    onText: (text) => { setDraft((current) => current ? `${current} ${text}` : text); input.current?.focus() }
  })
  const recording = voice.status === 'recording'
  const cancelVoice = voice.cancel
  const voiceBusy = voice.status !== 'idle'
  const controlsVisible = props.revealed || open || voiceBusy || sending

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void bridge.getVoiceInputAvailable().then((available) => {
        if (active) setVoiceAvailable(available === true)
      }).catch(() => { if (active) setVoiceAvailable(false) })
    }
    refresh()
    const timer = window.setInterval(refresh, 10_000)
    const stop = bridge.onMainWindowFocused(refresh)
    return () => { active = false; window.clearInterval(timer); stop() }
  }, [bridge])
  useEffect(() => { if (!voiceAvailable) cancelVoice() }, [voiceAvailable, cancelVoice])
  useEffect(() => {
    onInteractiveChange(open || voiceBusy || sending)
  }, [open, voiceBusy, sending, onInteractiveChange])
  useEffect(() => { if (open && !voiceBusy && !sending) input.current?.focus() }, [open, voiceBusy, sending])

  const close = (): void => {
    voice.cancel()
    voice.clearError()
    setOpen(false)
    onInteractiveChange(false)
  }
  const begin = (): void => {
    setOpen(true)
    setError(null)
    onInteractiveChange(true)
  }
  const send = async (): Promise<void> => {
    const prompt = draft.trim()
    if (!prompt || sendLock.current || voiceBusy) return
    sendLock.current = true
    setSending(true)
    setError(null)
    try {
      const result = await bridge.startChat(prompt)
      if (!mounted.current) return
      if (result.ok) { setDraft(''); close() }
      else setError(result.message || labels.failed)
    } catch { if (mounted.current) setError(labels.failed) }
    finally { sendLock.current = false; if (mounted.current) setSending(false) }
  }

  return (
    <div className={`pet-quick-chat${open ? ' pet-quick-chat-open' : ''}`}>
      {open ? (
        <form className="pet-quick-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
          <button type="button" className="pet-quick-close" aria-label={labels.close} onClick={close}>×</button>
          <input ref={input} aria-label={labels.placeholder} placeholder={labels.placeholder}
            value={draft} maxLength={16000} disabled={sending || voiceBusy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.stopPropagation(); close() }
              if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
            }} />
          {voiceBusy ? <button type="button" className="pet-quick-record" aria-label={recording ? labels.stop : labels.transcribing}
            disabled={!recording} onClick={() => voice.stop()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button> : null}
          <button type="submit" className="pet-quick-send" aria-label={labels.send}
            disabled={!draft.trim() || sending || voiceBusy}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
          </button>
          {voiceBusy || sending ? <span className="pet-quick-status" role="status">
            {sending ? labels.sending : voice.status === 'transcribing' ? labels.transcribing : labels.recording}
          </span> : null}
          {error || voice.error ? <span className="pet-quick-error" role="alert">{error || voice.error}</span> : null}
        </form>
      ) : null}
      {!open ? <div className="pet-toolbar-slot" data-controls-visible={controlsVisible}>
        <span className="pet-toolbar-handle" aria-hidden="true" />
        <div className="pet-toolbar" role="toolbar" aria-label={labels.chat}
          aria-hidden={!controlsVisible} inert={!controlsVisible}>
          <button type="button" aria-label={labels.chat} title={labels.chat} aria-expanded={open}
            onClick={() => { if (open) close(); else begin() }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7M16 3l5 5-9 9-5 1 1-5Z" /></svg>
          </button>
          {props.onToggleVisits ? <button type="button" aria-label={props.visitsEnabled ? labels.disableVisits : labels.enableVisits}
            title={props.visitsEnabled ? labels.disableVisits : labels.enableVisits}
            aria-pressed={props.visitsEnabled} data-enabled={props.visitsEnabled} onClick={props.onToggleVisits}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></svg>
          </button> : null}
          {voiceAvailable ? <button type="button" aria-label={recording ? labels.stop : labels.voice}
            title={recording ? labels.stop : labels.voice} aria-pressed={recording} data-recording={recording}
            disabled={sending || (voiceBusy && !recording)} onClick={() => { begin(); voice.toggle() }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4m4-8v12m4-15v18m4-14v10m4-7v4" /></svg>
          </button> : null}
          <button type="button" aria-label={props.bubblesHidden ? `${labels.show} (${props.notificationCount})` : labels.hide}
            title={props.bubblesHidden ? labels.show : labels.hide} disabled={props.notificationCount === 0}
            aria-expanded={!props.bubblesHidden} onClick={() => { close(); props.onToggleBubbles() }}>
            {props.bubblesHidden ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4Zm5 4h4M12 2v2" /></svg>
              : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 7-7 7 7" /></svg>}
            {props.bubblesHidden && props.notificationCount > 0 ? <span className="pet-toolbar-count" aria-hidden="true">
              {props.notificationCount > 99 ? '99+' : props.notificationCount}
            </span> : null}
          </button>
        </div>
      </div> : null}
    </div>
  )
}
