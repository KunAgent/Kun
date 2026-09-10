/** Messages exchanged between Main and the Kokoro synthesis worker. */

export type KokoroWorkerRequest =
  | {
      type: 'synthesize'
      id: string
      text: string
      /** Resolved by Main: Electron path APIs do not exist on a worker thread. */
      modelPath: string
      voiceId: string
      voicePath: string
      language: 'en-us' | 'en-gb'
      speed: number
    }
  | { type: 'cancel'; id: string }
  | { type: 'reset' }

export type KokoroWorkerResponse =
  | { type: 'ready' }
  | { type: 'reset-done' }
  | {
      type: 'result'
      id: string
      ok: true
      sampleRate: number
      sampleCount: number
      durationSeconds: number
      /** Transferred, not copied. */
      pcm: Int16Array
    }
  | { type: 'result'; id: string; ok: false; canceled?: boolean; message?: string }
