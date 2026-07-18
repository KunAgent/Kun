export interface MigrationMaintenanceLock {
  isLocked(): boolean
}
export type MigrationMaintenanceLease = {
  operationId: string
  release(): void
}

export class ScopedMigrationMaintenanceLock implements MigrationMaintenanceLock {
  private owner: string | null = null

  isLocked(): boolean {
    return this.owner !== null
  }

  acquire(operationId: string): MigrationMaintenanceLease {
    if (this.owner && this.owner !== operationId) throw new Error(`runtime migration is already active: ${this.owner}`)
    this.owner = operationId
    let released = false
    return {
      operationId,
      release: () => {
        if (released) return
        released = true
        if (this.owner === operationId) this.owner = null
      }
    }
  }
}
