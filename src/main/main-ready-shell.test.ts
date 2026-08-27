import { describe, expect, it, vi } from 'vitest'
import { readShellSettingsSnapshot } from './main-ready-shell'
import { normalizeAppSettings } from '../shared/app-settings'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/kun-test-user-data'),
    dock: undefined
  },
  session: { defaultSession: {} },
  shell: { openPath: vi.fn() }
}))

vi.mock('./main-app-context', () => ({
  appEnvironment: { flavor: 'development' },
  appIcon: { isEmpty: () => true },
  developmentRendererUrl: () => undefined,
  mainState: { updateHealthProbeOnly: false, logDir: null },
  pendingStorageRelocationId: null,
  storageRelocationRecoveryRequired: false,
  traceStartup: vi.fn()
}))

vi.mock('./main-migrations', () => ({
  runStorageRelocationMaintenance: vi.fn()
}))

vi.mock('./dev-renderer-cache', () => ({
  clearDevelopmentRendererHttpCache: vi.fn()
}))

vi.mock('./packaged-install-health', () => ({
  inspectPackagedInstallHealth: () => ({ ok: true, missing: [] })
}))

describe('readShellSettingsSnapshot', () => {
  it('normalizes a settings file from disk without the Manager backend', async () => {
    const expected = normalizeAppSettings({
      appBehavior: { startMinimized: true }
    } as never)
    const snapshot = await readShellSettingsSnapshot('/nonexistent/settings.json')
    // A missing file must fall back to defaults, never block the window.
    expect(snapshot.appBehavior).toBeDefined()
    expect(expected.appBehavior).toBeDefined()
    expect(snapshot.locale).toBe(expected.locale)
  })
})
