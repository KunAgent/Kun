import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SystemNotificationResult } from '../shared/kun-gui-notification-contracts'

/** Native notification receipts survive renderer reloads and app restarts.
 * Delivery is at-least-once if the process dies between OS show and receipt
 * persistence; never claim remote push or a user's having read the banner. */
export class NotificationReceipts {
  private receipts?: string[]
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly path: string) {}

  deliver(key: string, show: () => Promise<SystemNotificationResult>): Promise<SystemNotificationResult> {
    const next = this.queue.catch(() => undefined).then(async () => {
      if (!this.receipts) {
        try {
          const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
          this.receipts = Array.isArray(parsed) ? parsed.filter((value): value is string =>
            typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)).slice(-2000) : []
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
          this.receipts = []
        }
      }
      const id = createHash('sha256').update(key).digest('hex')
      if (this.receipts.includes(id)) return { ok: true, shown: false, reason: 'duplicate' } as const
      const result = await show()
      if (!result.ok) return result
      const updated = [...this.receipts, id].slice(-2000)
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temporary = this.path + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, JSON.stringify(updated), { mode: 0o600 })
        await rename(temporary, this.path)
      } finally { await rm(temporary, { force: true }).catch(() => undefined) }
      this.receipts = updated
      return result
    })
    this.queue = next
    return next
  }
}
