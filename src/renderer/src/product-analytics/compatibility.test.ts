// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProductAnalyticsConsent } from './PrivacyControl'
import { FirstTaskGuide } from './FirstTaskGuide'
import { queueFirstTaskPrompt, takeFirstTaskPrompt } from './first-task-prompt'
const mocks = vi.hoisted(() => ({ choose: vi.fn(), create: vi.fn(), open: vi.fn(), picker: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }))
vi.mock('../lib/workspace-label', () => ({ isDefaultWorkspacePath: () => false }))
vi.mock('../store/chat-store', () => ({ useChatStore: { getState: () => ({ busy: false,
  workspaceRoot: '/workspace/project', chooseWorkspace: mocks.choose, createThread: mocks.create, openCode: mocks.open }) } }))
vi.mock('../components/rooms/agent-chat-picker', () => ({ openAgentChatDialog: mocks.picker }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => { await act(async () => { roots.splice(0).forEach(root => root.unmount()) }); document.body.innerHTML = ''; vi.clearAllMocks() })
async function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root)
  await act(async () => root.render(node)); return host
}
function bridge() {
  const api = { getState: vi.fn(async () => ({ enabled: false, installation: 'existing', available: false, guidance: false })),
    setEnabled: vi.fn(), guidance: vi.fn(async () => true), track: vi.fn(async () => {}) }
  ;(window as any).kunGui = { productAnalytics: api }; return api
}
describe('legacy onboarding isolation', () => {
  it('does not show a new consent prompt during existing-user setup', async () => {
    const api=bridge(); const host=await render(createElement(ProductAnalyticsConsent,{freshOnly:true}))
    expect(host.textContent).toBe(''); expect(api.setEnabled).not.toHaveBeenCalled(); expect(api.track).not.toHaveBeenCalled()
  })
  it('requires an explicit click before eligibility requests and never sends a task',async()=>{
    const api=bridge();const host=await render(createElement(FirstTaskGuide))
    expect(api.guidance).not.toHaveBeenCalled()
    await act(async()=>{(host.querySelector('button') as HTMLButtonElement).click()})
    expect(api.guidance).toHaveBeenCalledOnce()
    const room=[...host.querySelectorAll('button')].find(button=>button.textContent?.startsWith('Room:'))!
    await act(async()=>{room.click()})
    expect(mocks.picker).toHaveBeenCalledWith('picker');expect(mocks.create).not.toHaveBeenCalled()
  })
  it('an older server leaves the existing flow available',async()=>{
    const api=bridge();api.guidance.mockResolvedValue(false);const host=await render(createElement(FirstTaskGuide))
    await act(async()=>{(host.querySelector('button') as HTMLButtonElement).click()})
    expect(host.textContent).toContain('not available yet');expect(mocks.create).not.toHaveBeenCalled()
  })
  it('binds delayed starter prompts to the chosen thread, without sending',()=>{
    queueFirstTaskPrompt('new-thread','read-only prompt')
    expect(takeFirstTaskPrompt('old-thread')).toBeNull()
    expect(takeFirstTaskPrompt('new-thread')).toBe('read-only prompt')
    expect(takeFirstTaskPrompt('new-thread')).toBeNull()
  })
})
