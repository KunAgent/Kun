import { createElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperReadingDialog, PaperReadingDialogHost } from './PaperReadingDialog'
import { PaperSynthesisDialog } from './PaperSynthesisDialog'
import { usePaperReadingRequest } from '../../../paper/paper-reading-request'
import { button, change, click, deferred, entry, evidence, hash, material, nodeText, render } from './paper-evidence-test-support'

const state = vi.hoisted(() => ({
  chat: { composerProviderId: 'configured-provider', composerModel: 'selected-model', error: '',
    ensureWriteThreadForWorkspace: vi.fn(), sendMessage: vi.fn() },
  workspace: { workspaceRoot: '/library', setAssistantOpen: vi.fn() }
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('../../../store/chat-store', () => ({ useChatStore: Object.assign(
  (select: (value: typeof state.chat) => unknown) => select(state.chat), { getState: () => state.chat }) }))
vi.mock('../../../write/write-workspace-store', () => ({
  useWriteWorkspaceStore: { getState: () => state.workspace }, writeJoinPath: (a: string, b: string) => `${a}/${b}`
}))
vi.mock('../../../paper/paper-evidence-actions', () => ({ inspectPaperEvidence: vi.fn(), paperEvidenceCitation: () => 'Saved evidence citation' }))

let tree: ReactTestRenderer | undefined
let api: { paperEvidenceMaterial: ReturnType<typeof vi.fn>; paperEvidenceRead: ReturnType<typeof vi.fn> }
const request = { workspaceRoot: '/library', unitDir: entry.unitDir, meta: entry.meta, question: 'What supports this claim?' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.chat.composerProviderId = 'configured-provider'
  state.chat.composerModel = 'selected-model'
  state.chat.ensureWriteThreadForWorkspace.mockResolvedValue('thread-a')
  state.chat.sendMessage.mockResolvedValue(true)
  state.workspace.workspaceRoot = '/library'
  api = { paperEvidenceMaterial: vi.fn(async () => material), paperEvidenceRead: vi.fn(async () => ({ ok: true, revision: 1, items: [evidence] })) }
  vi.stubGlobal('window', { kunGui: api })
  usePaperReadingRequest.setState({ request: null })
})
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })

async function consent(): Promise<void> {
  await change(tree!.root.findByProps({ type: 'radio', value: 'model-provider' }), true)
}

