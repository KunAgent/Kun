import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { HandoffBriefDetail } from './message-timeline-handoff-entry'

const mocks = vi.hoisted(() => ({ preview: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({ getHandoffPreview: mocks.preview }) }))
vi.mock('../../store/chat-store', () => ({ useChatStore: (select: (state: unknown) => unknown) => select({ activeThreadId: 'thread' }) }))
let view: ReactTestRenderer | undefined
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined; vi.unstubAllGlobals() })

it('shows loading while the handoff preview is pending and then renders the response', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let resolve!: (value: { brief: string }) => void
  mocks.preview.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  await act(async () => { view = create(createElement(HandoffBriefDetail, { block: {
    kind: 'handoff', id: 'handoff', turnId: 'turn', reason: 'harness-switch', handoffMode: 'full',
    toHarnessName: 'Codex', recentTurns: 1, files: 0, briefDigest: 'digest'
  } as never })) })
  expect(view!.root.findByProps({ role: 'status' })).toBeTruthy()
  expect(JSON.stringify(view!.toJSON())).not.toContain('adeHandoffLoadError')
  await act(async () => resolve({ brief: 'Previous conversation context' }))
  expect(view!.root.findByType('pre').children.join('')).toBe('Previous conversation context')
  expect(mocks.preview).toHaveBeenCalledWith('thread', 'turn')
})
