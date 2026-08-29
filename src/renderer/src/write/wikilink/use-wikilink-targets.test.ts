import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetWikilinkTargetsForTests } from './wikilink-target-service'
import { useWikilinkTargets, type WikilinkTargetsHandle } from './use-wikilink-targets'

vi.mock('../write-workspace-store', () => ({
  useWriteWorkspaceStore: (selector: (state: { workspaceRoots: string[] }) => unknown) =>
    selector({ workspaceRoots: ['/vault'] })
}))

type KunGui = { listWorkspaceDirectory: ReturnType<typeof vi.fn> }

let handle: WikilinkTargetsHandle | null = null

function Probe(): null {
  handle = useWikilinkTargets()
  return null
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 25; turn += 1) await Promise.resolve()
}

describe('useWikilinkTargets', () => {
  let renderer: ReactTestRenderer | null = null
  let api: KunGui

  beforeEach(() => {
    resetWikilinkTargetsForTests()
    handle = null
    api = {
      listWorkspaceDirectory: vi.fn(async () => ({
        ok: true as const,
        entries: [{ name: 'a.md', path: 'a.md', type: 'file' as const, ext: '.md' }]
      }))
    }
    ;(globalThis as { window?: unknown }).window = { kunGui: api }
  })

  afterEach(() => {
    renderer?.unmount()
    renderer = null
    delete (globalThis as { window?: unknown }).window
  })

  it('never scans on mount — only when completion first asks', async () => {
    act(() => {
      renderer = create(createElement(Probe))
    })
    await act(flush)
    // Mounting any number of editors costs nothing; the reviewer's finding was
    // a full multi-root scan per mounted editor, before any `[[` was typed.
    expect(api.listWorkspaceDirectory).not.toHaveBeenCalled()

    act(() => handle!.request())
    await act(flush)
    expect(api.listWorkspaceDirectory).toHaveBeenCalledTimes(1)
    expect(handle!.targets.map((target) => target.name)).toEqual(['a.md'])
  })

  it('shares one cache across several mounted editors', async () => {
    act(() => {
      renderer = create(createElement('div', null, createElement(Probe), createElement(Probe)))
    })
    await act(flush)
    act(() => handle!.request())
    await act(flush)
    act(() => handle!.request())
    await act(flush)
    expect(api.listWorkspaceDirectory).toHaveBeenCalledTimes(1)
  })
})
