import { warnSqlite } from './hybrid-thread-support.js'

export class HybridSqliteDegradedState {
  private degradedUntil = 0
  private degraded = false

  available(hasDatabase: boolean): boolean {
    return hasDatabase && Date.now() >= this.degradedUntil
  }

  fail(action: string, error: unknown): void {
    this.degradedUntil = Date.now() + 30_000
    if (!this.degraded) {
      this.degraded = true
      warnSqlite(`${action}; entering 30s degraded cooldown`, error)
    }
  }

  recover(): void {
    if (this.degraded) console.warn('[kun] hybrid sqlite recovered; leaving filesystem fallback')
    this.degraded = false
    this.degradedUntil = 0
  }
}
