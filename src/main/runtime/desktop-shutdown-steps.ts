export type DesktopShutdownStep = { name: string; run: () => void | Promise<unknown> }

export class DesktopShutdownSteps {
  readonly errors: Error[] = []

  constructor(
    readonly startedAt = Date.now(),
    private readonly warn: (name: string, error: Error) => void = () => undefined
  ) {}

  deadline(offsetMs: number): number { return this.startedAt + offsetMs }

  async settle(step: DesktopShutdownStep, deadline: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const remaining = Math.max(0, deadline - Date.now())
      // Start every cleanup even if a previous step failed. Its underlying
      // process adapter still owns cancellation and exact termination.
      await Promise.race([
        Promise.resolve().then(step.run),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${step.name} exceeded the shutdown deadline`)), remaining)
        })
      ])
      return true
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.errors.push(error)
      this.warn(step.name, error)
      return false
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async group(steps: DesktopShutdownStep[], deadline: number): Promise<void> {
    await Promise.all(steps.map((step) => this.settle(step, deadline)))
  }

  assertComplete(): void {
    if (this.errors.length) throw new AggregateError(this.errors, 'Kun application shutdown was incomplete')
  }
}
