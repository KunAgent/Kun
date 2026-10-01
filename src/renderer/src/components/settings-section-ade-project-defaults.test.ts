import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { defaultKunRuntimeSettings } from '@shared/app-settings'
import type {
  AdeProjectDefaultsMutation,
  AdeProjectDefaultsMutationResult,
  AdeProjectDefaultsSnapshot
} from '@shared/ade-project-defaults'
import { AdeProjectDefaultsPanel } from './settings-section-ade-project-defaults'

const t = (key: string) => key
const initial: AdeProjectDefaultsSnapshot = {
  project: { key: '/repo', sourcePath: '/repo', kind: 'git' },
  value: {}, revision: 'r1'
}

async function renderPanel(
  snapshot: AdeProjectDefaultsSnapshot,
  save: (request: AdeProjectDefaultsMutation) => Promise<AdeProjectDefaultsMutationResult>
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(AdeProjectDefaultsPanel, {
      t, projectPath: '/repo/worktree', kun: defaultKunRuntimeSettings(), providers: [],
      load: async () => snapshot, save
    }))
  })
  return renderer
}

describe('AdeProjectDefaultsPanel', () => {
  it('saves only a local project override after an explicit click', async () => {
    const save = vi.fn(async (request: AdeProjectDefaultsMutation) => ({
      ok: true as const, ...initial, value: request.set ?? {}, revision: 'r2', generation: 7
    }))
    const renderer = await renderPanel(initial, save)
    const checks = renderer.root.findAllByType('input' as never)
      .filter((input) => input.props.type === 'checkbox')
    await act(async () => checks[0].props.onChange({ target: { checked: true } }))
    expect(save).not.toHaveBeenCalled()
    const button = renderer.root.findAllByType('button' as never)
      .find((candidate) => candidate.children.includes('adeSettings.collaborationSave'))!
    await act(async () => button.props.onClick())
    expect(save).toHaveBeenCalledWith({
      projectPath: '/repo/worktree', expectedRevision: 'r1',
      set: expect.objectContaining({ route: expect.objectContaining({ harnessId: 'kun' }) }),
      unset: []
    })
    act(() => renderer.unmount())
  })

  it('removes an override to restore inheritance without touching repository config', async () => {
    const snapshot: AdeProjectDefaultsSnapshot = {
      ...initial, value: { collaborationEnabled: true }
    }
    const save = vi.fn(async (request: AdeProjectDefaultsMutation) => ({
      ok: true as const, ...snapshot, value: {}, revision: 'r2', generation: 8
    }))
    const renderer = await renderPanel(snapshot, save)
    const checks = renderer.root.findAllByType('input' as never)
      .filter((input) => input.props.type === 'checkbox')
    await act(async () => checks[1].props.onChange({ target: { checked: false } }))
    const button = renderer.root.findAllByType('button' as never)
      .find((candidate) => candidate.children.includes('adeSettings.collaborationSave'))!
    await act(async () => button.props.onClick())
    expect(save).toHaveBeenCalledWith({
      projectPath: '/repo/worktree', expectedRevision: 'r1', set: {},
      unset: ['collaborationEnabled']
    })
    act(() => renderer.unmount())
  })
})
