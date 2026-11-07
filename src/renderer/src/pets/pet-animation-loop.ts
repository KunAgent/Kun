export type PetPaintTime = { elapsed: number; reduced: boolean; paused: boolean }
export type PetPaint = (time: PetPaintTime) => number | void
export type PetAnimationScheduler = {
  now(): number
  frame(callback: () => void): number
  cancelFrame(id: number): void
  delay(callback: () => void, ms: number): number
  cancelDelay(id: number): void
}

/** A display-paced clock for motion, or a sleeping clock for discrete sprites. */
export class PetAnimationLoop {
  private elapsed = 0
  private previous: number
  private frame: number | undefined
  private timer: number | undefined
  private hidden = false
  private paused = false
  private reduced = false
  private disposed = false

  constructor(private readonly scheduler: PetAnimationScheduler, private readonly paint: PetPaint) {
    this.previous = scheduler.now()
  }

  update(state: { hidden: boolean; paused: boolean; reduced: boolean }): void {
    if (this.disposed) return
    this.advance()
    Object.assign(this, state)
    this.refresh()
  }

  refresh = (): void => {
    if (this.disposed) return
    this.cancel()
    this.advance()
    if (this.hidden) return
    const delay = this.paint({ elapsed: this.elapsed, reduced: this.reduced, paused: this.paused })
    if (this.paused || this.reduced) return
    if (typeof delay === 'number') {
      this.timer = this.scheduler.delay(() => {
        this.timer = undefined
        this.frame = this.scheduler.frame(this.refresh)
      }, Math.max(1, delay))
    } else this.frame = this.scheduler.frame(this.refresh)
  }

  dispose(): void { this.cancel(); this.disposed = true }

  private advance(): void {
    const now = this.scheduler.now()
    if (!this.hidden && !this.paused && !this.reduced) this.elapsed += Math.max(0, now - this.previous)
    this.previous = now
  }

  private cancel(): void {
    if (this.frame !== undefined) this.scheduler.cancelFrame(this.frame)
    if (this.timer !== undefined) this.scheduler.cancelDelay(this.timer)
    this.frame = this.timer = undefined
  }
}
