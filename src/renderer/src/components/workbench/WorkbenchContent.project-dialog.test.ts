// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchContent } from './WorkbenchContent'

vi.mock('./WorkbenchLeftSidebar', () => ({
  WorkbenchLeftSidebar: ({ collapsed }: { collapsed: boolean }) =>
    collapsed ? null : createElement('aside', { 'data-test-sidebar': true })
}))
vi.mock('./WorkbenchStageRouter', () => ({ WorkbenchStageRouter: () => null }))
vi.mock('./rail-slot', () => ({ RailSlot: () => null }))
vi.mock('../chat/CodeWorkspaceProjectDialog', () => ({
  CodeWorkspaceProjectDialog: () => createElement('div', { 'data-test-project-dialog-host': true })
}))
vi.mock('../../store/review-store', () => ({
  useReviewStore: (select: (state: { bindings: object }) => unknown) => select({ bindings: {} }),
  ensureThreadBinding: vi.fn()
}))
vi.mock('../../store/activity-store', () => ({
  useActivityStore: (select: (state: { rows: never[]; status: string }) => unknown) => select({ rows: [], status: 'idle' })
}))
vi.mock('../../extensions/ControlledContributionSurfaces', () => ({
  canOpenHostContextMenuForTarget: () => false,
  DeclarativeContextMenuOverlay: () => null,
  ExtensionViewOutlet: () => null
}))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('project editor lives outside the optional sidebar', () => {
  it.each([
    { name: 'expanded sidebar', collapsed: false, extension: false, fullPage: false },
    { name: 'collapsed sidebar', collapsed: true, extension: false, fullPage: false },
    { name: 'extension sidebar', collapsed: false, extension: true, fullPage: false },
    { name: 'full-page extension', collapsed: false, extension: false, fullPage: true }
  ])('keeps one project dialog host with $name', async ({ collapsed, extension, fullPage }) => {
    const context = {
      route: 'chat', threads: [], codeThreads: [], adeThreads: [], activeThreadId: null,
      extensionHostContextMenus: [], extensionCommands: [], codeRightTabs: { expanded: false },
      leftSidebarCollapsed: collapsed,
      activeExtensionLeftSidebar: extension ? { id: 'test.extension.sidebar', point: 'views.leftSidebar' } : null,
      activeExtensionCenterView: fullPage ? { id: 'test.extension.page', point: 'views.fullPage' } : null
    }
    await act(async () => root.render(createElement(WorkbenchContent, { context })))
    expect(host.querySelectorAll('[data-test-project-dialog-host]')).toHaveLength(1)
    if (collapsed || fullPage) expect(host.querySelector('[data-test-sidebar]')).toBeNull()
  })
})
