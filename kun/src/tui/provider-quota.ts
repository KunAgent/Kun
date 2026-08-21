import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
  type TUI
} from '@earendil-works/pi-tui'
import type {
  ProviderQuotaEntry,
  ProviderQuotaListResponse,
  ProviderQuotaMetric
} from '../contracts/provider-quota.js'
import { redactSecretText } from '../config/secret-redaction.js'
import { sanitizeTerminalText, wrapText } from './layout.js'
import {
  joinVisualSides,
  pageFrame,
  sectionLabel,
  statusGlyph,
  visual,
  visualDensity
} from './visual-system.js'

const safe = (value: string): string => sanitizeTerminalText(redactSecretText(value))
const bold = visual.strong
const dim = visual.muted
const cyan = visual.focus
const green = visual.success
const yellow = visual.warning
const red = visual.danger

export class ProviderQuotaDialog implements Component, Focusable {
  private snapshot?: ProviderQuotaListResponse
  private loading = false
  private error = ''
  private offset = 0
  private maxOffset = 0
  private pageSize = 1
  private _focused = true

  constructor(
    private readonly tui: TUI,
    private readonly load: () => Promise<ProviderQuotaListResponse>,
    private readonly close: () => void,
    private readonly terminalRows: () => number,
    private readonly nowMs: () => number = Date.now
  ) {}

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value }

  async refresh(): Promise<void> {
    if (this.loading) return
    this.loading = true
    this.error = ''
    this.tui.requestRender()
    try {
      this.snapshot = await this.load()
      this.offset = 0
    } catch (error) {
      this.error = safe(error instanceof Error ? error.message : 'Provider quota refresh failed.')
    } finally {
      this.loading = false
      this.tui.requestRender()
    }
  }

  render(width: number): string[] {
    const contentWidth = Math.max(12, width - 2)
    const body = providerQuotaBody(
      this.snapshot,
      contentWidth,
      this.nowMs(),
      this.loading,
      this.error
    )
    this.pageSize = Math.max(1, this.terminalRows() - 7)
    this.maxOffset = Math.max(0, body.length - this.pageSize)
    this.offset = Math.max(0, Math.min(this.offset, this.maxOffset))
    const visible = body.slice(this.offset, this.offset + this.pageSize)
    const range = this.maxOffset > 0
      ? `${this.offset + 1}-${Math.min(body.length, this.offset + this.pageSize)}/${body.length}`
      : ''
    const refreshed = this.snapshot
      ? `refreshed ${formatClock(this.snapshot.refreshedAt)}`
      : this.loading
        ? 'loading'
        : ''
    return pageFrame({
      path: ['KUN', 'Provider quota'],
      right: [this.loading && this.snapshot ? 'refreshing' : refreshed, range].filter(Boolean).join(' · '),
      description: 'Account balances and rate limits from configured providers.',
      body: visible,
      footer: [
        ...(this.maxOffset > 0 ? [{ key: '↑/↓ PgUp/PgDn', label: 'navigate' }] : []),
        { key: 'r', label: this.loading ? 'refreshing…' : 'refresh' },
        { key: 'Esc', label: 'back' }
      ],
      width
    })
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.close()
      return
    }
    const key = data.toLowerCase()
    if (key === 'r' || matchesKey(data, 'ctrl+r')) {
      void this.refresh()
      return
    }
    if (matchesKey(data, 'up') || key === 'k') this.offset = Math.max(0, this.offset - 1)
    else if (matchesKey(data, 'down') || key === 'j') this.offset = Math.min(this.maxOffset, this.offset + 1)
    else if (matchesKey(data, 'pageUp')) this.offset = Math.max(0, this.offset - this.pageSize)
    else if (matchesKey(data, 'pageDown')) this.offset = Math.min(this.maxOffset, this.offset + this.pageSize)
    else if (matchesKey(data, 'home')) this.offset = 0
    else if (matchesKey(data, 'end')) this.offset = this.maxOffset
    this.tui.requestRender()
  }

  invalidate(): void {}
}

