import { createElement } from 'react'
import { act, create as createRenderer, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageCleanupApi, StorageCleanupPlan, StorageCleanupStatus } from '@shared/storage-cleanup'
import i18n from '../i18n'
import { StorageCleanupSettingsSection } from './settings-section-storage-cleanup'

const GB = 1024 ** 3

const plan: StorageCleanupPlan = {
  createdAt: '2026-10-29T00:00:00.000Z',
  olderThanDays: 30,
  idleBefore: '2026-09-29T00:00:00.000Z',
  items: [
    { id: 'threadSlim:a', kind: 'threadSlim', title: 'Fix endpoint 404', detail: '/repo', updatedAt: '2026-09-01T00:00:00.000Z', bytes: 2 * GB },
    { id: 'threadSlim:b', kind: 'threadSlim', title: 'Design canvas', updatedAt: '2026-08-01T00:00:00.000Z', bytes: GB }
  ],
  totalBytes: 3 * GB,
  skipped: { pinned: 2, active: 0, room: 1, goal: 0, recent: 9 },
  truncated: false
}

function status(state: StorageCleanupStatus['state']): StorageCleanupStatus {
  return {
    config: {
      enabled: state !== 'off', olderThanDays: 30, notifyBefore: true, trashDays: 7,
      ...(state === 'off' ? {} : { consent: { at: '2026-10-29T00:00:00.000Z', olderThanDays: 30, rulesVersion: 1 } })
    },
    state,
    trash: { runs: [], bytes: 0, entries: 0 }
  }
}

function install(): StorageCleanupApi {
  const api: StorageCleanupApi = {
    getStatus: vi.fn(async () => status('off')),
    scan: vi.fn(async () => ({
      scannedAt: '2026-10-29T00:00:00.000Z', totalBytes: 20 * GB, kunDataRoot: '/home/.kun', safeCleanBytes: 1.3 * GB,
      categories: [{ id: 'worktrees', bytes: 7.6 * GB }, { id: 'threads', bytes: 6.8 * GB, detailBytes: 3.9 * GB }],
      manual: [{ id: 'migrationBackups', bytes: 1024 * 1024, path: '/x', removable: true }]
    })),
    enable: vi.fn(async () => status('scheduled')),
    disable: vi.fn(async () => status('off')),
    updateConfig: vi.fn(async () => status('off')),
    preview: vi.fn(async () => plan),
    run: vi.fn(async () => ({
      runId: 'r', reason: 'manual', startedAt: '', finishedAt: '', freedBytes: GB, trashedBytes: 0,
      slimmedThreads: 1, movedToTrash: 0, failed: 0, lines: []
    })),
    clearCaches: vi.fn(),
    removeMigrationBackups: vi.fn(),
    skipPendingRun: vi.fn(),
    history: vi.fn(async () => []),
    restoreTrashRun: vi.fn(),
    emptyTrash: vi.fn(),
    reveal: vi.fn(async () => undefined),
    onNoticeClicked: vi.fn(() => () => undefined)
  } as unknown as StorageCleanupApi
  vi.stubGlobal('window', { ...globalThis.window, kunGui: { storageCleanup: api }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  return api
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('StorageCleanupSettingsSection', () => {
  it('scans on open and asks for consent before enabling automatic cleanup', async () => {
    await i18n.changeLanguage('en')
    const api = install()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = createRenderer(createElement(StorageCleanupSettingsSection)) })
    await flush()
    expect(text(renderer.root)).toContain('Kun uses 20 GB on this computer')
    expect(text(renderer.root)).toContain('Replay logs take 3.9 GB')

    const toggle = renderer.root.findByProps({ role: 'switch', 'aria-label': 'Clean up old content automatically' })
    await act(async () => { toggle.props.onClick() })
    await flush()
    expect(api.enable).not.toHaveBeenCalled()
    expect(api.preview).toHaveBeenCalledWith({ olderThanDays: 30 })
    const dialog = renderer.root.findByProps({ role: 'dialog' })
    expect(text(dialog)).toContain('With today\'s data that frees about 3.0 GB')

    const confirm = dialog.findAllByType('button').find((button) => text(button) === 'Turn on')!
    expect(confirm.props.disabled).toBe(true)
    await act(async () => { dialog.findByType('input').props.onChange({ target: { checked: true } }) })
    await act(async () => { renderer.root.findAllByType('button').find((button) => text(button) === 'Turn on')!.props.onClick() })
    expect(api.enable).toHaveBeenCalledWith({ olderThanDays: 30 })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  })

  it('runs only the items left checked in the preview', async () => {
    await i18n.changeLanguage('en')
    const api = install()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = createRenderer(createElement(StorageCleanupSettingsSection)) })
    await flush()
    await act(async () => { renderer.root.findAllByType('button').find((button) => text(button) === 'Preview')!.props.onClick() })
    await flush()
    const dialog = renderer.root.findByProps({ role: 'dialog' })
    expect(text(dialog)).toContain('2 pinned')
    const rowBoxes = dialog.findAllByType('input').filter((input) => input.props.type === 'checkbox')
    // [kind checkbox, row a, row b]
    await act(async () => { rowBoxes[2]!.props.onChange({ target: { checked: false } }) })
    const run = renderer.root.findAllByType('button').find((button) => text(button).startsWith('Clean '))!
    expect(text(run)).toBe('Clean 2.0 GB')
    await act(async () => { run.props.onClick() })
    await flush()
    expect(api.run).toHaveBeenCalledWith({ olderThanDays: 30, itemIds: ['threadSlim:a'] })
    expect(text(renderer.root)).toContain('Freed 1.0 GB')
  })
})
