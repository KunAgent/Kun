// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { trajectoryDetailSchema, type TrajectoryRecord } from '../../agent/trajectory'
import { AssistantMarkdown } from '../chat/AssistantMarkdown'
import { TrajectoryInspector } from './TrajectoryInspector'
import { deriveHarnessLayout } from './trajectory-harness-model'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../chat/AssistantMarkdown', () => ({ AssistantMarkdown: () => null }))

let view: ReactTestRenderer | undefined
afterEach(async () => {
  if (view) await act(async () => view!.unmount())
  view = undefined
  vi.unstubAllGlobals()
})

describe('trajectory preview render policy', () => {
  it.each(['safe-markdown', 'plain-text', undefined] as const)('passes %s through the parsed detail to AssistantMarkdown', async (renderMode) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const record: TrajectoryRecord = {
      schemaVersion: 2, id: 'assistant:one', kind: 'assistant', threadId: 'thread', turnId: 'turn',
      roundId: 'round', step: 0, status: 'completed', detailState: 'available',
      startedAt: '2026-01-01T00:00:00.000Z', thinkingPreview: '', attachmentIds: [],
      itemId: 'one', itemIds: ['one'], preview: '# Answer'
    }
    await act(async () => {
      view = create(createElement(TrajectoryInspector, {
        threadId: 'thread', cell: deriveHarnessLayout([record]).cells[0]!,
        request: null, parentRequest: null, width: null,
        onWidthChange: () => undefined, onClose: () => undefined, onSelectParentRequest: () => undefined,
        loadDetail: async (_threadId, recordId, section) => trajectoryDetailSchema.parse({
          schemaVersion: 2, recordId, section, state: 'available', truncated: false,
          content: '# Answer\n\n![pixel](https://attacker.invalid)', renderMode
        })
      }))
    })
    await act(async () => {
      view!.root.findAllByProps({ role: 'tab' })
        .find((tab) => tab.children.join('') === 'trajectoryTabPreview')!.props.onClick()
    })
    const preview = view!.root.findByType(AssistantMarkdown)
    expect(preview.props).toMatchObject({
      text: '# Answer\n\n![pixel](https://attacker.invalid)', streaming: false,
      className: expect.stringContaining('ds-markdown'),
      safeMarkdown: renderMode === 'safe-markdown', plainText: renderMode === 'plain-text'
    })
  })
})
