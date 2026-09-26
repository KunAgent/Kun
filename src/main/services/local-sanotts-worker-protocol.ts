/** Messages exchanged between Main and the sanoTTS synthesis worker. */

export type SanottsWorkerRequest =
  | {
      type: 'synthesize'
      id: string
      text: string
      runtimeDir: string
      voiceId: string
      voiceDir: string
      speed: number
    }
  | { type: 'cancel'; id: string }
  | { type: 'reset' }

export type SanottsWorkerResponse =
  | { type: 'ready' }
  | { type: 'reset-done' }
  | {
      type: 'result'
      id: string
      ok: true
      sampleRate: number
      sampleCount: number
      durationSeconds: number
      pcm: Int16Array
    }
  | { type: 'result'; id: string; ok: false; canceled?: boolean; message?: string }
