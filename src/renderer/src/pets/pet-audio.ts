import type { PetCursorSample } from '@shared/pets'
import type { PetTypingState } from '@shared/pets-typing'
import { buildGlottalPurrBuffer, decodeAllTypingBuffers } from './pet-audio-buffers'
import type { TypingSoundSlot } from './typing-sound-data'

const KEY_DOWN_SLOTS: readonly TypingSoundSlot[] = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']
const KEY_UP_SLOTS: readonly TypingSoundSlot[] = ['up0', 'up1', 'up2', 'up3']

type KeyFlavor = 'alpha' | 'space' | 'enter' | 'backspace'

export class PetAudioEngine {
  private ctx: AudioContext | null = null
  private soundEnabled = true
  private typingBuffers: Map<TypingSoundSlot, AudioBuffer> | null = null
  private purrFilter: BiquadFilterNode | null = null
  private purrGain: GainNode | null = null
  private purrSource: AudioBufferSourceNode | null = null
  private purrBuffer: AudioBuffer | null = null
  private purrStopTimer: ReturnType<typeof setTimeout> | null = null
  private currentPurrIntensity = 0
  private currentIsCat = true
  private deviceWatcherAttached = false
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null

  private keyDownIndex = 0
  private keyUpIndex = 0
  private spaceIndex = 0

  private typingHydrated = false
  private lastLeftSeq = 0
  private lastRightSeq = 0
  private lastHeld = 0
  private lastFlavor: KeyFlavor = 'alpha'
  private lastPan = 0
  private pendingKeyUpTimer: ReturnType<typeof setTimeout> | null = null

  private cursorHydrated = false
  private lastClickSeq = 0
  private lastButtons = 0
  private pendingMouseUpTimer: ReturnType<typeof setTimeout> | null = null

  setSoundEnabled(enabled: boolean): void {
    const next = Boolean(enabled)
    if (this.soundEnabled === next) {
      if (next && !this.typingBuffers) this.ensureTypingBuffers()
      return
    }
    this.soundEnabled = next
    if (!next) {
      this.clearPendingTimers()
      this.setPurrIntensity(0, this.currentIsCat)
    } else {
      this.ensureTypingBuffers()
    }
  }

  isSoundEnabled(): boolean {
    return this.soundEnabled
  }

  resetTracking(): void {
    this.clearPendingTimers()
    this.typingHydrated = false
    this.lastLeftSeq = 0
    this.lastRightSeq = 0
    this.lastHeld = 0
    this.cursorHydrated = false
    this.lastClickSeq = 0
    this.lastButtons = 0
  }

  dispose(): void {
    this.clearPendingTimers()
    if (this.rebuildTimer !== null) {
      clearTimeout(this.rebuildTimer)
      this.rebuildTimer = null
    }
    this.teardownGraph()
  }

