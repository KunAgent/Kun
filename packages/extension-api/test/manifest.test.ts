import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { toJSONSchema } from 'zod'
import {
  ExtensionManifestSchema,
  CURRENT_EXTENSION_API_VERSION,
  ModelUsageSchema,
  RESULT_PREVIEW_OPEN_CHANNEL,
  ResultPreviewOpenPayloadSchema,
  SUPPORTED_EXTENSION_API_VERSIONS,
  negotiateApiVersion,
  parseExtensionManifest,
  permissionMatches,
  resolveExtensionManifestLocale
} from '../src/index.js'

const manifest = {
  manifestVersion: 1,
  apiVersion: '1.0.0',
  name: 'issues',
  publisher: 'acme',
  version: '1.2.3',
  icon: 'assets/issue-assistant.svg',
  engines: { kun: '^0.1.0' },
  main: 'dist/main.js',
  browser: 'dist/webview/index.html',
  activationEvents: ['onView:issues', 'onTool:create-issue'],
  contributes: {
    'views.rightSidebar': [{ id: 'issues', title: 'Issues', entry: 'dist/webview/index.html' }],
    tools: [{ id: 'create-issue', description: 'Create an issue', inputSchema: { type: 'object' } }]
  },
  permissions: ['ui.views', 'webview', 'tools.register', 'network:api.example.com'],
  stateSchemaVersion: 1
}

