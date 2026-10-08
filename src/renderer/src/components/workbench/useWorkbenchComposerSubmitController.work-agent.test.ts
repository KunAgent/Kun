import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: <T>(callback: T): T => callback
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string): string => key })
}))

import type { ComposerContextAttachment } from '@kun/extension-api'
import type { PaperUnitMeta } from '@shared/paper/paper-meta-v2'
import { useChatStore } from '../../store/chat-store'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { clearWriteWorkspaceSaveQueueForTests } from '../../write/write-save-coordinator'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWorkbenchComposerSubmitController } from './useWorkbenchComposerSubmitController'
import {
  activateTextFile,
  controllerParams,
  type ControllerParams
} from './useWorkbenchComposerSubmitController.test-helpers'

const meta: PaperUnitMeta = {
  version: 2, slug: 'swe-explore', title: 'SWE-Explore', authors: ['Shaoqiu Zhang', 'Yuhang Wang'],
  year: '2026', arxivId: '2609.01481', pdfFile: 'paper.pdf', importedAt: '2026-10-09'
} as PaperUnitMeta

function useSendController(params: Partial<ControllerParams> = {}) {
  const sendMessage = vi.fn(async (..._args: Parameters<ControllerParams['sendMessage']>) => true)
  const controller = useWorkbenchComposerSubmitController(controllerParams({ sendMessage, ...params }))
  return { sendMessage, controller }
}

describe('Work assistant turns run on the composer Agent', () => {
  const initialChat = useChatStore.getState()
  const initialPaperMode = usePaperModeStore.getState()

  beforeEach(() => {
    vi.stubGlobal('window', { kunGui: {} })
    useChatStore.setState({ route: 'write', runtimeConnection: 'ready', composerHarnessId: '', composerCredentialMode: '' })
    activateTextFile()
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    clearWriteWorkspaceSaveQueueForTests()
    useChatStore.setState(initialChat, true)
    usePaperModeStore.setState(initialPaperMode, true)
    vi.unstubAllGlobals()
  })

  it('asks the store to route through the composer Agent instead of a Work-only model', async () => {
    useWriteWorkspaceStore.setState({ assistantModel: 'legacy-work-model', assistantProviderId: 'legacy' })
    const { sendMessage, controller } = useSendController({ composerMode: 'plan' })

    controller.sendWritePrompt('Outline this draft')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const [, mode, overrides] = sendMessage.mock.calls[0]!
    expect(mode).toBe('plan')
    expect(overrides).toMatchObject({ agentSurface: 'write', useComposerAgent: true })
    expect(overrides).not.toHaveProperty('model')
    expect(overrides).not.toHaveProperty('providerId')
  })

  it('sends a plain agent turn when an external Agent is picked (plan is a Kun workflow)', async () => {
    useChatStore.setState({ composerHarnessId: 'codex', composerCredentialMode: 'native-login' })
    const { sendMessage, controller } = useSendController({ composerMode: 'plan' })

    controller.sendWritePrompt('Outline this draft')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    expect(sendMessage.mock.calls[0]?.[1]).toBe('agent')
    expect(sendMessage.mock.calls[0]?.[2]).toMatchObject({ useComposerAgent: true })
  })

  it('carries the open paper, its text location and the reader page as context', async () => {
    useWriteWorkspaceStore.setState({
      activeFilePath: '/tmp/write/papers/swe/paper.pdf',
      activeFileKind: 'pdf',
      fileContent: '',
      persistedContent: '',
      entriesByDir: {
        '/tmp/write/papers/swe': [
          { name: 'paper.json', path: '/tmp/write/papers/swe/paper.json', type: 'file' },
          { name: 'paper.md', path: '/tmp/write/papers/swe/paper.md', type: 'file' },
          { name: 'paper.pdf', path: '/tmp/write/papers/swe/paper.pdf', type: 'file' }
        ]
      } as never
    })
    usePaperModeStore.setState({
      entries: [{ unitDir: 'papers/swe', meta } as never],
      readerPage: { unitDir: 'papers/swe', page: 3, pageCount: 20 }
    })
    const { sendMessage, controller } = useSendController()

    controller.sendWritePrompt('Summarize the contributions')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const contexts = (sendMessage.mock.calls[0]?.[2]?.composerContexts ?? []) as ComposerContextAttachment[]
    expect(contexts.find((context) => context.reference.kind === 'work-reference-paper')?.reference).toMatchObject({
      title: 'SWE-Explore',
      authors: ['Shaoqiu Zhang', 'Yuhang Wang'],
      arxivId: '2609.01481',
      unitLocator: 'papers/swe',
      textLocator: 'papers/swe/paper.md',
      pdfLocator: 'papers/swe/paper.pdf',
      page: 3,
      pageCount: 20
    })
    expect(contexts.find((context) => context.reference.kind === 'work-reference-resource')?.reference)
      .toMatchObject({ locator: 'papers/swe/paper.pdf', resourceKind: 'pdf' })
  })

  it('adds no paper context for an ordinary document', async () => {
    const { sendMessage, controller } = useSendController()

    controller.sendWritePrompt('Tighten the intro')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const contexts = (sendMessage.mock.calls[0]?.[2]?.composerContexts ?? []) as ComposerContextAttachment[]
    expect(contexts.some((context) => context.reference.kind === 'work-reference-paper')).toBe(false)
  })
})