  /**
   * Feeds privacy-preserving typing snapshots into real-time mechanical switch key-down & key-up sounds.
   */
  noteTyping(typing: PetTypingState | undefined, isBootstrapHydration = false): void {
    if (!typing) {
      if (this.lastHeld !== 0 && this.soundEnabled && !isBootstrapHydration) {
        this.playKeyUp(this.lastFlavor, this.lastPan)
      }
      this.lastLeftSeq = 0
      this.lastRightSeq = 0
      this.lastHeld = 0
      this.typingHydrated = true
      return
    }

    const leftSeq = typing.left.sequence
    const rightSeq = typing.right.sequence
    const held = typing.held

    if (!this.typingHydrated || isBootstrapHydration) {
      this.typingHydrated = true
      this.lastLeftSeq = leftSeq
      this.lastRightSeq = rightSeq
      this.lastHeld = held
      return
    }

    const sourceReset =
      (leftSeq < this.lastLeftSeq || rightSeq < this.lastRightSeq) && (leftSeq > 0 || rightSeq > 0)
    const leftStruck = sourceReset ? leftSeq > 0 : leftSeq > this.lastLeftSeq
    const rightStruck = sourceReset ? rightSeq > 0 : rightSeq > this.lastRightSeq
    const isNewTap = leftStruck || rightStruck
    const releasedMask = this.lastHeld & ~held

    this.lastLeftSeq = leftSeq
    this.lastRightSeq = rightSeq
    this.lastHeld = held

    if (!this.soundEnabled) return

    if (isNewTap) {
      if (this.pendingKeyUpTimer !== null) {
        clearTimeout(this.pendingKeyUpTimer)
        this.pendingKeyUpTimer = null
      }
      const isSpace = leftStruck && rightStruck && Math.abs(typing.left.struckAt - typing.right.struckAt) <= 16
      let col = 2.5
      let row = 1
      if (!isSpace) {
        if (rightStruck && !leftStruck) {
          col = typing.right.col ?? 4
          row = typing.right.row ?? 1
        } else if (leftStruck && !rightStruck) {
          col = typing.left.col ?? 1
          row = typing.left.row ?? 1
        } else if (typing.right.struckAt >= typing.left.struckAt) {
          col = typing.right.col ?? 4
          row = typing.right.row ?? 1
        } else {
          col = typing.left.col ?? 1
          row = typing.left.row ?? 1
        }
      }
      const pan = isSpace ? 0 : ((col - 2.5) / 2.5) * 0.28
      let flavor: KeyFlavor = 'alpha'
      if (isSpace) flavor = 'space'
      else if (rightStruck && col === 5 && row === 0) flavor = 'backspace'
      else if (rightStruck && col === 5 && row === 1) flavor = 'enter'

      this.lastFlavor = flavor
      this.lastPan = pan
      this.playKeyDown(flavor, pan)

      // IME / fallback taps arrive with held === 0; schedule a crisp mechanical switch return.
      if (held === 0) {
        const upFlavor = flavor
        const upPan = pan
        this.pendingKeyUpTimer = setTimeout(() => {
          this.pendingKeyUpTimer = null
          if (this.soundEnabled) this.playKeyUp(upFlavor, upPan)
        }, 42)
      }
      return
    }

    if (releasedMask !== 0) {
      this.playKeyUp(held === 0 ? this.lastFlavor : 'alpha', this.lastPan)
    }
  }

  /**
   * Feeds global/desk cursor samples into mechanical mouse micro-switch down & up sounds.
   */
  noteCursor(sample: PetCursorSample | null, suppressDeskClicks = false, isBootstrapHydration = false): void {
    if (!sample) {
      this.lastButtons = 0
      return
    }
    const clickSeq = sample.clickSeq ?? 0
    const buttons = sample.buttons & 7

    if (!this.cursorHydrated || isBootstrapHydration) {
      this.cursorHydrated = true
      const freshLiveClick = !isBootstrapHydration &&
        typeof sample.clickedAt === 'number' &&
        Math.abs(Date.now() - sample.clickedAt) < 300 &&
        (sample.clickMask ?? 0) !== 0
      if (freshLiveClick) {
        this.lastClickSeq = Math.max(0, clickSeq - 1)
        this.lastButtons = 0
      } else {
        this.lastClickSeq = clickSeq
        this.lastButtons = buttons
        return
      }
    }

    const seqAdvanced = clickSeq > this.lastClickSeq || (clickSeq > 0 && clickSeq < this.lastClickSeq)
    const risingMask = seqAdvanced ? (sample.clickMask ?? ((buttons & ~this.lastButtons) || 1)) : (buttons & ~this.lastButtons)
    const releasedMask = this.lastButtons & ~buttons

    this.lastClickSeq = clickSeq
    this.lastButtons = buttons

    if (!this.soundEnabled || suppressDeskClicks || sample.overMascot) return

    if (risingMask !== 0) {
      if (this.pendingMouseUpTimer !== null) {
        clearTimeout(this.pendingMouseUpTimer)
        this.pendingMouseUpTimer = null
      }
      const isAlt = (risingMask & 6) !== 0 && (risingMask & 1) === 0
      this.playMouseDown(isAlt ? 'right' : 'left')
      // Sub-frame trackpad tap where press & release happened between cursor ticks.
      if ((buttons & risingMask) === 0) {
        this.pendingMouseUpTimer = setTimeout(() => {
          this.pendingMouseUpTimer = null
          if (this.soundEnabled) this.playMouseUp()
        }, 44)
      }
      return
    }

    if (releasedMask !== 0) {
      this.playMouseUp()
    }
  }

