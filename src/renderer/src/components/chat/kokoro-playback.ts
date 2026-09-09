/**
 * Gapless Web Audio playback for Kokoro chunks.
 *
 * Chunks arrive one sentence at a time while later chunks are still being
 * synthesized, so each buffer is scheduled to start exactly where the previous
 * one ends. Raw samples go straight into an AudioBuffer, which avoids blob URLs
 * and keeps the renderer's Content-Security-Policy untouched.
 */

/** Lead time before the first buffer so scheduling never lands in the past. */
const SCHEDULE_LEAD_SECONDS = 0.08

export type KokoroPlayerState = {
  /** Seconds of audio scheduled but not yet played. */
  bufferedSeconds: number
  playing: boolean
}

export class KokoroPlayer {
  private context: AudioContext | null = null
  private gain: GainNode | null = null
  private nextStartTime = 0
  private readonly sources = new Set<AudioBufferSourceNode>()
  private drainResolvers: Array<() => void> = []
  private stopped = false
  private gapSeconds = 0
  private hasScheduledAudio = false

  constructor(private readonly sampleRate: number) {}

  /** True once a buffer has been scheduled and playback has not been stopped. */
  get active(): boolean {
    return !this.stopped && this.sources.size > 0
  }

  get bufferedSeconds(): number {
    if (!this.context) return 0
    return Math.max(0, this.nextStartTime - this.context.currentTime)
  }

  /**
   * Total silence inserted because a chunk arrived after the previous one had
   * finished playing. Stays at zero when synthesis keeps up.
   */
  get droppedSeconds(): number {
    return this.gapSeconds
  }

  /**
   * Schedule one chunk. Returns the absolute time the chunk finishes so the
   * caller can pace synthesis against playback.
   */
  enqueue(samples: Float32Array, sampleRate: number = this.sampleRate): number {
    if (this.stopped || samples.length === 0) return 0
    const context = this.ensureContext()
    const buffer = context.createBuffer(1, samples.length, sampleRate)
    buffer.getChannelData(0).set(samples)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(this.gain ?? context.destination)
    const startAt = Math.max(context.currentTime + SCHEDULE_LEAD_SECONDS, this.nextStartTime)
    // Scheduling past the previous chunk's end means the buffer ran dry and the
    // listener heard silence; record it so pacing regressions are measurable.
    if (this.hasScheduledAudio) this.gapSeconds += Math.max(0, startAt - this.nextStartTime)
    this.hasScheduledAudio = true
    source.start(startAt)
    this.nextStartTime = startAt + buffer.duration
    this.sources.add(source)
    source.onended = () => {
      this.sources.delete(source)
      source.disconnect()
      if (this.sources.size === 0) this.resolveDrain()
    }
    return this.nextStartTime
  }

  /** Resolve once every scheduled chunk has finished playing. */
  waitForDrain(): Promise<void> {
    if (this.stopped || this.sources.size === 0) return Promise.resolve()
    return new Promise((resolve) => {
      this.drainResolvers.push(resolve)
    })
  }

  /** Stop immediately, drop scheduled audio, and release the audio context. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    for (const source of this.sources) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // A source that never started throws; nothing to clean up.
      }
      source.disconnect()
    }
    this.sources.clear()
    this.nextStartTime = 0
    this.resolveDrain()
    const context = this.context
    this.context = null
    this.gain = null
    void context?.close().catch(() => undefined)
  }

  private resolveDrain(): void {
    const resolvers = this.drainResolvers
    this.drainResolvers = []
    for (const resolve of resolvers) resolve()
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context
    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) throw new Error('Web Audio is unavailable')
    const context = new AudioContextCtor({ sampleRate: this.sampleRate })
    const gain = context.createGain()
    gain.gain.value = 1
    gain.connect(context.destination)
    this.context = context
    this.gain = gain
    this.nextStartTime = context.currentTime + SCHEDULE_LEAD_SECONDS
    void context.resume().catch(() => undefined)
    return context
  }
}