describe('PaperReadingDialog bounded consent', () => {
  it('defaults to local-only and performs no model or thread call even if submit callback is invoked', async () => {
    tree = await render(createElement(PaperReadingDialog, { request, onClose: vi.fn() }))
    expect(tree.root.findByProps({ type: 'radio', value: 'local-only' }).props.checked).toBe(true)
    expect(button(tree, 'paperReadingStart').props.disabled).toBe(true)
    await click(tree, 'paperReadingStart')
    expect(state.chat.ensureWriteThreadForWorkspace).not.toHaveBeenCalled()
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
  })

  it.each(['invalid-unit', 'io', 'corrupt-identity'])('does not send a cached abstract after a failed %s material read', async (code) => {
    api.paperEvidenceMaterial.mockResolvedValue({ ok: false, code, message: 'Current source could not be verified' })
    tree = await render(createElement(PaperReadingDialog, { request: { ...request,
      meta: { ...request.meta, abstract: 'A stale cached abstract must not be sent' } }, onClose: vi.fn() }))
    await consent()
    expect(button(tree, 'paperReadingStart').props.disabled).toBe(true)
    await click(tree, 'paperReadingStart')
    expect(state.chat.ensureWriteThreadForWorkspace).not.toHaveBeenCalled()
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
    expect(nodeText(tree.root)).toContain('Current source could not be verified')
  })

  it.each(['close', 'Escape'])('closing with %s never dispatches a model turn', async (how) => {
    const onClose = vi.fn()
    tree = await render(createElement(PaperReadingDialog, { request, onClose }))
    await consent()
    if (how === 'close') await click(tree, 'close')
    else await act(async () => tree!.root.findAllByType('div')[0].props.onKeyDown({ key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
    expect(state.chat.ensureWriteThreadForWorkspace).not.toHaveBeenCalled()
  })

  it('freezes exactly the chosen passage and explicit provider/model; repeated clicks submit once', async () => {
    const pending = deferred<string>()
    state.chat.ensureWriteThreadForWorkspace.mockImplementation(() => pending.promise)
    const onClose = vi.fn()
    tree = await render(createElement(PaperReadingDialog, { request: { ...request,
      selection: { text: 'A selected claim with 2.3 ms, not 10%.', page: 4, pdfSha256: hash } }, onClose }))
    await consent()
    const start = button(tree, 'paperReadingStart').props.onClick
    await act(async () => { start(); start() })
    expect(state.chat.ensureWriteThreadForWorkspace).toHaveBeenCalledTimes(1)
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
    await act(async () => pending.resolve('thread-a'))
    expect(state.chat.sendMessage).toHaveBeenCalledTimes(1)
    expect(state.chat.sendMessage).toHaveBeenCalledWith(expect.stringContaining(request.question), 'agent', {
      agentSurface: 'write', expectedThreadId: 'thread-a', waitForRuntimeAdmission: true,
      paperContext: { version: 1, scope: 'selected-passage', privacy: 'model-provider', purpose: 'quick-screen',
        providerId: 'configured-provider', model: 'selected-model', maxModelRequests: 1,
        sources: [{ paperId: evidence.paperVersion.canonicalId, title: entry.meta.title, locator: 'selected passage starting on page 4', sourceVersion: hash,
          text: 'A selected claim with 2.3 ms, not 10%.' }] }
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('never borrows the current disk hash for an unhashed selected passage', async () => {
    tree = await render(createElement(PaperReadingDialog, { request: { ...request,
      selection: { text: 'A selection whose viewer hash is not ready', page: 4 } }, onClose: vi.fn() }))
    await consent()
    expect(button(tree, 'paperReadingStart').props.disabled).toBe(true)
    await click(tree, 'paperReadingStart')
    expect(state.chat.ensureWriteThreadForWorkspace).not.toHaveBeenCalled()
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
  })

  it('blocks a selected passage whose viewer version differs from current material', async () => {
    api.paperEvidenceMaterial.mockResolvedValue({ ...material, paperVersion: { ...evidence.paperVersion, pdfSha256: 'b'.repeat(64) } })
    tree = await render(createElement(PaperReadingDialog, { request: { ...request,
      selection: { text: 'A selection from the previous PDF', page: 4, pdfSha256: hash } }, onClose: vi.fn() }))
    await consent()
    expect(button(tree, 'paperReadingStart').props.disabled).toBe(true)
    await click(tree, 'paperReadingStart')
    expect(state.chat.ensureWriteThreadForWorkspace).not.toHaveBeenCalled()
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
  })

  it.each(['textPartial', 'abstractOnly'] as const)('blocks deeper reading for %s while permitting labeled quick screening', async (flag) => {
    api.paperEvidenceMaterial.mockResolvedValue({ ...material, [flag]: true })
    tree = await render(createElement(PaperReadingDialog, { request, onClose: vi.fn() }))
    await consent()
    for (const purpose of ['method-deep-read', 'reproduction-prep', 'review-critique']) {
      await change(tree.root.findByType('select'), purpose)
      expect(button(tree, 'paperReadingStart').props.disabled).toBe(true)
      await click(tree, 'paperReadingStart')
    }
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
    await change(tree.root.findByType('select'), 'quick-screen')
    await click(tree, 'paperReadingStart')
    expect(state.chat.sendMessage.mock.calls[0][0]).toContain('limited-material screening')
  })

  it('falls back to labeled metadata-only screening when PDF material is missing', async () => {
    api.paperEvidenceMaterial.mockResolvedValue({ ...material, paperVersion: null,
      sourceText: 'Fresh local abstract from the requested unit', pageCount: 0,
      extractedPages: [], missingTextPages: [], textPartial: true, abstractOnly: true })
    tree = await render(createElement(PaperReadingDialog, { request: { ...request,
      meta: { ...request.meta, abstract: 'Stale cached metadata must not be used' } }, onClose: vi.fn() }))
    expect(nodeText(tree.root)).toContain('paperReadingAbstractOnly')
    await consent()
    await click(tree, 'paperReadingStart')
    expect(state.chat.sendMessage.mock.calls[0][2].paperContext.sources[0].text).toBe('Fresh local abstract from the requested unit')
    expect(state.chat.sendMessage.mock.calls[0][0]).toContain('limited-material screening')
  })

  it('checks the active library again after asynchronous thread creation', async () => {
    const pending = deferred<string>()
    state.chat.ensureWriteThreadForWorkspace.mockImplementation(() => pending.promise)
    tree = await render(createElement(PaperReadingDialog, { request, onClose: vi.fn() }))
    await consent()
    await click(tree, 'paperReadingStart')
    state.workspace.workspaceRoot = '/other-library'
    await act(async () => pending.resolve('thread-a'))
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
    expect(tree.root.findByProps({ role: 'alert' }).children).toEqual(['The paper conversation is no longer available.'])
  })

  it('keeps the dialog and error visible until runtime admission succeeds', async () => {
    state.chat.sendMessage.mockResolvedValue(false)
    const onClose = vi.fn()
    tree = await render(createElement(PaperReadingDialog, { request, onClose }))
    await consent()
    await click(tree, 'paperReadingStart')
    expect(onClose).not.toHaveBeenCalled()
    expect(tree.root.findByProps({ role: 'alert' }).children.join('')).toContain('not admitted')
  })

  it('replaces the question and resets consent when a new request targets the same paper/page', async () => {
    usePaperReadingRequest.getState().open(request)
    tree = await render(createElement(PaperReadingDialogHost))
    await consent()
    await act(async () => usePaperReadingRequest.getState().open({ ...request, question: 'A different question' }))
    expect(tree.root.findByType('textarea').props.value).toBe('A different question')
    expect(tree.root.findByProps({ type: 'radio', value: 'local-only' }).props.checked).toBe(true)
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
  })

  it('abandons pending thread admission when another reading request replaces the old dialog', async () => {
    const pending = deferred<string>()
    state.chat.ensureWriteThreadForWorkspace.mockImplementation(() => pending.promise)
    usePaperReadingRequest.getState().open(request)
    tree = await render(createElement(PaperReadingDialogHost))
    await consent()
    await click(tree, 'paperReadingStart')
    const next = { ...request, question: 'The next independent request' }
    await act(async () => usePaperReadingRequest.getState().open(next))
    await act(async () => pending.resolve('obsolete-thread'))
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
    expect(usePaperReadingRequest.getState().request).toEqual(next)
    expect(tree.root.findByType('textarea').props.value).toBe(next.question)
    expect(tree.root.findByProps({ type: 'radio', value: 'local-only' }).props.checked).toBe(true)
  })
})

describe('PaperSynthesisDialog frozen selection', () => {
  const synthesis = { ...request, synthesis: 'compare' as const, papers: [{ unitDir: entry.unitDir, meta: entry.meta }] }

  it('requires explicit consent and closing the dialog does not start a turn', async () => {
    const onClose = vi.fn()
    tree = await render(createElement(PaperSynthesisDialog, { request: synthesis, onClose }))
    expect(button(tree, 'paperReadingStart').props.disabled).toBe(true)
    await click(tree, 'paperReadingStart')
    await click(tree, 'close')
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch incomplete or corrupt evidence reads', async () => {
    api.paperEvidenceRead.mockResolvedValue({ ok: false, code: 'corrupt-store', message: 'Evidence store needs repair' })
    tree = await render(createElement(PaperSynthesisDialog, { request: synthesis, onClose: vi.fn() }))
    await change(tree.root.findByProps({ type: 'checkbox' }), true)
    expect(button(tree, 'paperReadingStart').props.disabled).toBe(true)
    await click(tree, 'paperReadingStart')
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
    expect(tree.root.findByProps({ role: 'alert' }).children).toEqual(['Evidence store needs repair'])
  })

  it('submits one read-only, source-bounded comparison with saved manual evidence', async () => {
    tree = await render(createElement(PaperSynthesisDialog, { request: synthesis, onClose: vi.fn() }))
    await change(tree.root.findByProps({ type: 'checkbox' }), true)
    const start = button(tree, 'paperReadingStart').props.onClick
    await act(async () => { start(); start() })
    expect(state.chat.sendMessage).toHaveBeenCalledTimes(1)
    const [text, mode, options] = state.chat.sendMessage.mock.calls[0]
    expect(mode).toBe('agent')
    expect(text).toContain('Do not change existing notes or matrices')
    expect(options.paperContext).toMatchObject({ scope: 'multi-paper', maxModelRequests: 1, privacy: 'model-provider' })
    expect(options.paperContext.sources[0].text).toContain('Saved evidence citation')
  })

  it('does not retain consent or old sources while a changed selection is loading', async () => {
    tree = await render(createElement(PaperSynthesisDialog, { request: synthesis, onClose: vi.fn() }))
    await change(tree.root.findByProps({ type: 'checkbox' }), true)
    const pending = deferred<unknown>()
    api.paperEvidenceMaterial.mockImplementation(() => pending.promise)
    await act(async () => tree!.update(createElement(PaperSynthesisDialog, { request: { ...synthesis,
      papers: [{ unitDir: 'papers/b', meta: { ...entry.meta, title: 'Paper B' } }] }, onClose: vi.fn() })))
    expect(button(tree, 'paperReadingStart').props.disabled).toBe(true)
    expect(tree.root.findByProps({ type: 'checkbox' }).props.checked).toBe(false)
    await act(async () => pending.resolve({ ...material, sourceText: 'Paper B source' }))
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
  })

  it('abandons pending synthesis admission when a new request replaces the dialog', async () => {
    const pending = deferred<string>()
    state.chat.ensureWriteThreadForWorkspace.mockImplementation(() => pending.promise)
    usePaperReadingRequest.getState().open(synthesis)
    tree = await render(createElement(PaperReadingDialogHost))
    await change(tree.root.findByProps({ type: 'checkbox' }), true)
    await click(tree, 'paperReadingStart')
    const next = { ...synthesis, synthesis: 'related-work' as const }
    await act(async () => usePaperReadingRequest.getState().open(next))
    await act(async () => pending.resolve('obsolete-thread'))
    expect(state.chat.sendMessage).not.toHaveBeenCalled()
    expect(usePaperReadingRequest.getState().request).toEqual(next)
    expect(tree.root.findByProps({ type: 'checkbox' }).props.checked).toBe(false)
  })
})
