import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { WorkWhiteboardLeaveActions } from './WorkWhiteboardLeaveActions'

const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  openArtifactsPage: vi.fn()
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../../write/work-whiteboard-leave', () => ({
  flushWorkWhiteboardPersistence: mocks.flush
}))

vi.mock('../../artifacts/artifact-library-store', () => ({
  openArtifactsPage: mocks.openArtifactsPage
}))

const originalSetFileError = useWriteWorkspaceStore.getState().setFileError

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  mocks.flush.mockReset()
  mocks.openArtifactsPage.mockReset()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  if (renderer) act(() => renderer?.unmount())
  renderer = null
  useWriteWorkspaceStore.setState({ setFileError: originalSetFileError })
  vi.unstubAllGlobals()
})

function buttons(): { props: { onClick?: () => void; disabled?: boolean } }[] {
  const json = renderer!.toJSON()
  const collected: { props: { onClick?: () => void; disabled?: boolean } }[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    const element = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
    if (element.type === 'button') collected.push(element as never)
    element.children?.forEach(walk)
  }
  walk(json)
  return collected
}

async function render(): Promise<void> {
  await act(async () => {
    renderer = create(createElement(WorkWhiteboardLeaveActions, {
      boardId: 'board-1',
      workspaceRoot: '/work',
      engine: 'kun' as const
    }))
  })
}

describe('WorkWhiteboardLeaveActions', () => {
  it('stays on the board and reports the error when saving fails', async () => {
    const setFileError = vi.fn()
    useWriteWorkspaceStore.setState({ setFileError })
    mocks.flush.mockResolvedValue({ ok: false, message: 'disk full' })
    await render()

    await act(async () => {
      buttons()[0].props.onClick?.()
    })

    expect(mocks.flush).toHaveBeenCalledWith('/work', 'kun')
    expect(setFileError).toHaveBeenCalledWith('disk full')
    expect(mocks.openArtifactsPage).not.toHaveBeenCalled()
  })

  it('returns to the artifact library only after a successful save', async () => {
    mocks.flush.mockResolvedValue({ ok: true })
    await render()

    await act(async () => {
      buttons()[0].props.onClick?.()
    })

    expect(mocks.openArtifactsPage).toHaveBeenCalledWith({ from: 'work', workRoot: '/work' })
  })
})
