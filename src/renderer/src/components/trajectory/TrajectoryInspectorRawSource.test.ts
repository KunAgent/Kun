// @vitest-environment jsdom

import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { fetchTrajectoryDetail, TrajectoryDetailSection, TrajectoryRecord } from '../../agent/trajectory'
import { TrajectoryInspector } from './TrajectoryInspector'
import { deriveHarnessLayout } from './trajectory-harness-model'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-i18next', () => {
  const translations = {
    trajectoryTabSummary: 'Summary',
    trajectoryTabPreview: 'Preview',
    trajectorySection_raw: 'Raw',
    trajectoryTabSource: 'Source',
    trajectoryRawBlockLabel: 'Block',
    trajectorySourceAria: 'Message source',
    trajectoryRetry: 'Retry',
    trajectoryDetailLoadFailed: 'Detail failed'
  } as Record<string, string>
  const t = (key: string): string => translations[key] ?? key
  return { useTranslation: () => ({ t }) }
})

const base = {
  schemaVersion: 2 as const,
  threadId: 'thread-raw-source',
  turnId: 'turn-1',
  roundId: 'round-1',
  step: 0,
  status: 'completed' as const,
  detailState: 'available' as const,
  startedAt: '2026-01-01T00:00:00.000Z',
  thinkingPreview: '',
  attachmentIds: []
}