export function providerQuotaBody(
  snapshot: ProviderQuotaListResponse | undefined,
  width: number,
  nowMs = Date.now(),
  loading = false,
  error = ''
): string[] {
  if (!snapshot) {
    return [
      loading
        ? ` ${statusGlyph('running', Math.floor(nowMs / 200))} ${yellow('Loading provider quota…')}`
        : ` ${statusGlyph('failed')} ${red(error || 'Provider quota is unavailable.')}`
    ]
  }
  const lines: string[] = []
  if (error) {
    lines.push(
      ` ${statusGlyph('warning')} ${yellow('Refresh failed')}  ${dim(safe(error))}`,
      ''
    )
  } else if (loading) {
    lines.push(
      ` ${statusGlyph('running', Math.floor(nowMs / 200))} ${dim('Refreshing provider quota…')}`,
      ''
    )
  }
  if (!snapshot.entries.length) {
    lines.push(` ${statusGlyph('idle')} ${dim('No model providers are configured.')}`)
    return lines
  }
  snapshot.entries.forEach((entry, index) => {
    if (index > 0) lines.push(sectionLabel('', width))
    lines.push(...providerLines(entry, width, nowMs))
  })
  return lines
}

function providerLines(entry: ProviderQuotaEntry, width: number, nowMs: number): string[] {
  const status = providerStatus(entry)
  const right = providerStatusLabel(entry)
  const heading = joinVisualSides(
    ` ${statusGlyph(status.glyph)} ${bold(safe(entry.providerName))}`,
    status.tone(safe(right)),
    width
  )
  const lines = [heading]
  if (entry.status === 'available') {
    if (!entry.metrics.length) {
      lines.push(`   ${dim('No quota metrics were returned.')}`)
    } else {
      entry.metrics.forEach((metric) => {
        lines.push(...metricLines(metric, width, nowMs))
      })
    }
  } else {
    lines.push(...wrapText(
      safe(entry.message ?? defaultStatusMessage(entry.status)),
      Math.max(1, width - 3)
    ).map((line) => `   ${status.tone(line)}`))
  }
  if (entry.localCost) {
    lines.push(...localCostLines(entry.localCost, width))
  }
  return lines
}

function localCostLines(
  localCost: NonNullable<ProviderQuotaEntry['localCost']>,
  width: number
): string[] {
  const lines = [`   ${bold('Local API reference value')}`]
  for (const [label, window] of [
    ['Today', localCost.today],
    ['Last 30 days', localCost.last30Days]
  ] as const) {
    const amount = window.amount === null || window.coverage === 'unavailable'
      ? yellow('price unavailable')
      : cyan(`$${formatAmount(window.amount)}`)
    const coverage = window.coverage === 'partial' ? yellow('partial') : ''
    lines.push(joinVisualSides(
      `   ${label}`,
      [amount, coverage].filter(Boolean).join(' · '),
      width
    ))
    lines.push(`     ${dim(
      `${formatAmount(window.requests)} requests · ${formatAmount(window.totalTokens)} tokens`
    )}`)
  }
  lines.push(...wrapText(
    'API reference estimate, not an actual subscription charge.',
    Math.max(1, width - 3)
  ).map((line) => `   ${dim(line)}`))
  return lines
}

function providerStatus(entry: ProviderQuotaEntry): {
  glyph: 'success' | 'idle' | 'warning' | 'failed'
  tone: (value: string) => string
} {
  switch (entry.status) {
    case 'available': return { glyph: 'success', tone: green }
    case 'missing_credentials': return { glyph: 'warning', tone: yellow }
    case 'error': return { glyph: 'failed', tone: red }
    case 'unsupported': return { glyph: 'idle', tone: dim }
  }
}

function providerStatusLabel(entry: ProviderQuotaEntry): string {
  if (entry.status === 'available') return entry.summary || 'available'
  if (entry.status === 'missing_credentials') return 'sign in required'
  if (entry.status === 'unsupported') return 'unsupported'
  return 'error'
}

