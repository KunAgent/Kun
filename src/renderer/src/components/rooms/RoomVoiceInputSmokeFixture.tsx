import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RoomComposer } from './RoomComposer'
import { defaultKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID, type AppSettingsV1 } from '@shared/app-settings'
import type { Room, SendRoomMessage } from '@shared/rooms-api'
import { emitRendererSettingsChanged } from '../../lib/keyboard-shortcut-settings'
import i18n from '../../i18n'
import '../../index.css'
import '../../styles/base-shell.css'
import './rooms-direct.css'
import './rooms-init-im.css'
import './rooms.css'
import './rooms-chat-surface.css'

// Production Rooms composer, rich editor, settings hook and MediaRecorder/WAV
// pipeline. Only host services and media source are deterministic offline fixtures.
// No physical microphone access, provider credentials or network transcription.
const runtime = defaultKunRuntimeSettings()
runtime.speechToText = { ...runtime.speechToText, enabled: true,
  providerId: CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID, protocol: 'local-whisper',
  model: 'whisper-small-q5_1', apiKey: '' }
const settings = { agents: { kun: runtime } } as AppSettingsV1
const calls = { sent: [] as SendRoomMessage[], transcribed: 0, captures: 0, stopped: 0 }
let denied = false
let delay = false
let failure = false
let pendingResult: ((result: { ok: boolean; text?: string; message?: string }) => void) | undefined
const syntheticCapture = async () => {
  calls.captures++
  if (denied) throw new DOMException('Offline permission-denial fixture', 'NotAllowedError')
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const destination = context.createMediaStreamDestination()
  oscillator.connect(destination)
  oscillator.start()
  for (const track of destination.stream.getTracks()) {
    const stop = track.stop.bind(track)
    track.stop = () => { calls.stopped++; stop(); oscillator.stop(); void context.close() }
  }
  return destination.stream
}
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: syntheticCapture })
Object.assign(window, { kunGui: {
  platform: 'win32', getSettings: async () => settings,
  runtimeRequest: async (path: string) => ({ ok: true, status: 200, body: JSON.stringify(
    path.endsWith('/direct/permissions') ? { revision: 1, policy: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user' } }
      : path === '/v1/rooms/presets' ? { presets: [], models: [], providers: [] } : {}) }),
  transcribeSpeech: async () => {
    calls.transcribed++
    if (delay) return new Promise((resolve) => { pendingResult = resolve })
    return failure ? { ok: false, message: 'Offline transcription failure fixture' }
      : { ok: true, text: 'Recorded offline fixture text' }
  }
} })
const room = { id: 'voice-room-one', name: 'Personal Agent', revision: 1,
  conversationKind: 'user_agent', collaborationMode: 'directed', defaultMemberId: 'assistant',
  members: [{ id: 'assistant', displayName: 'Personal Agent', enabled: true }], repositories: [] } as unknown as Room
let switchRoom = (_id: string): void => {}
function Fixture() {
  const [roomId, setRoomId] = useState(room.id)
  switchRoom = setRoomId
  return <main className="rooms-workspace" data-room-surface="agent-chat" data-rooms-workspace
    style={{ width: '100%', paddingTop: 40 }}>
    <header style={{ padding: '12px 24px' }}><h1 style={{ fontSize: 20 }}>Personal Agent · Voice input</h1>
      <p style={{ fontSize: 12 }}>Offline native UI fixture · synthetic audio · no microphone or Whisper service</p></header>
    <div style={{ minHeight: 180, padding: '20px 24px', color: 'var(--ds-text-muted)' }}>Drafts stay in their own conversation</div>
    <RoomComposer room={{ ...room, id: roomId }} tasks={[]} quickTools
      modelControl={<button type="button" className="rooms-composer-model"><span>DeepSeek fixture model with a long name</span></button>}
      onSend={async (message) => { calls.sent.push(message) }} />
  </main>
}
Object.assign(window, { roomVoiceFixture: {
  calls, language: (language: string) => i18n.changeLanguage(language),
  setEnabled: (enabled: boolean) => { runtime.speechToText.enabled = enabled; emitRendererSettingsChanged(settings) },
  deny: (value: boolean) => { denied = value }, delay: (value: boolean) => { delay = value },
  fail: (value: boolean) => { failure = value },
  resolve: (text: string) => { pendingResult?.({ ok: true, text }); pendingResult = undefined },
  switchRoom: (id: string) => switchRoom(id)
} })
await i18n.changeLanguage('en')
createRoot(document.getElementById('root')!).render(<Fixture />)
