import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContentsView } from 'electron'
import { BrowserUseManager } from './browser-use-manager'
import type { KunBrowserUseSettingsV1 } from '../../shared/app-settings'
import { BrowserUseViewStateSchema, BrowserUseMountInputSchema } from '../../shared/browser-use'

vi.mock('electron', () => ({ BrowserWindow: class {}, WebContentsView: class {} }))
const settings: KunBrowserUseSettingsV1 = {
  enabled: true, mode: 'public', approvalMode: 'auto-safe', maxTabs: 2,
  maxObservationActionsPerTurn: 30, maxInteractionActionsPerTurn: 12,
  maxSnapshotNodes: 250, maxSnapshotTextChars: 20_000, maxImageDimension: 1280, idleTimeoutMs: 300_000
}
class HarnessManager extends BrowserUseManager {
  seed() {
    const entry = this.createSession('thread', settings)
    entry.activeTurnId = 'new-turn'
    return entry
  }
}
const cleanup: HarnessManager[] = []
afterEach(async () => { for (const manager of cleanup.splice(0)) await manager.disposeAll() })
function fixture() {
  const manager = new HarnessManager({ settings: () => settings }), entry = manager.seed()
  cleanup.push(manager)
  const children: WebContentsView[] = []
  const window = { contentView: { children, addChildView: (view: WebContentsView) => children.push(view),
    removeChildView: (view: WebContentsView) => children.splice(children.indexOf(view), 1) }, getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    isDestroyed: () => false, webContents: { getZoomFactor: () => 1, isDestroyed: () => false, send: vi.fn() } } as unknown as BrowserWindow
  const bounds = { x: 0, y: 0, width: 500, height: 300 }
  manager.mount('thread', window, bounds, true, true)
  return { manager, entry, window, bounds }
}
it('publishes exact active turn identity and preserves legacy thread-only callers', () => {
  const f = fixture()
  expect(BrowserUseViewStateSchema.parse(f.manager.stateForThread('thread'))).toMatchObject({ threadId: 'thread', turnId: 'new-turn' })
  expect(f.manager.setControlOwner('thread', 'manual').controlOwner).toBe('manual')
  expect(BrowserUseMountInputSchema.parse({ threadId: 'thread', expectedTurnId: 'new-turn',
    visible: true, supervisionActive: true, bounds: f.bounds })).toHaveProperty('expectedTurnId', 'new-turn')
})
it('rejects old mount cleanup before hiding or de-supervising a newer turn', () => {
  const f = fixture(), mount = f.entry.mount
  expect(() => f.manager.mount('thread', f.window, f.bounds, false, false, 'old-turn')).toThrow('turn')
  expect(f.entry.mount).toBe(mount)
  expect(f.entry.mount).toMatchObject({ visible: true, supervisionActive: true })
  expect(f.manager.mount('thread', f.window, f.bounds, false, false, 'new-turn').visible).toBe(false)
})
it('rejects stale state/control/navigation/stop/clear and consent before any mutation', async () => {
  const f = fixture(), resolve = vi.fn(), id = 'decision-request-identifier'
  f.entry.pendingOriginDecision = { id, resolve, promise: Promise.resolve('deny') } as never
  f.entry.pendingActionDecision = { id, resolve, promise: Promise.resolve('deny') } as never
  const generation = f.entry.documentGeneration, audit = f.manager.auditSnapshot()
  expect(f.manager.stateForThread('thread', 'old-turn')).toMatchObject({ lifecycle: 'closed', tabs: [], visible: false, mounted: false })
  expect(f.manager.stateForThread('thread', 'old-turn').sessionId).toBeUndefined()
  expect(() => f.manager.setControlOwner('thread', 'manual', 'old-turn')).toThrow('turn')
  expect(() => f.manager.navigate('thread', 'reload', 'old-turn')).toThrow('turn')
  expect(() => f.manager.stop('thread', 'old-turn')).toThrow('turn')
  await expect(f.manager.clear('thread', 'cleared', 'old-turn')).rejects.toThrow('turn')
  expect(() => f.manager.decideOrigin({ threadId: 'thread', expectedTurnId: 'old-turn', requestId: id, decision: 'allow-once' })).toThrow('turn')
  expect(() => f.manager.decideAction({ threadId: 'thread', expectedTurnId: 'old-turn', requestId: id, decision: 'allow-once' })).toThrow('turn')
  expect(resolve).not.toHaveBeenCalled()
  expect(f.entry).toMatchObject({ stopping: false, controlOwner: 'agent', documentGeneration: generation })
  expect(f.manager.auditSnapshot()).toEqual(audit)
  expect(f.manager.stateForThread('thread', 'new-turn').turnId).toBe('new-turn')
  expect(f.manager.decideOrigin({ threadId: 'thread', expectedTurnId: 'new-turn', requestId: id, decision: 'deny' })).toHaveProperty('turnId', 'new-turn')
  expect(resolve).toHaveBeenCalledWith('deny')
})
it('does not let an expected turn bind a legacy session without an active turn', () => {
  const f = fixture()
  f.entry.activeTurnId = undefined
  expect(() => f.manager.mount('thread', f.window, f.bounds, true, true, 'new-turn')).toThrow('turn')
  expect(() => f.manager.stop('thread', 'new-turn')).toThrow('turn')
})
it('retires the previous turn-bound mount on turnover and protects a later remount from old cleanup', async () => {
  const f = fixture(), setVisible = vi.fn()
  const view = { setVisible, setBounds: vi.fn(), webContents: { setIgnoreMenuShortcuts: vi.fn(), isDestroyed: () => false,
    stop: vi.fn(), close: vi.fn(), getURL: () => 'https://example.com/', getTitle: () => 'Example',
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    session: { closeAllConnections: async () => {}, clearCache: async () => {}, clearStorageData: async () => {} } } } as unknown as WebContentsView
  f.entry.tabs.set('tab', { id: 'tab', loading: false, view })
  f.entry.activeTabId = 'tab'
  f.manager.mount('thread', f.window, f.bounds, true, true, 'new-turn')
  expect(setVisible).toHaveBeenLastCalledWith(true)
  await f.manager.execute('thread', 'next-turn', { action: 'tabs', operation: 'list' })
  expect(f.entry.mount).toMatchObject({ visible: false, supervisionActive: false, expectedTurnId: 'new-turn' })
  expect(setVisible).toHaveBeenLastCalledWith(false)
  expect(f.manager.stateForThread('thread')).toMatchObject({ turnId: 'next-turn', visible: false })
  expect(() => f.manager.mount('thread', f.window, f.bounds, false, false, 'new-turn')).toThrow('turn')
  f.manager.mount('thread', f.window, f.bounds, true, true, 'next-turn')
  expect(() => f.manager.mount('thread', f.window, f.bounds, false, false, 'new-turn')).toThrow('turn')
  expect(f.entry.mount).toMatchObject({ visible: true, supervisionActive: true, expectedTurnId: 'next-turn' })
  expect(setVisible).toHaveBeenLastCalledWith(true)
})
it('retains unguarded Code mounts across turn changes', async () => {
  const f = fixture()
  await f.manager.execute('thread', 'next-turn', { action: 'tabs', operation: 'list' })
  expect(f.entry.mount).toMatchObject({ visible: true, supervisionActive: true })
})
it('does not rebind the active turn for an already aborted late tool call', async () => {
  const f = fixture(), controller = new AbortController()
  controller.abort()
  await f.manager.execute('thread', 'old-turn', { action: 'tabs', operation: 'list' }, controller.signal)
  expect(f.manager.stateForThread('thread').turnId).toBe('new-turn')
})
