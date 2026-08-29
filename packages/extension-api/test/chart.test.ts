import { describe, expect, it } from 'vitest'
import {
  MAX_CHART_ROWS,
  MAX_CHART_SPEC_BYTES,
  ChartSpecV1Schema,
  chartSpecToCsv,
  type ChartSpecV1
} from '../src/chart.js'

const lineChart: ChartSpecV1 = {
  version: 1,
  type: 'line',
  title: '30-day error-rate trend',
  data: [
    { date: '2026-08-01', errorRate: 2.1 },
    { date: '2026-08-02', errorRate: 3.8 }
  ],
  x: { field: 'date', label: 'Date', format: 'date' },
  y: { field: 'errorRate', label: 'Error rate', format: 'percent' },
  series: [{ field: 'errorRate', label: 'Error rate', color: 'danger' }],
  actions: ['expand', 'download-png', 'download-csv']
}

describe('ChartSpecV1', () => {
  it('accepts a bounded semantic chart contract', () => {
    expect(ChartSpecV1Schema.parse(lineChart)).toEqual(lineChart)
  })

  it('rejects unknown versions, options, fields, and arbitrary colors', () => {
    expect(ChartSpecV1Schema.safeParse({ ...lineChart, version: 2 }).success).toBe(false)
    expect(ChartSpecV1Schema.safeParse({ ...lineChart, rendererOptions: { animation: true } }).success).toBe(false)
    expect(ChartSpecV1Schema.safeParse({
      ...lineChart,
      series: [{ field: 'missing', color: '#ff0000' }]
    }).success).toBe(false)
  })

  it('enforces chart-specific encodings', () => {
    expect(ChartSpecV1Schema.safeParse({
      ...lineChart,
      type: 'table',
      x: undefined,
      y: undefined,
      series: undefined
    }).success).toBe(true)
    expect(ChartSpecV1Schema.safeParse({ ...lineChart, type: 'pie' }).success).toBe(true)
    expect(ChartSpecV1Schema.safeParse({
      ...lineChart,
      type: 'metric',
      data: [{ errorRate: 2.1 }],
      x: undefined
    }).success).toBe(true)
    expect(ChartSpecV1Schema.safeParse({ ...lineChart, type: 'line', series: undefined }).success).toBe(false)
  })

  it('bounds rows, columns, scalar values, and encoded payload size', () => {
    const rows = Array.from({ length: MAX_CHART_ROWS + 1 }, (_, index) => ({ date: String(index), errorRate: index }))
    expect(ChartSpecV1Schema.safeParse({ ...lineChart, data: rows }).success).toBe(false)
    expect(ChartSpecV1Schema.safeParse({ ...lineChart, data: [{ date: 'x'.repeat(501), errorRate: 1 }] }).success).toBe(false)
    const oversized = {
      ...lineChart,
      data: Array.from({ length: MAX_CHART_ROWS }, (_, index) => ({
        date: String(index), errorRate: index, detail: 'x'.repeat(500)
      }))
    }
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(MAX_CHART_SPEC_BYTES)
    expect(ChartSpecV1Schema.safeParse(oversized).success).toBe(false)
  })

  it('escapes spreadsheet formulas in CSV exports', () => {
    expect(chartSpecToCsv({
      version: 1,
      type: 'table',
      title: 'Values',
      data: [{ label: '=2+2', value: 4 }]
    })).toContain("'=2+2")
  })
})
