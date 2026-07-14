import type { FaultInjectionKind, FaultInjectionSpec } from '../contracts/fault-injection.js'
import { normalizeFaultInjectionSpec, shouldInjectFault } from '../contracts/fault-injection.js'

export type FaultActivation = {
  kind: FaultInjectionKind
  activation: number
  delayMs: number
}

/** Explicitly opt-in fault controller used by integration tests and CI. */
export class FaultInjectionController {
  private spec: FaultInjectionSpec | null = null
  private activationCount = 0

  configure(input: unknown): void {
    const normalized = normalizeFaultInjectionSpec(input)
    if (!normalized.ok) throw new Error(`invalid fault injection spec: ${normalized.error}`)
    this.spec = normalized.value
    this.activationCount = 0
  }

  clear(): void {
    this.spec = null
    this.activationCount = 0
  }

  async activate(kind: FaultInjectionKind, signal?: AbortSignal): Promise<FaultActivation | null> {
    const spec = this.spec
    if (!spec || spec.kind !== kind || !shouldInjectFault(spec, this.activationCount)) return null
    const activation = this.activationCount
    this.activationCount += 1
    await waitForFault(spec.delayMs, signal)
    return { kind, activation, delayMs: spec.delayMs }
  }
}

export function faultInjectionSpecForTests(
  kind: FaultInjectionKind,
  options: Partial<Pick<FaultInjectionSpec, 'once' | 'delayMs'>> = {}
): FaultInjectionSpec {
  return {
    kind,
    enabled: true,
    once: options.once ?? true,
    delayMs: options.delayMs ?? 0
  }
}

async function waitForFault(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    if (signal?.aborted) throw new Error('fault injection aborted')
    return
  }
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const abort = (): void => {
      cleanup()
      reject(new Error('fault injection aborted'))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
  })
}
