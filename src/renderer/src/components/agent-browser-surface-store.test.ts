import { beforeEach, expect, it } from 'vitest'
import { useAgentBrowserSurfaceStore, type AgentBrowserSurface } from './agent-browser-surface-store'

beforeEach(() => useAgentBrowserSurfaceStore.setState({ byThreadId: {} }))
const surface = (owner: symbol): AgentBrowserSurface => ({
  owner, threadId: 'thread', sessionId: 'session', turnId: 'turn', variant: 'pip',
  rect: { x: 10, y: 20, width: 320, height: 200 }
})

it('hands a page to another slot without a hidden interval or a retired slot taking it back', async () => {
  const store = useAgentBrowserSurfaceStore.getState()
  const floating = surface(Symbol('floating'))
  const panel = { ...surface(Symbol('panel')), variant: 'full' as const }
  store.claim(floating)
  store.release('thread', floating.owner)
  expect(useAgentBrowserSurfaceStore.getState().byThreadId.thread).toBe(floating)
  store.claim(panel)
  store.present({ ...floating, rect: { ...floating.rect, x: 99 } })
  await Promise.resolve()
  expect(useAgentBrowserSurfaceStore.getState().byThreadId.thread).toBe(panel)
  store.release('thread', panel.owner)
  await Promise.resolve()
  expect(useAgentBrowserSurfaceStore.getState().byThreadId.thread).toBeUndefined()
})