describe('ExtensionManifestSchema', () => {
  it('parses a canonical manifest and applies safe defaults', () => {
    const parsed = parseExtensionManifest(manifest)
    expect(parsed.publisher).toBe('acme')
    expect(parsed.icon).toBe('assets/issue-assistant.svg')
    expect(parsed.contributes['views.rightSidebar'][0].order).toBe(0)
    expect(parsed.contributes['views.rightSidebar'][0].showInRightRail).toBe(true)
    expect(parsed.contributes.tools[0].sideEffects).toBe('none')
    expect(parsed.localizations).toBeUndefined()
    expect(ExtensionManifestSchema.safeParse({ ...manifest, icon: '../icon.svg' }).success).toBe(false)
  })

  it('allows right-sidebar Views to opt out of the default rail launcher', () => {
    const parsed = parseExtensionManifest({
      ...manifest,
      contributes: {
        ...manifest.contributes,
        'views.rightSidebar': [{
          id: 'issues',
          title: 'Issues',
          entry: 'dist/webview/index.html',
          showInRightRail: false
        }]
      }
    })

    expect(parsed.contributes['views.rightSidebar'][0].showInRightRail).toBe(false)
  })

  it('resolves exact and language locale overlays without mutating executable manifest data', () => {
    const parsed = parseExtensionManifest({
      ...manifest,
      displayName: 'Issue Assistant',
      description: 'Base description',
      localizations: {
        zh: {
          displayName: '问题助手',
          contributes: {
            'views.rightSidebar': { issues: { title: '问题' } },
            tools: { 'create-issue': { description: '创建问题' } }
          }
        },
        'zh-CN': {
          displayName: '问题助手（简体）',
          contributes: {
            'views.rightSidebar': { issues: { title: '问题面板' } }
          }
        }
      }
    })

    const exact = resolveExtensionManifestLocale(parsed, 'zh-CN')
    expect(exact.displayName).toBe('问题助手（简体）')
    expect(exact.description).toBe('Base description')
    expect(exact.contributes['views.rightSidebar'][0].title).toBe('问题面板')
    expect(exact.contributes.tools[0].description).toBe('Create an issue')

    const languageFallback = resolveExtensionManifestLocale(parsed, 'zh-HK')
    expect(languageFallback.displayName).toBe('问题助手')
    expect(languageFallback.contributes['views.rightSidebar'][0].title).toBe('问题')
    expect(languageFallback.contributes.tools[0].description).toBe('创建问题')

    expect(resolveExtensionManifestLocale(parsed, 'fr-FR')).toBe(parsed)
    expect(parsed.displayName).toBe('Issue Assistant')
    expect(parsed.contributes['views.rightSidebar'][0].title).toBe('Issues')
    expect(exact.main).toBe(parsed.main)
    expect(exact.activationEvents).toEqual(parsed.activationEvents)
    expect(exact.permissions).toEqual(parsed.permissions)
  })

  it('rejects invalid, duplicate, unbounded, or dangling locale overlays', () => {
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      localizations: { 'zh_CN': { displayName: '问题助手' } }
    }).success).toBe(false)
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      localizations: {
        'zh-CN': { displayName: '问题助手' },
        'ZH-cn': { displayName: '重复' }
      }
    }).success).toBe(false)
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      localizations: {
        'zh-CN': {
          contributes: {
            'views.rightSidebar': { missing: { title: '不存在' } }
          }
        }
      }
    }).success).toBe(false)
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      localizations: {
        'zh-CN': {
          contributes: {
            'views.rightSidebar': {
              issues: { title: '问题', entry: 'dist/other.html' }
            }
          }
        }
      }
    }).success).toBe(false)
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      localizations: Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [`aa-${index}`, { displayName: `Locale ${index}` }])
      )
    }).success).toBe(false)
  })

  it('requires an entrypoint and rejects unrecognized contribution keys', () => {
    const { main: _main, browser: _browser, ...withoutEntrypoint } = manifest
    expect(ExtensionManifestSchema.safeParse(withoutEntrypoint).success).toBe(false)
    expect(
      ExtensionManifestSchema.safeParse({
        ...manifest,
        contributes: { ...manifest.contributes, arbitraryReactComponent: [] }
      }).success
    ).toBe(false)
  })

  it('requires a Node entrypoint for headless contributions', () => {
    const { main: _main, ...browserOnlyWithTool } = manifest
    expect(ExtensionManifestSchema.safeParse(browserOnlyWithTool).success).toBe(false)
    expect(
      ExtensionManifestSchema.safeParse({
        ...browserOnlyWithTool,
        activationEvents: ['onView:issues'],
        contributes: {
          'views.rightSidebar': [
            { id: 'issues', title: 'Issues', entry: 'dist/webview/index.html' }
          ]
        },
        permissions: ['ui.views', 'webview']
      }).success
    ).toBe(true)
  })

  it('requires permissions implied by entrypoints and contributions', () => {
    expect(
      ExtensionManifestSchema.safeParse({
        ...manifest,
        permissions: ['ui.views', 'webview', 'network:api.example.com']
      }).success
    ).toBe(false)
  })

  it('accepts explicit external Webview authority with scoped network hosts', () => {
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      permissions: [
        ...manifest.permissions,
        'webview.external',
        'network:bilibili.com',
        'network:*.bilibili.com'
      ]
    }).success).toBe(true)
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      permissions: ['ui.views', 'webview', 'webview.external', 'tools.register']
    }).success).toBe(false)

    const externalViewManifest = {
      ...manifest,
      contributes: {
        ...manifest.contributes,
        'views.rightSidebar': [{
          id: 'issues',
          title: 'Social',
          entry: 'dist/webview/index.html',
          externalBrowser: {
            sites: [{
              id: 'bilibili',
              title: 'Bilibili',
              badge: 'B',
              accent: '#00aeec',
              url: 'https://www.bilibili.com/'
            }]
          }
        }]
      },
      permissions: [
        ...manifest.permissions,
        'webview.external',
        'network:bilibili.com',
        'network:*.bilibili.com'
      ]
    }
    const parsedExternalView = ExtensionManifestSchema.safeParse(externalViewManifest)
    expect(parsedExternalView.success).toBe(true)
    if (parsedExternalView.success) {
      expect(
        parsedExternalView.data.contributes['views.rightSidebar'][0]?.externalBrowser?.presentation
      ).toBe('desktop')
    }
    expect(ExtensionManifestSchema.safeParse({
      ...externalViewManifest,
      permissions: manifest.permissions
    }).success).toBe(false)
    expect(ExtensionManifestSchema.safeParse({
      ...externalViewManifest,
      contributes: {
        ...externalViewManifest.contributes,
        'views.rightSidebar': [{
          ...externalViewManifest.contributes['views.rightSidebar'][0],
          externalBrowser: {
            sites: [{ id: 'outside', title: 'Outside', url: 'https://example.com/' }]
          }
        }]
      }
    }).success).toBe(false)
  })

  it('rejects Direct DOM matching for the protected Settings surface', () => {
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      activationEvents: ['onStartup'],
      contributes: {
        hostContentScripts: [{
          id: 'settings-reader',
          matches: ['workbench:settings'],
          scripts: ['dist/settings-reader.js']
        }]
      },
      permissions: ['hostDom']
    }).success).toBe(false)
  })

  it('requires exact activation references and rejects dangling or ambiguous contributions', () => {
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      activationEvents: ['onView:issues']
    }).success).toBe(false)
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      activationEvents: ['onStartup']
    }).success).toBe(true)
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      activationEvents: [...manifest.activationEvents, 'onCommand:missing']
    }).success).toBe(false)
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      contributes: {
        ...manifest.contributes,
        'views.leftSidebar': [{ id: 'issues', title: 'Duplicate', entry: 'dist/webview/index.html' }]
      }
    }).success).toBe(false)
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      activationEvents: [...manifest.activationEvents, 'onCommand:open-issues'],
      contributes: {
        ...manifest.contributes,
        commands: [{ id: 'open-issues', title: 'Open issues' }],
        'actions.composer': [{ id: 'open-issues', command: 'open-issues', title: 'Open issues' }]
      },
      permissions: [...manifest.permissions, 'commands.register', 'ui.actions']
    }).success).toBe(false)
  })

  it('requires model Provider authentication references to resolve inside the Manifest', () => {
    expect(ExtensionManifestSchema.safeParse({
      ...manifest,
      activationEvents: [...manifest.activationEvents, 'onProvider:custom'],
      contributes: {
        ...manifest.contributes,
        modelProviders: [{
          id: 'custom',
          displayName: 'Custom',
          authenticationProviderId: 'missing'
        }]
      },
      permissions: [...manifest.permissions, 'providers.register']
    }).success).toBe(false)
  })

  it('keeps scoped permissions exact and supports wildcard host matching', () => {
    expect(permissionMatches('network:*.example.com', 'network:api.example.com')).toBe(true)
    expect(permissionMatches('network:*.example.com', 'network:example.net')).toBe(false)
  })

  it('has a checked-in JSON Schema generated from the canonical source', async () => {
    const checkedIn = JSON.parse(
      await readFile(new URL('../schema/kun-extension.schema.json', import.meta.url), 'utf8')
    )
    const generated = toJSONSchema(ExtensionManifestSchema, {
      io: 'input',
      target: 'draft-2020-12',
      unrepresentable: 'throw',
      reused: 'ref'
    })
    expect(checkedIn.anyOf ?? checkedIn.oneOf).toEqual(generated.anyOf ?? generated.oneOf)

    const viewSchema = Object.values(checkedIn.$defs as Record<string, {
      properties?: Record<string, unknown>
      required?: string[]
    }>).find((schema) => schema.properties?.showInRightRail)
    expect(viewSchema?.required).not.toContain('showInRightRail')
  })
})