function defaultStatusMessage(status: ProviderQuotaEntry['status']): string {
  if (status === 'missing_credentials') return 'Connect this provider before refreshing quota.'
  if (status === 'unsupported') return 'No supported quota endpoint is available.'
  return 'The provider quota request failed.'
}

function metricLines(metric: ProviderQuotaMetric, width: number, nowMs: number): string[] {
  const density = visualDensity(width)
  const label = safe(metric.label)
  const value = metricValue(metric)
  const reset = metric.resetsAt ? resetLabel(metric.resetsAt, nowMs) : ''
  const percent = metric.usedPercent
  if (density === 'wide') {
    const labelWidth = Math.min(28, Math.max(16, Math.floor(width * 0.25)))
    const progress = percent === undefined ? '' : progressBar(percent, 20)
    const left = `   ${truncateToWidth(label, labelWidth).padEnd(labelWidth)}  ${progress}`
    const details = [percent === undefined ? '' : cyan(`${formatPercent(percent)}%`), value, reset]
      .filter(Boolean)
      .join('  ')
    return [joinVisualSides(left, details, width)]
  }
  if (density === 'compact') {
    const barWidth = Math.max(8, Math.min(16, width - 42))
    const left = percent === undefined
      ? `   ${label}`
      : `   ${truncateToWidth(label, Math.max(12, width - barWidth - 16))}  ${progressBar(percent, barWidth)}`
    const right = percent === undefined ? value : `${formatPercent(percent)}%`
    return [
      joinVisualSides(left, cyan(right), width),
      ...([percent === undefined ? '' : value, reset].filter(Boolean).length
        ? [`     ${dim([percent === undefined ? '' : value, reset].filter(Boolean).join(' · '))}`]
        : [])
    ]
  }
  return [
    joinVisualSides(`   ${label}`, percent === undefined ? value : cyan(`${formatPercent(percent)}%`), width),
    ...(percent === undefined ? [] : [`     ${progressBar(percent, Math.max(6, width - 12))}`]),
    ...([value, reset].filter(Boolean).length && percent !== undefined
      ? [`     ${dim([value, reset].filter(Boolean).join(' · '))}`]
      : reset
        ? [`     ${dim(reset)}`]
        : [])
  ]
}

function progressBar(percent: number, cells: number): string {
  const width = Math.max(1, cells)
  const filled = Math.round(Math.min(100, Math.max(0, percent)) / 100 * width)
  return `[${cyan('■'.repeat(filled))}${dim('·'.repeat(width - filled))}]`
}

function metricValue(metric: ProviderQuotaMetric): string {
  const unit = safe(metric.unit)
  if (metric.used !== undefined && metric.limit !== undefined) {
    return `${formatAmount(metric.used)} / ${formatAmount(metric.limit)} ${unit}`
  }
  if (metric.remaining !== undefined) {
    return `${formatAmount(metric.remaining)} ${unit}${metric.limit !== undefined ? ' remaining' : ''}`
  }
  if (metric.used !== undefined) return `${formatAmount(metric.used)} ${unit} used`
  if (metric.limit !== undefined) return `${formatAmount(metric.limit)} ${unit} limit`
  return ''
}

function formatAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 0,
    maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2
  })
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function resetLabel(value: string, nowMs: number): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const delta = timestamp - nowMs
  if (delta <= 0) return 'reset due'
  const minutes = Math.max(1, Math.round(delta / 60_000))
  if (minutes < 60) return `resets in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours < 48) return `resets in ${hours}h${remainder ? ` ${remainder}m` : ''}`
  const days = Math.floor(hours / 24)
  return `resets in ${days}d`
}

function formatClock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

export function providerQuotaVisibleWidth(lines: readonly string[]): number {
  return Math.max(0, ...lines.map((line) => visibleWidth(line)))
}
