let foregroundReads = 0
let overloadUntil = 0

export function enterForegroundRuntimeRead(): () => void {
  foregroundReads += 1
  let released = false
  return () => {
    if (released) return
    released = true
    foregroundReads = Math.max(0, foregroundReads - 1)
  }
}

export function noteRuntimeReadOverload(cooldownMs = 5_000): void {
  overloadUntil = Math.max(overloadUntil, Date.now() + cooldownMs)
}

export function optionalRuntimeWorkPaused(): boolean {
  return foregroundReads > 0 || Date.now() < overloadUntil
}

export function runtimeLoadState(): {
  foregroundReads: number
  overloadCooldownMs: number
} {
  return {
    foregroundReads,
    overloadCooldownMs: Math.max(0, overloadUntil - Date.now())
  }
}

export function resetRuntimeLoadStateForTests(): void {
  foregroundReads = 0
  overloadUntil = 0
}
