import { describe, expect, it } from 'vitest'
import { ExtensionManifestSchema, MobileViewSchema } from '../src/index.js'
const mobile = { version: 1, blocks: [{ id: 'mode', type: 'choice', label: 'Mode', initial: 'compact', options: [{ value: 'compact', label: 'Compact' }] }] }
describe('opt-in native mobile views', () => {
  it('keeps existing desktop views valid and retains the declared mobile presentation', () => {
    const manifest = { manifestVersion: 1, apiVersion: '1.0.0', name: 'mobile', publisher: 'acme', version: '1.0.0',
      engines: { kun: '*' }, main: 'index.js', activationEvents: ['onView:panel'], permissions: ['ui.views', 'webview'], stateSchemaVersion: 1,
      contributes: { 'views.rightSidebar': [{ id: 'panel', title: 'Panel', entry: 'panel.html', mobile }] } }
    expect(ExtensionManifestSchema.parse(manifest).contributes['views.rightSidebar'][0].mobile).toEqual(mobile)
    const desktop = { ...manifest, contributes: { 'views.rightSidebar': [{ id: 'panel', title: 'Panel', entry: 'panel.html' }] } }
    expect(ExtensionManifestSchema.parse(desktop).contributes['views.rightSidebar'][0].mobile).toBeUndefined()
  })
  it('rejects undeclared executable effects and inconsistent choices', () => {
    for (const value of [{ ...mobile, script: 'run()' }, { ...mobile, blocks: [{ ...mobile.blocks[0], command: 'run' }] },
      { ...mobile, blocks: [{ ...mobile.blocks[0], initial: 'missing' }] },
      { ...mobile, blocks: [mobile.blocks[0], mobile.blocks[0]] }, { ...mobile, description: '\0' }])
      expect(MobileViewSchema.safeParse(value).success).toBe(false)
  })
})