  playKeyDown(flavor: KeyFlavor = 'alpha', pan = 0): void {
    if (!this.soundEnabled) return
    let slot: TypingSoundSlot
    if (flavor === 'space') slot = this.spaceIndex++ % 2 === 0 ? 'space0' : 'space1'
    else if (flavor === 'enter') slot = 'enter'
    else if (flavor === 'backspace') slot = 'backspace'
    else slot = KEY_DOWN_SLOTS[this.keyDownIndex++ % KEY_DOWN_SLOTS.length]
    const gain = 0.58 * this.randRange(0.93, 1.05)
    const rate = this.randRange(0.985, 1.015)
    this.playTypingSlot(slot, gain, rate, pan)
  }

  playKeyUp(flavor: KeyFlavor = 'alpha', pan = 0): void {
    if (!this.soundEnabled) return
    let slot: TypingSoundSlot
    if (flavor === 'space') slot = 'space_up'
    else if (flavor === 'enter') slot = 'enter_up'
    else slot = KEY_UP_SLOTS[this.keyUpIndex++ % KEY_UP_SLOTS.length]
    const gain = 0.50 * this.randRange(0.93, 1.05)
    const rate = this.randRange(0.985, 1.015)
    this.playTypingSlot(slot, gain, rate, pan)
  }

  playMouseDown(button: 'left' | 'right' | 'middle' = 'left'): void {
    if (!this.soundEnabled) return
    const isAlt = button === 'right' || button === 'middle'
    const slot: TypingSoundSlot = isAlt ? 'mouse_down1' : 'mouse_down0'
    const rate = isAlt ? this.randRange(0.96, 0.99) : this.randRange(0.985, 1.015)
    const gain = 0.44 * this.randRange(0.94, 1.04)
    // Kun's studio desk places the mousepad on the viewer's left side.
    this.playTypingSlot(slot, gain, rate, -0.22)
  }

  playMouseUp(): void {
    if (!this.soundEnabled) return
    const rate = this.randRange(0.985, 1.015)
    const gain = 0.46 * this.randRange(0.94, 1.04)
    this.playTypingSlot('mouse_up0', gain, rate, -0.22)
  }

