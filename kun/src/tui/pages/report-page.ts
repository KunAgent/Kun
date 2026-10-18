import { isCancelKey, isKey, letter, type TuiKeyEvent } from '../keys.js'
import type { PageAction, PageBlock, PageMouseEvent, PageSize, PageView, TuiPage } from '../page-model.js'
import type { Invalidate } from './page-kit.js'

export type ReportPageConfig<T> = {
  kind: string
  path: readonly string[]
  description: string
  load: () => Promise<T>
  body: (snapshot: T | undefined, width: number, loading: boolean, error: string) => string[]
  refreshedLabel: (snapshot: T | undefined, refreshedAt: number | undefined) => string
  errorMessage: (error: unknown) => string
  extraFooter?: PageAction[]
  nowMs?: () => number
}

/**
 * Read-only, scrollable report (usage, provider quota). Refresh failures keep
 * the previous snapshot visible and report the error above it.
 */
export class ReportPage<T> implements TuiPage {
  readonly kind: string
  private snapshot?: T
  private loading = false
  private error = ''
  private refreshedAt?: number
  private offset = 0
  private maxOffset = 0
  private pageSize = 1

  constructor(
    private readonly config: ReportPageConfig<T>,
    private readonly close: () => void,
    private readonly invalidate: Invalidate
  ) {
    this.kind = config.kind
  }

  get animated(): boolean {
    return this.loading
  }

  async refresh(): Promise<void> {
    if (this.loading) return
    this.loading = true
    this.error = ''
    this.invalidate()
    try {
      this.snapshot = await this.config.load()
      this.refreshedAt = (this.config.nowMs ?? Date.now)()
      this.offset = 0
    } catch (error) {
      this.error = this.config.errorMessage(error)
      this.offset = 0
    } finally {
      this.loading = false
      this.invalidate()
    }
  }

  view(size: PageSize): PageView {
    const body = this.config.body(this.snapshot, Math.max(12, size.width - 2), this.loading, this.error)
    this.pageSize = Math.max(1, size.height - 7)
    this.maxOffset = Math.max(0, body.length - this.pageSize)
    this.offset = Math.max(0, Math.min(this.offset, this.maxOffset))
    const range = this.maxOffset > 0
      ? `${this.offset + 1}-${Math.min(body.length, this.offset + this.pageSize)}/${body.length}`
      : ''
    const refreshed = this.config.refreshedLabel(this.snapshot, this.refreshedAt) || (this.loading ? 'loading' : '')
    return {
      path: this.config.path,
      right: [this.loading && this.snapshot ? 'refreshing' : refreshed, range].filter(Boolean).join(' · '),
      description: this.config.description,
      body: body.slice(this.offset, this.offset + this.pageSize)
        .map((text): PageBlock => (text === '' ? { kind: 'spacer' } : { kind: 'line', text })),
      footer: [
        ...(this.maxOffset > 0 ? [{ key: '↑/↓ PgUp/PgDn', label: 'navigate' }] : []),
        { key: 'r', label: this.loading ? 'refreshing…' : 'refresh' },
        ...(this.config.extraFooter ?? []),
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (isCancelKey(key)) { this.close(); return }
    if (letter(key) === 'r' || isKey(key, 'ctrl+r')) { void this.refresh(); return }
    if (isKey(key, 'up') || letter(key) === 'k') this.offset = Math.max(0, this.offset - 1)
    else if (isKey(key, 'down') || letter(key) === 'j') this.offset = Math.min(this.maxOffset, this.offset + 1)
    else if (isKey(key, 'pageUp')) this.offset = Math.max(0, this.offset - this.pageSize)
    else if (isKey(key, 'pageDown')) this.offset = Math.min(this.maxOffset, this.offset + this.pageSize)
    else if (isKey(key, 'home')) this.offset = 0
    else if (isKey(key, 'end')) this.offset = this.maxOffset
    else return
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    if (event.type !== 'scroll') return
    this.offset = Math.max(0, Math.min(this.maxOffset, this.offset + event.delta))
    this.invalidate()
  }
}