describe('ModelUsageSchema', () => {
  it('requires cost and currency as one attributable pair', () => {
    expect(ModelUsageSchema.safeParse({ cost: 0.1 }).success).toBe(false)
    expect(ModelUsageSchema.safeParse({ currency: 'EUR' }).success).toBe(false)
    expect(ModelUsageSchema.safeParse({ cost: 0.1, currency: 'EUR' }).success).toBe(true)
  })
})

describe('API major negotiation fixtures', () => {
  it('admits current and previous majors and fails closed otherwise', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('../fixtures/api-major-negotiation.json', import.meta.url), 'utf8')
    )
    for (const testCase of fixture.cases) {
      const result = negotiateApiVersion({
        declaredApiVersion: testCase.declaredApiVersion,
        supportedApiVersions: [fixture.host.current, fixture.host.previous],
        requiredCapabilities: testCase.requiredCapabilities,
        capabilitiesByVersion: fixture.host.capabilitiesByVersion
      })
      expect(result.compatible, testCase.name).toBe(testCase.compatible)
      if (result.compatible) expect(result.adapter, testCase.name).toBe(testCase.adapter)
      else expect(result.code, testCase.name).toBe(testCase.code)
    }
  })
})

describe('API v1.2 minor compatibility fixtures', () => {
  it('keeps v1.1 and v1.0 manifests compatible while negotiating the current v1.2 Host', async () => {
    expect(CURRENT_EXTENSION_API_VERSION).toBe('1.2.0')
    expect(SUPPORTED_EXTENSION_API_VERSIONS).toEqual(['1.2.0', '1.1.0', '1.0.0'])
    expect(parseExtensionManifest(manifest).apiVersion).toBe('1.0.0')

    const fixture = JSON.parse(
      await readFile(new URL('../fixtures/api-minor-negotiation.json', import.meta.url), 'utf8')
    )
    for (const testCase of fixture.cases) {
      const result = negotiateApiVersion({
        declaredApiVersion: testCase.declaredApiVersion,
        supportedApiVersions: fixture.host.supportedApiVersions,
        requiredCapabilities: testCase.requiredCapabilities,
        capabilitiesByVersion: fixture.host.capabilitiesByVersion
      })
      expect(result.compatible, testCase.name).toBe(testCase.compatible)
      if (result.compatible) {
        expect(result.negotiatedApiVersion, testCase.name).toBe(testCase.negotiatedApiVersion)
      } else {
        expect(result.code, testCase.name).toBe(testCase.code)
      }
    }
  })
})

describe('result preview context contract', () => {
  it('accepts bounded workspace-relative metadata and rejects absolute paths', () => {
    expect(RESULT_PREVIEW_OPEN_CHANNEL).toBe('kun.resultPreview.open')
    const input = {
      schemaVersion: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      result: {
        sourceId: 'tool_1:file_1',
        mimeType: 'application/json',
        name: 'summary.json',
        relativePath: 'reports/summary.json'
      }
    }
    expect(ResultPreviewOpenPayloadSchema.parse(input)).toEqual(input)
    expect(ResultPreviewOpenPayloadSchema.safeParse({
      ...input,
      result: { ...input.result, relativePath: '/private/summary.json' }
    }).success).toBe(false)
  })
})
