import { Suspense, createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  workbenchContributionLoadCoordinator,
  type ExtensionContributionLoadContext
} from './contribution-load-coordinator'
import { extensionWorkbenchClient } from './extension-workbench-client'
import {
  refreshExtensionContributionSnapshot,
  useCommittedExtensionContributionLoadContext,
  useExtensionContributionBootstrap
} from './use-contributions'

const never = new Promise<never>(() => undefined)

function SuspendedBootstrap({ context }: { context: ExtensionContributionLoadContext }): never {
  useExtensionContributionBootstrap(context.workspaceRoot, undefined, context.locale)
  throw never
}

let observedCommittedContextRef: RefObject<ExtensionContributionLoadContext> | undefined

function CommittedContextHarness({
  context,
  suspend = false
}: {
  context: ExtensionContributionLoadContext
  suspend?: boolean
}): null {
  observedCommittedContextRef = useCommittedExtensionContributionLoadContext(context)
  if (suspend) throw never
  return null
}

afterEach(() => {
  observedCommittedContextRef = undefined
  vi.restoreAllMocks()
})

describe('committed extension contribution contexts', () => {
  it('does not supersede a live snapshot from an uncommitted workspace render', async () => {
    const workspaceA = { workspaceRoot: '/workspace/a', locale: 'en' }
    const workspaceB = { workspaceRoot: '/workspace/b', locale: 'en' }
    workbenchContributionLoadCoordinator.updateContext(workspaceA)

    let resolveSnapshot!: (snapshot: {
      schemaVersion: 1
      revision: number
      workspaceRoot: string
      extensions: []
    }) => void
    const snapshot = new Promise<{
      schemaVersion: 1
      revision: number
      workspaceRoot: string
      extensions: []
    }>((resolve) => {
      resolveSnapshot = resolve
    })
    vi.spyOn(extensionWorkbenchClient, 'loadContributions').mockReturnValue(snapshot)
    const inFlight = refreshExtensionContributionSnapshot(
      workspaceA.workspaceRoot,
      workspaceA.locale
    )

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Suspense, {
        fallback: createElement('span', null, 'pending')
      }, createElement(SuspendedBootstrap, { context: workspaceB })))
    })
    expect(renderer.root.findByType('span').children).toEqual(['pending'])

    resolveSnapshot({
      schemaVersion: 1,
      revision: 1,
      workspaceRoot: workspaceA.workspaceRoot,
      extensions: []
    })
    await expect(inFlight).resolves.toBe('applied')
    await act(async () => renderer.unmount())
  })

  it('does not leak an uncommitted Workbench context through its async guard ref', async () => {
    const workspaceA = { workspaceRoot: '/workspace/a', locale: 'en' }
    const workspaceB = { workspaceRoot: '/workspace/b', locale: 'zh-CN' }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Suspense, {
        fallback: createElement('span', null, 'pending')
      }, createElement(CommittedContextHarness, { context: workspaceA })))
    })
    expect(observedCommittedContextRef?.current).toEqual(workspaceA)

    await act(async () => {
      renderer.update(createElement(Suspense, {
        fallback: createElement('span', null, 'pending')
      }, createElement(CommittedContextHarness, {
        context: workspaceB,
        suspend: true
      })))
    })
    expect(renderer.root.findByType('span').children).toEqual(['pending'])
    expect(observedCommittedContextRef?.current).toEqual(workspaceA)
    await act(async () => renderer.unmount())
  })
})
