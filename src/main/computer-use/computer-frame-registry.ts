import { randomUUID } from 'node:crypto'

export type ComputerFrameDescriptor = {
  frameId: string
  sessionId: string
  capturedAtMs: number
  image: { width: number; height: number; mimeType: string }
  nativeDesktop: { width: number; height: number; scaleX: number; scaleY: number }
  coordinateSpace: 'kun-frame-v1'
}

export type RegisteredComputerFrame = ComputerFrameDescriptor & {
  expiresAtMs: number
}

export class ComputerFrameError extends Error {
  readonly code = 'stale_frame'
  readonly needsFreshFrame = true

  constructor(message: string) {
    super(message)
  }
}

export class ComputerFrameRegistry {
  private readonly frames = new Map<string, RegisteredComputerFrame>()

  constructor(
    private readonly maxAgeMs = 30_000,
    private readonly maxFrames = 64,
    private readonly now: () => number = Date.now
  ) {}

  register(input: {
    sessionId: string
    image: { width: number; height: number; mimeType: string }
    nativeDesktop: { width: number; height: number; scaleX?: number; scaleY?: number }
  }): ComputerFrameDescriptor {
    const capturedAtMs = this.now()
    const frame: RegisteredComputerFrame = {
      frameId: randomUUID(),
      sessionId: input.sessionId,
      capturedAtMs,
      image: input.image,
      nativeDesktop: {
        width: input.nativeDesktop.width,
        height: input.nativeDesktop.height,
        scaleX: input.nativeDesktop.scaleX ?? input.nativeDesktop.width / input.image.width,
        scaleY: input.nativeDesktop.scaleY ?? input.nativeDesktop.height / input.image.height
      },
      coordinateSpace: 'kun-frame-v1',
      expiresAtMs: capturedAtMs + this.maxAgeMs
    }
    this.frames.set(frame.frameId, frame)
    this.evict()
    return this.publicFrame(frame)
  }

  latest(sessionId: string): ComputerFrameDescriptor | undefined {
    let latest: RegisteredComputerFrame | undefined
    for (const frame of this.frames.values()) {
      if (frame.sessionId === sessionId && (!latest || frame.capturedAtMs >= latest.capturedAtMs)) {
        latest = frame
      }
    }
    if (!latest || latest.expiresAtMs < this.now()) return undefined
    return this.publicFrame(latest)
  }

  resolve(
    sessionId: string,
    frameId: string | undefined,
    point: { x: number; y: number }
  ): { x: number; y: number; frame: ComputerFrameDescriptor } {
    const frame = frameId ? this.frames.get(frameId) : this.findLatest(sessionId)
    if (!frame || frame.sessionId !== sessionId) {
      throw new ComputerFrameError('The screenshot frame is missing or belongs to another computer session.')
    }
    if (frame.expiresAtMs < this.now()) {
      this.frames.delete(frame.frameId)
      throw new ComputerFrameError('The screenshot frame expired; take a fresh screenshot before acting.')
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new ComputerFrameError('Coordinates must be finite numbers in the screenshot frame.')
    }
    if (point.x < 0 || point.y < 0 || point.x >= frame.image.width || point.y >= frame.image.height) {
      throw new ComputerFrameError('Coordinates fall outside the screenshot frame; take a fresh screenshot.')
    }
    return {
      x: clamp(Math.round(point.x * frame.nativeDesktop.scaleX), 0, frame.nativeDesktop.width - 1),
      y: clamp(Math.round(point.y * frame.nativeDesktop.scaleY), 0, frame.nativeDesktop.height - 1),
      frame: this.publicFrame(frame)
    }
  }

  invalidateSession(sessionId: string): void {
    for (const [id, frame] of this.frames) {
      if (frame.sessionId === sessionId) this.frames.delete(id)
    }
  }

  private findLatest(sessionId: string): RegisteredComputerFrame | undefined {
    let latest: RegisteredComputerFrame | undefined
    for (const frame of this.frames.values()) {
      if (frame.sessionId === sessionId && (!latest || frame.capturedAtMs >= latest.capturedAtMs)) {
        latest = frame
      }
    }
    return latest
  }

  private evict(): void {
    const now = this.now()
    for (const [id, frame] of this.frames) {
      if (frame.expiresAtMs < now) this.frames.delete(id)
    }
    while (this.frames.size > this.maxFrames) {
      const first = this.frames.keys().next().value as string | undefined
      if (!first) break
      this.frames.delete(first)
    }
  }

  private publicFrame(frame: RegisteredComputerFrame): ComputerFrameDescriptor {
    const { expiresAtMs: _expiresAtMs, ...descriptor } = frame
    return descriptor
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
