/** @vitest-environment jsdom */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchStageRouter } from './WorkbenchStageRouter'
import { useArtifactLibraryStore } from '../../artifacts/artifact-library-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import type { WorkbenchConversationStageProps } from './WorkbenchConversationStage'

const mobile = vi.hoisted(() => ({ active: false }))
vi.mock('../../lib/remote-mobile', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/remote-mobile')>(),
  useRemoteMobileLayout: () => mobile.active
}))
vi.mock('../write/WorkTabStrip', () => ({ WorkTabStrip: () => createElement('div', { 'data-stage': 'tabs' }) }))
vi.mock('../write/WorkPaperHost', () => ({ WorkPaperHost: () => createElement('div', { 'data-stage': 'work' }) }))
vi.mock('../paper/PapersSurface', () => ({
  PapersSurface: ({ embedded }: { embedded?: boolean }) => createElement('div', { 'data-stage': 'papers', 'data-embedded': embedded })
}))
vi.mock('../../artifacts/ArtifactsPage', () => ({
  ArtifactsPage: ({ embedded }: { embedded?: boolean }) => createElement('div', { 'data-stage': 'artifacts', 'data-embedded': embedded })
}))

let renderer: ReactTestRenderer
const noop = () => {}
const write = {
  runtimeBanner: null, rightPanel: null, leftSidebarCollapsed: false, onToggleLeftSidebar: noop,
  input: '', setInput: noop, onSubmitPrompt: noop, onAttachImage: async () => true, onOpenAgentSettings: noop
}
const conversation = { chat: {} } as unknown as WorkbenchConversationStageProps
function stage(route: string) {
  return createElement(WorkbenchStageRouter, {
    route, adeDraftOpen: false, leftSidebarCollapsed: false, onToggleLeftSidebar: noop, onOpenThread: noop,
    imageAnnotationHost: null, planOverlay: null, conversation, write,
    extensions: { workspaceRoot: '/work', onOpenIntegrations: noop, onOpenView: async () => {} }
  })
}
async function update(route: string): Promise<void> {
  await act(async () => { renderer.update(stage(route)) })
}
function nodes(name: string) { return renderer.root.findAllByProps({ 'data-stage': name }) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mobile.active = false
  useWriteWorkspaceStore.setState({ workspaceRoot: '/work' })
  useArtifactLibraryStore.setState({ source: 'work', workRoot: '/work' })
})
afterEach(() => {
  act(() => renderer.unmount())
  vi.unstubAllGlobals()
})

describe('Workbench Work library stage', () => {
  it('uses one Work tab strip for the editor, paper library, and Work artifacts', async () => {
    await act(async () => { renderer = create(stage('write')) })
    expect(nodes('tabs')).toHaveLength(1)
    expect(nodes('work')).toHaveLength(1)
    await update('papers')
    expect(nodes('tabs')).toHaveLength(1)
    expect(nodes('papers')[0].props['data-embedded']).toBe(true)
    await update('artifacts')
    expect(nodes('tabs')).toHaveLength(1)
    expect(nodes('artifacts')[0].props['data-embedded']).toBe(true)
  })

  it('keeps Code artifacts and the remote mobile paper page outside the desktop Work strip', async () => {
    useArtifactLibraryStore.setState({ source: 'code', workRoot: null })
    await act(async () => { renderer = create(stage('artifacts')) })
    expect(nodes('tabs')).toHaveLength(0)
    expect(nodes('artifacts')[0].props['data-embedded']).toBeUndefined()
    mobile.active = true
    await update('papers')
    expect(nodes('tabs')).toHaveLength(0)
    expect(nodes('papers')[0].props['data-embedded']).toBe(false)
  })
})
