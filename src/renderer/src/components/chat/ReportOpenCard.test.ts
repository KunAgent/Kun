import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { NormalizedThread, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { ReportOpenCard, reportOpenCardState } from './ReportOpenCard'

const mocks = vi.hoisted(() => ({ openLibraryArtifact: vi.fn() }))
vi.mock('../../artifacts/artifact-library-store', () => ({ openLibraryArtifact: mocks.openLibraryArtifact }))

const REPORT_ID = '0123456789'

function chart(title: string) {
  return {
    type: 'chart', width: 'half',
    chart: { version: 1, type: 'line', title, data: [{ d: 'a', v: 1 }, { d: 'b', v: 3 }], x: { field: 'd' }, series: [{ field: 'v' }] }
  }
}

const report = {
  title: 'Kun user overview',
  asOf: '10/27',
  sources: ['auth.users'],
  blocks: [{ type: 'stats', items: [{ label: 'Registered', value: 502 }, { label: 'Active', value: 359, delta: '+12', tone: 'positive' }] }, chart('DAU'), chart('Sign-ups')]
}

function block(reportOpenRequest: Record<string, unknown>): ToolBlock {
  return {
    kind: 'tool', id: 'tool_report', turnId: 'turn-1', summary: 'report_open', status: 'success', toolKind: 'tool_call',
    meta: { toolName: 'report_open', reportOpenRequest }
  } as unknown as ToolBlock
}

const ready = { status: 'ready', title: report.title, reportId: REPORT_ID, revision: 1, report }

async function render(request: Record<string, unknown>, requestTurnLive = false): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(ReportOpenCard, { block: block(request), threadId: 'thread-1', requestTurnLive }))
  })
  return renderer
}

function section(renderer: ReactTestRenderer) {
  return renderer.root.find((node) => node.type === 'section' && node.props['data-report-open-card'] !== undefined)
}

function count(renderer: ReactTestRenderer, attribute: string): number {
  return renderer.root.findAll((node) => typeof node.type === 'string' && node.props[attribute] !== undefined).length
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useChatStore.setState({ threads: [{ id: 'thread-1', title: 'Users', updatedAt: '', model: '', mode: 'agent', workspace: '/work/kun/', agentSurface: 'code' } as NormalizedThread] })
})

afterEach(() => mocks.openLibraryArtifact.mockClear())

describe('ReportOpenCard', () => {
  it('maps call status and turn liveness to a card state', () => {
    expect(reportOpenCardState('pending', true)).toBe('building')
    expect(reportOpenCardState('pending', false)).toBe('interrupted')
    expect(reportOpenCardState('ready', false)).toBe('ready')
  })

  it('renders the whole report and opens the saved artifact', async () => {
    const renderer = await render(ready)
    expect(section(renderer).props['data-report-open-state']).toBe('ready')
    expect(count(renderer, 'data-report-stat')).toBe(2)
    expect(count(renderer, 'data-chart-renderer')).toBe(2)
    const open = renderer.root.find((node) => node.type === 'button' && node.props['data-report-open-open'] !== undefined)
    await act(async () => open.props.onClick())
    expect(mocks.openLibraryArtifact).toHaveBeenCalledWith(`report:/work/kun:.kun-reports/${REPORT_ID}.json`)
    await act(async () => renderer.unmount())
  })

  it('collapses long reports in the transcript', async () => {
    const long = { ...report, blocks: [...report.blocks, chart('A'), chart('B')] }
    const renderer = await render({ ...ready, report: long })
    expect(count(renderer, 'data-chart-renderer')).toBe(2)
    const toggle = renderer.root.find((node) => node.type === 'button' && node.props['aria-expanded'] === false)
    await act(async () => toggle.props.onClick())
    expect(count(renderer, 'data-chart-renderer')).toBe(4)
    await act(async () => renderer.unmount())
  })

  it('shows a failed call without an open action', async () => {
    const renderer = await render({ status: 'failed', title: 'Broken', error: 'unknown data field: x' })
    expect(section(renderer).props['data-report-open-state']).toBe('failed')
    expect(count(renderer, 'data-report-open-open')).toBe(0)
    await act(async () => renderer.unmount())
  })
})
