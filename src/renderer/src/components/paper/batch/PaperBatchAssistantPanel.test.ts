import { createElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaperBatchStore } from '../../../paper/paper-batch-store'
import { PaperBatchAssistantPanel } from './PaperBatchAssistantPanel'
import { button, change, click, entry, material, nodeText, render } from '../evidence/paper-evidence-test-support'
import en from '../../../locales/en/common/paper-batch.json'

const mocks = vi.hoisted(() => ({ start: vi.fn(), prepare: vi.fn(), cancel: vi.fn(), openResults: vi.fn(), workspaceRoot: '/library' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => {
  let value = (en as Record<string, string>)[key] ?? key
  for (const [name, content] of Object.entries(options ?? {})) value = value.replaceAll(`{{${name}}}`, String(content))
  return value
}, i18n: { language: 'en' } }) }))
vi.mock('../../../write/write-workspace-store-helpers', () => ({ normalizePath: (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '') }))
vi.mock('../../../store/chat-store', () => ({ useChatStore: (select: (state: unknown) => unknown) => select({ busy: false, runtimeConnection: 'ready', activeThreadId: null, currentTurnId: null }) }))
vi.mock('../../../write/write-workspace-store', () => ({ useWriteWorkspaceStore: (select: (state: { workspaceRoot: string }) => unknown) => select({ workspaceRoot: mocks.workspaceRoot }) }))
vi.mock('../../../paper/paper-batch-actions', () => ({
  startPaperBatch: mocks.start, preparePaperBatch: mocks.prepare, cancelPaperBatch: mocks.cancel, openPaperBatchArticle: vi.fn(), openPaperBatchConversation: mocks.openResults,
  paperBatchLimited: (item: { material?: typeof material }) => !item.material || item.material.abstractOnly || item.material.textPartial || item.material.sourceText.length > 80000
}))
let tree: ReactTestRenderer | undefined
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.workspaceRoot = '/library'
  usePaperBatchStore.setState({ batch: null })
  usePaperBatchStore.getState().stage('/library', [entry], 'Named library / group')
  const id = usePaperBatchStore.getState().batch!.id
  usePaperBatchStore.getState().updateItem(id, entry.unitDir, { materialState: 'ready', material })
})
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })
const panel = (providerId = 'work-provider', model = 'work-model') => createElement(PaperBatchAssistantPanel, { providerId, model })

describe('paper batch review panel', () => {
  it('shows titled papers, source, destination and honest request-cost bounds before consent', async () => {
    tree = await render(panel())
    const text = nodeText(tree.root)
    expect(text).toContain('Paper A')
    expect(text).toContain('Named library / group')
    expect(text).toContain('work-provider / work-model')
    expect(text).toContain('monetary estimate is unavailable')
    expect(text).toContain('one per paper')
    expect(button(tree, 'Start batch').props.disabled).toBe(true)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(tree.root.findAllByType('select')).toHaveLength(2)
  })
  it('submits only after explicit consent and uses the Work model props', async () => {
    tree = await render(panel())
    await change(tree.root.findByProps({ type: 'checkbox' }), true)
    expect(button(tree, 'Start batch').props.disabled).toBe(false)
    await click(tree, 'Start batch')
    expect(mocks.start).toHaveBeenCalledWith({ providerId: 'work-provider', model: 'work-model', language: 'en' })
  })
  it('invalidates consent when the Work model changes or a paper is removed', async () => {
    tree = await render(panel())
    await change(tree.root.findByProps({ type: 'checkbox' }), true)
    await act(async () => tree!.update(panel('changed', 'new-model')))
    expect(tree.root.findByProps({ type: 'checkbox' }).props.checked).toBe(false)
    await change(tree.root.findByProps({ type: 'checkbox' }), true)
    await act(async () => tree!.root.findByProps({ 'aria-label': 'Remove Paper A from batch' }).props.onClick())
    expect(nodeText(tree.root)).toContain('No papers selected')
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('close only dismisses the staged batch without invoking execution', async () => {
    tree = await render(panel())
    await act(async () => tree!.root.findByProps({ 'aria-label': 'close' }).props.onClick())
    expect(usePaperBatchStore.getState().batch).toBeNull()
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('keeps progress and cancellation available while execution is active', async () => {
    const batch = usePaperBatchStore.getState().batch!
    usePaperBatchStore.getState().update(batch.id, { phase: 'running', threadId: 'thread', providerId: 'frozen-provider', model: 'frozen-model' })
    tree = await render(panel())
    expect(nodeText(tree.root)).toContain('frozen-provider / frozen-model')
    expect(tree.root.findByType('progress').props.value).toBe(0)
    expect(tree.root.findByProps({ 'aria-label': 'close' }).props.disabled).toBe(true)
    expect(tree.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0)
    await click(tree, 'Cancel remaining work')
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })
  it('never allows a staged batch to run against a different library', async () => {
    mocks.workspaceRoot = '/other'
    tree = await render(panel())
    await change(tree.root.findByProps({ type: 'checkbox' }), true)
    expect(button(tree, 'Start batch').props.disabled).toBe(true)
    expect(nodeText(tree.root)).toContain('Return to the source library')
  })
})
