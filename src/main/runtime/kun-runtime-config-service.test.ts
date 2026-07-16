import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  normalizeAppSettings,
  resolveKunRuntimeSettings
} from '../../shared/app-settings'
import { KunConfigSchema } from '../../../kun/src/config/kun-config.js'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  buildManagedRuntimeHotApplyBody,
  classifyManagedRuntimeHotApplyResponse,
  syncGuiManagedKunConfig
} from './kun-runtime-config-service'

describe('Kun runtime config service', () => {
  it('projects canonical runtime fields into a hot-apply body', () => {
    const runtime = {
      ...defaultKunRuntimeSettings(),
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      model: 'model-next',
      approvalPolicy: 'never' as const,
      sandboxMode: 'read-only' as const
    }
    const base = normalizeAppSettings({} as AppSettingsV1)
    const settings = normalizeAppSettings({
      ...base,
      provider: defaultModelProviderSettings(),
      agents: { kun: runtime }
    })
    const body = buildManagedRuntimeHotApplyBody(settings, KunConfigSchema.parse({
      serve: { host: '127.0.0.1', port: 18899, providers: {} }
    }))

    expect(body.serve).toMatchObject({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      model: resolveKunRuntimeSettings(settings).model,
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      providers: {}
    })
  })

  it('classifies compatibility fallback, success, restart, and failure responses', () => {
    expect(classifyManagedRuntimeHotApplyResponse(404, false, '')).toMatchObject({
      result: 'restart_required'
    })
    expect(classifyManagedRuntimeHotApplyResponse(200, true, '{"ok":true}')).toEqual({
      result: 'applied', message: ''
    })
    expect(classifyManagedRuntimeHotApplyResponse(
      409, false, '{"code":"restart_required","message":"process field changed"}'
    )).toEqual({ result: 'restart_required', message: 'process field changed' })
    expect(classifyManagedRuntimeHotApplyResponse(500, false, 'broken')).toEqual({
      result: 'failed', message: 'broken'
    })
  })

  it('seeds extension services for a new GUI-managed runtime profile', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-extension-config-'))
    const extensionRoot = join(dataDir, 'app-root')

    await syncGuiManagedKunConfig(dataDir, defaultKunRuntimeSettings(), { extensionRoot })

    const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'))
    expect(config.serve.extensions).toMatchObject({
      experts: {
        pluginRoots: [join(extensionRoot, 'experts', 'plugins')],
        customExpertsDir: join(dataDir, 'experts', 'custom')
      },
      moa: {},
      automation: { enabled: true },
      design: {
        librariesRoot: join(extensionRoot, 'design', 'design_libraries'),
        runtimeSkillsRoot: join(extensionRoot, 'design', 'runtime-skills'),
        staticSkillsRoot: join(extensionRoot, 'design', 'skills')
      }
    })
  })
})