describe('TrajectoryInspector Raw and Source', () => {
  it('loads distinct sections and renders content blocks separately from provenance', async () => {
    const record: TrajectoryRecord = {
      ...base,
      id: 'item:user-1',
      kind: 'user',
      itemId: 'user-1',
      itemIds: ['user-1'],
      preview: 'message body',
      sourceType: 'background_subagent',
      sourceAvailable: true,
      sourceLabel: 'Background Subagent'
    }
    const cell = deriveHarnessLayout([record]).cells[0]!
    const calls: TrajectoryDetailSection[] = []
    const loader: typeof fetchTrajectoryDetail = async (_threadId, recordId, section) => {
      calls.push(section)
      return {
        schemaVersion: 2,
        recordId,
        section,
        state: 'available',
        truncated: false,
        content: section === 'raw'
          ? { kind: 'blocks', blocks: [{ type: 'text', content: '<system-reminder>literal</system-reminder>' }] }
          : section === 'source'
            ? { kind: 'message-source', label: 'Background Subagent', value: { kind: 'background_subagent', meta: { attempt: 1 } } }
            : 'message body'
      }
    }
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(TrajectoryInspector, inspectorProps(cell, loader)))
    })

    await openTab(renderer!, 'Raw')
    expect(calls).toEqual(['raw'])
    const rawMarkup = JSON.stringify(renderer!.toJSON())
    expect(rawMarkup).toContain('<system-reminder>literal</system-reminder>')
    expect(rawMarkup).not.toContain('thread-raw-source')

    await openTab(renderer!, 'Source')
    expect(calls).toEqual(['raw', 'source'])
    expect(renderer!.root.findByProps({ role: 'tree' })).toBeTruthy()
    const sourceMarkup = JSON.stringify(renderer!.toJSON())
    expect(sourceMarkup).toContain('background_subagent')
    expect(sourceMarkup).not.toContain('message body')
    expect(sourceMarkup).not.toContain('thread-raw-source')
  })

  it('does not expose a Source tab for Assistant or unavailable provenance', async () => {
    const assistant: TrajectoryRecord = {
      ...base,
      id: 'assistant:1',
      kind: 'assistant',
      itemId: 'assistant-1',
      itemIds: ['assistant-1'],
      preview: 'answer',
      sourceType: 'assistant',
      sourceAvailable: false
    }
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(TrajectoryInspector, inspectorProps(
        deriveHarnessLayout([assistant]).cells[0]!,
        async () => { throw new Error('loader must not run') }
      )))
    })
    expect(tabLabels(renderer!)).toEqual(['Summary', 'Preview', 'Raw'])
  })

  it('does not reuse detail cache entries across threads with the same record id', async () => {
    const record: TrajectoryRecord = {
      ...base,
      id: 'item:user-1',
      kind: 'user',
      itemId: 'user-1',
      itemIds: ['user-1'],
      preview: 'same record id',
      sourceAvailable: true
    }
    const cell = deriveHarnessLayout([record]).cells[0]!
    const calls: string[] = []
    const loader: typeof fetchTrajectoryDetail = async (threadId, recordId, section) => {
      calls.push(threadId)
      return {
        schemaVersion: 2,
        recordId,
        section,
        state: 'available',
        truncated: false,
        content: { kind: 'blocks', blocks: [{ type: 'text', content: `${threadId}-raw-content` }] }
      }
    }
    let renderer: ReactTestRenderer
    await act(async () => { renderer = create(createElement(TrajectoryInspector, inspectorProps(cell, loader, 'thread-a'))) })
    await openTab(renderer!, 'Raw')
    expect(JSON.stringify(renderer!.toJSON())).toContain('thread-a-raw-content')

    await act(async () => {
      renderer!.update(createElement(TrajectoryInspector, inspectorProps(cell, loader, 'thread-b')))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const markup = JSON.stringify(renderer!.toJSON())
    expect(calls).toEqual(['thread-a', 'thread-b'])
    expect(markup).toContain('thread-b-raw-content')
    expect(markup).not.toContain('thread-a-raw-content')
  })

  it('keeps the active tab and refreshes Raw while a running record grows', async () => {
    const runningRecord = (preview: string): TrajectoryRecord => ({
      ...base,
      id: 'assistant:running',
      kind: 'assistant',
      itemId: 'assistant-running',
      itemIds: ['assistant-running'],
      status: 'running',
      preview,
      sourceAvailable: false
    })
    const calls: number[] = []
    const loader: typeof fetchTrajectoryDetail = async (_threadId, recordId, section) => {
      const call = calls.push(calls.length + 1)
      return {
        schemaVersion: 2, recordId, section, state: 'available', truncated: false,
        content: { kind: 'blocks', blocks: [{ type: 'text', content: `live-${call}` }] }
      }
    }
    let renderer: ReactTestRenderer
    const firstCell = deriveHarnessLayout([runningRecord('first')]).cells[0]!
    await act(async () => { renderer = create(createElement(TrajectoryInspector, inspectorProps(firstCell, loader))) })
    await openTab(renderer!, 'Raw')
    expect(JSON.stringify(renderer!.toJSON())).toContain('live-1')

    const nextCell = deriveHarnessLayout([runningRecord('second')]).cells[0]!
    await act(async () => { renderer!.update(createElement(TrajectoryInspector, inspectorProps(nextCell, loader))) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(renderer!.toJSON())).toContain('live-2')
    expect(renderer!.root.findAllByProps({ role: 'tab' }).find((entry) => entry.children.join('') === 'Raw')?.props['aria-selected']).toBe(true)
  })

  it('offers an explicit retry after a detail request fails', async () => {
    const record: TrajectoryRecord = {
      ...base, id: 'item:retry', kind: 'user', itemId: 'retry', itemIds: ['retry'],
      preview: 'retry', sourceAvailable: true
    }
    let attempts = 0
    const loader: typeof fetchTrajectoryDetail = async (_threadId, recordId, section) => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary')
      return {
        schemaVersion: 2, recordId, section, state: 'available', truncated: false,
        content: { kind: 'blocks', blocks: [{ type: 'text', content: 'recovered' }] }
      }
    }
    let renderer: ReactTestRenderer
    await act(async () => { renderer = create(createElement(TrajectoryInspector, inspectorProps(deriveHarnessLayout([record]).cells[0]!, loader))) })
    await openTab(renderer!, 'Raw')
    const retry = renderer!.root.findAllByType('button').find((entry) => entry.children.join('') === 'Retry')
    expect(retry).toBeDefined()
    await act(async () => { retry!.props.onClick() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(attempts).toBe(2)
    expect(JSON.stringify(renderer!.toJSON())).toContain('recovered')
  })
})

function inspectorProps(
  cell: ReturnType<typeof deriveHarnessLayout>['cells'][number],
  loadDetail: typeof fetchTrajectoryDetail,
  threadId = 'thread-raw-source'
): Parameters<typeof TrajectoryInspector>[0] {
  return {
    threadId,
    cell,
    request: null,
    parentRequest: null,
    width: null,
    onWidthChange: () => undefined,
    onClose: () => undefined,
    onSelectParentRequest: () => undefined,
    loadDetail
  }
}

async function openTab(renderer: ReactTestRenderer, label: string): Promise<void> {
  const tab = renderer.root.findAllByProps({ role: 'tab' }).find((entry) => entry.children.join('') === label)
  if (!tab) throw new Error(`missing ${label} tab`)
  await act(async () => {
    tab.props.onClick()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

function tabLabels(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByProps({ role: 'tab' }).map((entry: ReactTestInstance) => entry.children.join(''))
}