  /**
   * Soft rubbery head-pat boop chirp when tapping the resident mascot.
   */
  playPatBoop(): void {
    if (!this.soundEnabled) return
    const ctx = this.ensureAudioContext()
    if (!ctx || !Number.isFinite(ctx.currentTime)) return
    try {
      const t0 = ctx.currentTime + 0.006
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(520, t0)
      osc.frequency.exponentialRampToValueAtTime(740, t0 + 0.045)
      osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.105)
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.linearRampToValueAtTime(0.068, t0 + 0.014)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.115)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.13)
      osc.onended = () => {
        try { osc.disconnect(); gain.disconnect() } catch { /* ignore */ }
      }
    } catch { /* Never throw on unavailable audio device */ }
  }

  /**
   * Smoothly drives cozy cat purring during head-pats (full chest purr for KuroCat, gentle soft purr for companions).
   */
  setPurrIntensity(intensity: number, isCat = true): void {
    const target = this.soundEnabled ? Math.max(0, Math.min(1, intensity)) : 0
    if (target <= 0.01 && !this.purrGain) return
    if (Math.abs(target - this.currentPurrIntensity) < 0.008 && isCat === this.currentIsCat) return
    const wasSilent = this.currentPurrIntensity <= 0.01
    this.currentPurrIntensity = target
    this.currentIsCat = isCat

    if (target > 0.01 && !this.ensurePurrGraph()) return
    const ctx = this.ctx
    if (!ctx || !this.purrGain || (ctx.state as string) === 'closed') return

    try {
      if (target > 0.01) {
        this.safeResume(ctx)
        this.startPurrLoopIfNeeded(ctx, wasSilent)
        this.applyPurrParams(ctx, target, isCat, 0.14)
      } else {
        this.applyPurrParams(ctx, 0, isCat, 0.22)
        this.clearPurrStopTimer()
        if (this.purrSource) {
          this.purrStopTimer = setTimeout(() => {
            this.purrStopTimer = null
            if (this.currentPurrIntensity <= 0.01) this.stopPurrSource()
          }, 900)
        }
      }
    } catch { /* Ignore AudioParam scheduling errors */ }
  }

  private clearPendingTimers(): void {
    if (this.pendingKeyUpTimer !== null) {
      clearTimeout(this.pendingKeyUpTimer)
      this.pendingKeyUpTimer = null
    }
    if (this.pendingMouseUpTimer !== null) {
      clearTimeout(this.pendingMouseUpTimer)
      this.pendingMouseUpTimer = null
    }
  }

  private attachDeviceWatcher(): void {
    if (this.deviceWatcherAttached) return
    try {
      const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
      if (!media || typeof media.addEventListener !== 'function') return
      media.addEventListener('devicechange', () => this.scheduleRebuild())
      this.deviceWatcherAttached = true
    } catch { /* Restricted environments may deny mediaDevices */ }
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer !== null) return
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null
      this.rebuild()
    }, 280)
  }

  private rebuild(): void {
    if (!this.ctx) return
    const keepIntensity = this.soundEnabled ? this.currentPurrIntensity : 0
    const isCat = this.currentIsCat
    this.teardownGraph()
    if (this.soundEnabled) this.ensureTypingBuffers()
    if (keepIntensity > 0.01 && this.ensurePurrGraph() && this.ctx) {
      try {
        this.startPurrLoopIfNeeded(this.ctx, true)
        this.applyPurrParams(this.ctx, keepIntensity, isCat, 0.06)
      } catch { /* ignore */ }
    }
  }

  private clearPurrStopTimer(): void {
    if (this.purrStopTimer !== null) {
      clearTimeout(this.purrStopTimer)
      this.purrStopTimer = null
    }
  }

  private stopPurrSource(): void {
    this.clearPurrStopTimer()
    const src = this.purrSource
    this.purrSource = null
    if (!src) return
    try { src.stop() } catch { /* already stopped */ }
    try { src.disconnect() } catch { /* already disconnected */ }
  }

  private teardownGraph(): void {
    const ctx = this.ctx
    this.stopPurrSource()
    try { this.purrFilter?.disconnect() } catch { /* ignore */ }
    try { this.purrGain?.disconnect() } catch { /* ignore */ }
    this.purrFilter = null
    this.purrGain = null
    this.purrBuffer = null
    this.typingBuffers = null
    this.ctx = null
    if (ctx) {
      try {
        ctx.onstatechange = null
        const p = ctx.close()
        if (p && typeof p.catch === 'function') void p.catch(() => {})
      } catch { /* ignore */ }
    }
  }

  private safeResume(ctx: AudioContext): void {
    if (ctx.state !== 'suspended') return
    try {
      const res = ctx.resume()
      if (res && typeof res.catch === 'function') void res.catch(() => {})
    } catch { /* ignore */ }
  }

  private ensureAudioContext(): AudioContext | null {
    if (!this.soundEnabled || typeof globalThis === 'undefined') return null
    if (this.ctx && (this.ctx.state as string) === 'closed') this.teardownGraph()
    if (!this.ctx) {
      const scope = globalThis as unknown as {
        AudioContext?: typeof AudioContext
        webkitAudioContext?: typeof AudioContext
      }
      const AC = scope.AudioContext ?? scope.webkitAudioContext
      if (!AC) return null
      try {
        this.ctx = new AC()
      } catch {
        this.ctx = null
        return null
      }
      const watched = this.ctx
      watched.onstatechange = () => {
        if (this.ctx !== watched) return
        const state = watched.state as string
        if (state === 'closed' || state === 'interrupted') this.scheduleRebuild()
      }
      this.attachDeviceWatcher()
    }
    const ctx = this.ctx
    if ((ctx.state as string) === 'closed' || !Number.isFinite(ctx.sampleRate) || ctx.sampleRate <= 0) {
      this.teardownGraph()
      return null
    }
    this.safeResume(ctx)
    return ctx
  }

  private ensureTypingBuffers(): Map<TypingSoundSlot, AudioBuffer> | null {
    if (!this.soundEnabled) return null
    const ctx = this.ensureAudioContext()
    if (!ctx) return null
    if (this.typingBuffers) return this.typingBuffers
    const map = decodeAllTypingBuffers(ctx)
    if (map.size > 0) this.typingBuffers = map
    return this.typingBuffers
  }

  private ensurePurrGraph(): boolean {
    if (!this.soundEnabled) return false
    const ctx = this.ensureAudioContext()
    if (!ctx) return false
    if (this.purrGain && this.purrFilter) return (ctx.state as string) !== 'closed'
    try {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 3200
      filter.Q.value = 0.7

      const gain = ctx.createGain()
      gain.gain.value = 0.0001

      filter.connect(gain)
      gain.connect(ctx.destination)
      this.purrFilter = filter
      this.purrGain = gain
      return true
    } catch {
      this.teardownGraph()
      return false
    }
  }

  private startPurrLoopIfNeeded(ctx: AudioContext, randomOffset: boolean): void {
    this.clearPurrStopTimer()
    if (this.purrSource || !this.purrFilter) return
    const buf = (this.purrBuffer ??= buildGlottalPurrBuffer(ctx))
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.playbackRate.value = this.currentIsCat ? 1.0 : 1.06
    src.connect(this.purrFilter)
    const offset = randomOffset && buf.duration > 0.25 ? Math.random() * (buf.duration - 0.15) : 0
    src.start(0, offset)
    this.purrSource = src
  }

  private applyPurrParams(ctx: AudioContext, intensity: number, isCat: boolean, timeConst: number): void {
    if (!this.purrGain) return
    const now = ctx.currentTime
    if (!Number.isFinite(now)) return
    const scale = isCat ? 0.44 : 0.24
    const targetGain = intensity > 0.01 ? intensity * scale : 0.0001
    this.purrGain.gain.setTargetAtTime(targetGain, now, timeConst)
    if (this.purrFilter) {
      this.purrFilter.frequency.setTargetAtTime(isCat ? 3300 : 2200, now, 0.12)
    }
  }

  private playTypingSlot(slot: TypingSoundSlot, gain: number, playbackRate: number, pan: number): void {
    if (!this.soundEnabled) return
    try {
      const ctx = this.ensureAudioContext()
      const buffers = this.ensureTypingBuffers()
      if (!ctx || !buffers) return
      const buf = buffers.get(slot)
      if (!buf) return

      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = playbackRate

      const gainNode = ctx.createGain()
      gainNode.gain.value = gain

      let panNode: StereoPannerNode | null = null
      const clampedPan = Number.isFinite(pan) ? Math.max(-0.38, Math.min(0.38, pan)) : 0
      if (Math.abs(clampedPan) > 0.001 && typeof ctx.createStereoPanner === 'function') {
        try {
          panNode = ctx.createStereoPanner()
          panNode.pan.value = clampedPan
        } catch {
          panNode = null
        }
      }

      src.connect(gainNode)
      if (panNode) {
        gainNode.connect(panNode)
        panNode.connect(ctx.destination)
      } else {
        gainNode.connect(ctx.destination)
      }

      src.onended = () => {
        try {
          src.disconnect()
          gainNode.disconnect()
          panNode?.disconnect()
        } catch { /* ignore */ }
      }
      src.start()
    } catch { /* Never throw on blocked autoplay or missing audio hardware */ }
  }

  private randRange(min: number, max: number): number {
    return min + Math.random() * (max - min)
  }
}

export const petAudio = new PetAudioEngine()
