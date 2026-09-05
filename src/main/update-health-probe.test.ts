import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import {
  isolatedUpdateHealthRuntimeEnvironment,
  registerUpdateHealthRendererIpc,
  runMinimalUpdateProbe,
  UPDATE_HEALTH_RENDERER_LOAD_TIMEOUT_MS,
  updateHealthRuntimeEnvironment
} from './update-health-probe'

vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn(async () => undefined),
    getVersion: vi.fn(() => '0.2.0'),
    isPackaged: true
  }
}))

describe('runMinimalUpdateProbe', () => {
  const healthyInstall = { ok: true } as const

  it('allows a bounded Windows CI cold start for the production renderer', () => {
    expect(UPDATE_HEALTH_RENDERER_LOAD_TIMEOUT_MS).toBe(60_000)
  })

  function deps(overrides: Partial<Parameters<typeof runMinimalUpdateProbe>[0]> = {}) {
    return {
      isPackaged: () => true,
      executablePath: () => 'C:\\Program Files\\Kun\\Kun.exe',
      resourcesPath: () => 'C:\\Program Files\\Kun\\resources',
      inspectInstall: vi.fn(() => healthyInstall),
      loadRuntimeAdapter: vi.fn(async () => ({})),
      probeRendererWindow: vi.fn(async () => undefined),
      probeRuntimeServices: vi.fn(async () => undefined),
      createTempDir: vi.fn(async () => '/tmp/kun-update-health-1'),
      removeTempDir: vi.fn(async () => undefined),
      ...overrides
    }
  }

  it('runs the bundled runtime entry through Electron\'s Node mode', () => {
    expect(updateHealthRuntimeEnvironment('node-script', { EXISTING: 'value' })).toEqual({
      EXISTING: 'value',
      ELECTRON_RUN_AS_NODE: '1'
    })
    expect(updateHealthRuntimeEnvironment('custom', { EXISTING: 'value' })).toEqual({
      EXISTING: 'value'
    })
  })

  it('isolates the health runtime from the user Service Manager', () => {
    const dataDir = join('/tmp', 'health-data')
    const managerControlDir = join(dataDir, 'manager', 'control')
    const managerSettingsPath = join(dataDir, 'manager', 'settings.json')
    expect(isolatedUpdateHealthRuntimeEnvironment({
      dataDir,
      managerControlDir,
      managerSettingsPath,
      resolutionKind: 'node-script',
      runtimeToken: 'runtime-token'
    }, { KUN_MANAGER_BASE_URL: 'http://inherited.invalid' })).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      KUN_MANAGER_BASE_URL: '',
      KUN_MANAGER_CONTROL_DIR: managerControlDir,
      KUN_MANAGER_DATA_DIR: '',
      KUN_MANAGER_SETTINGS_PATH: managerSettingsPath,
      KUN_MANAGER_TOKEN: '',
      KUN_RUNTIME_DISCOVERY_DIR: join(dataDir, 'runtime-discovery'),
      KUN_RUNTIME_TOKEN: 'runtime-token'
    })
  })

  it('registers the preload startup channel used by the hidden renderer', () => {
    const handle = vi.fn()

    registerUpdateHealthRendererIpc({ handle } as never)

    expect(handle).toHaveBeenCalledWith('startup:state:get', expect.any(Function))
    expect(handle.mock.calls[0]?.[1]()).toEqual({
      phase: 'bootstrapping',
      detail: 'update-health-probe'
    })
  })

  it('loads the packaged runtime module without starting persistent services', async () => {
    const d = deps()

    await runMinimalUpdateProbe(d)

    expect(d.loadRuntimeAdapter).toHaveBeenCalledOnce()
    expect(d.probeRendererWindow).toHaveBeenCalledOnce()
    expect(d.probeRuntimeServices).toHaveBeenCalledOnce()
    expect(d.removeTempDir).toHaveBeenCalledWith('/tmp/kun-update-health-1')
  })

  it('reports bounded progress through renderer and runtime services', async () => {
    const d = deps()
    const reportProgress = vi.fn()
    const context = {
      deadlineAt: Date.now() + 10_000,
      diagnosticBasePath: '/tmp/health',
      reportProgress
    }

    await runMinimalUpdateProbe(d, context)

    expect(d.probeRendererWindow).toHaveBeenCalledWith(context)
    expect(d.probeRuntimeServices).toHaveBeenCalledWith('/tmp/kun-update-health-1', context)
    expect(reportProgress.mock.calls.map(([phase]) => phase)).toEqual([
      'electron_waiting',
      'electron_ready',
      'payload_checking',
      'payload_ready',
      'runtime_module_loading',
      'runtime_module_ready',
      'renderer_loading',
      'runtime_services_starting'
    ])
  })

  it('rejects immediately after the shared deadline expires', async () => {
    const d = deps()

    await expect(runMinimalUpdateProbe(d, {
      deadlineAt: Date.now() - 1,
      diagnosticBasePath: '/tmp/health',
      reportProgress: vi.fn()
    })).rejects.toThrow('deadline expired')

    expect(d.loadRuntimeAdapter).not.toHaveBeenCalled()
  })

  it('rejects an incomplete candidate payload before loading runtime modules', async () => {
    const d = deps({
      inspectInstall: vi.fn(() => ({ ok: false, missing: ['Kun runtime entry'] }))
    })

    await expect(runMinimalUpdateProbe(d)).rejects.toThrow('Kun runtime entry')

    expect(d.loadRuntimeAdapter).not.toHaveBeenCalled()
    expect(d.probeRendererWindow).not.toHaveBeenCalled()
    expect(d.probeRuntimeServices).not.toHaveBeenCalled()
  })

  it('surfaces a packaged runtime module load failure', async () => {
    const d = deps({
      loadRuntimeAdapter: vi.fn(async () => {
        throw new Error('runtime entry could not load')
      })
    })

    await expect(runMinimalUpdateProbe(d)).rejects.toThrow('runtime entry could not load')
    expect(d.probeRendererWindow).not.toHaveBeenCalled()
  })

  it('fails the probe when the renderer surface is broken', async () => {
    const d = deps({
      probeRendererWindow: vi.fn(async () => {
        throw new Error('preload bridge missing')
      })
    })

    await expect(runMinimalUpdateProbe(d)).rejects.toThrow('preload bridge missing')
    expect(d.probeRuntimeServices).not.toHaveBeenCalled()
  })

  it('fails the probe when the runtime gateway is unhealthy', async () => {
    const d = deps({
      probeRuntimeServices: vi.fn(async () => {
        throw new Error('The candidate runtime gateway did not become healthy.')
      })
    })

    await expect(runMinimalUpdateProbe(d)).rejects.toThrow('gateway did not become healthy')
  })

  it('always removes the temporary data directory', async () => {
    const d = deps({
      probeRuntimeServices: vi.fn(async () => {
        throw new Error('storage failed')
      })
    })

    await expect(runMinimalUpdateProbe(d)).rejects.toThrow('storage failed')
    expect(d.removeTempDir).toHaveBeenCalledWith('/tmp/kun-update-health-1')
  })
})
