import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(), useCallback: <T>(callback: T): T => callback
}))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() }, useTranslation: () => ({ t: (key: string): string => key })
}))
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { clearWriteWorkspaceSaveQueueForTests } from '../../write/write-save-coordinator'
import { setProductCapture } from '../../product-analytics/client'
import { clearWorkAnalytics } from '../../product-analytics/work'
import { useWorkbenchComposerSubmitController } from './useWorkbenchComposerSubmitController'
import { activateTextFile, controllerParams } from './useWorkbenchComposerSubmitController.test-helpers'

const EPOCH = '0a937dda-cee5-462d-9fca-5abc6f514efd'
const track = vi.fn(async (_event: unknown, _epoch?: string) => {})
let initialChat: ReturnType<typeof useChatStore.getState>
beforeEach(() => {
  initialChat = useChatStore.getState()
  vi.stubGlobal('window', { kunGui: { productAnalytics: { track } } })
  vi.stubGlobal('crypto', webcrypto)
  useChatStore.setState({ route: 'write', runtimeConnection: 'ready', composerHarnessId: '', composerCredentialMode: '' })
  activateTextFile(); setProductCapture(false); clearWorkAnalytics(); track.mockClear()
})
afterEach(() => {
  setProductCapture(false); clearWorkAnalytics()
  useWriteWorkspaceStore.getState().resetWorkspace(); clearWriteWorkspaceSaveQueueForTests()
  useChatStore.setState(initialChat, true); vi.unstubAllGlobals()
})

describe('Work composer optional analytics contract', () => {
  it('leaves the existing send payload and pre-send save untracked without consent', async () => {
    const params = controllerParams()
    useWorkbenchComposerSubmitController(params).sendWritePrompt('Private draft')
    await vi.waitFor(() => expect(params.sendMessage).toHaveBeenCalledOnce())
    const options = vi.mocked(params.sendMessage).mock.calls[0][2]
    expect(options).not.toHaveProperty('clientRequestId')
    expect(options).toMatchObject({ agentSurface: 'write', useComposerAgent: true })
    expect(track).not.toHaveBeenCalled()
  })

  it('passes one consent marker to admission and keeps document autosave outside adoption', async () => {
    setProductCapture(true, EPOCH)
    const params = controllerParams()
    useWorkbenchComposerSubmitController(params).sendWritePrompt('Private draft')
    await vi.waitFor(() => expect(params.sendMessage).toHaveBeenCalledOnce())
    expect(vi.mocked(params.sendMessage).mock.calls[0][2]?.clientRequestId).toMatch(new RegExp(`^turn_work_${EPOCH}_`))
    await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(2))
    expect(track.mock.calls.map(([event]) => (event as { name: string }).name)).toEqual(['work_task_submitted', 'work_submission_finished'])
    expect(JSON.stringify(track.mock.calls)).not.toContain('Private draft')
    expect(JSON.stringify(track.mock.calls)).not.toContain('/tmp/write')
  })

  it('records local rejection without turning it into an execution failure or clearing the prompt', async () => {
    setProductCapture(true, EPOCH)
    const params = controllerParams({ sendMessage: vi.fn(async () => false) })
    useWorkbenchComposerSubmitController(params).sendWritePrompt('Keep this prompt')
    await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(2))
    expect(track.mock.calls[1][0]).toMatchObject({ name: 'work_submission_finished', properties: { requestOutcome: 'failed' } })
    expect(params.setInput).toHaveBeenCalledWith(expect.any(Function))
  })

  it('does not treat a blank send or startup draft restore as a user task', () => {
    setProductCapture(true, EPOCH)
    const params = controllerParams()
    useWorkbenchComposerSubmitController(params).sendWritePrompt('   ')
    expect(params.sendMessage).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })
})
