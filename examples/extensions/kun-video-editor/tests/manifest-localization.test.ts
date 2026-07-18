import { readFileSync } from 'node:fs'
import { parseExtensionManifest, resolveExtensionManifestLocale } from '@kun/extension-api'
import { describe, expect, it } from 'vitest'

function readManifest() {
  return parseExtensionManifest(JSON.parse(
    readFileSync(new URL('../kun-extension.json', import.meta.url), 'utf8')
  ))
}

describe('video editor manifest localization', () => {
  it('localizes every tool description and gives English settings readable titles', () => {
    const manifest = readManifest()

    const toolIds = manifest.contributes.tools.map(({ id }) => id).sort()
    const localizedTools = manifest.localizations?.zh?.contributes?.tools ?? {}
    expect(Object.keys(localizedTools).sort()).toEqual(toolIds)
    for (const id of toolIds) {
      expect(localizedTools[id]?.description).toMatch(/[\u3400-\u9fff]/u)
    }

    const properties = manifest.contributes.settings[0]?.properties ?? {}
    for (const id of ['defaultRenderPreset', 'defaultCaptionMode', 'localTranscriber']) {
      expect(properties[id]?.title).toBeTruthy()
      expect(properties[id]?.description).toBeTruthy()
    }

    expect(manifest.contributes.agentProfiles[0]?.instructions)
      .toContain("Respond in the user's current language")
  })

  it('localizes every Host-rendered video surface with English fallback', () => {
    const manifest = readManifest()
    const zh = resolveExtensionManifestLocale(manifest, 'zh-CN')
    const unsupported = resolveExtensionManifestLocale(manifest, 'fr-FR')

    expect(zh).toMatchObject({
      displayName: 'Kun 视频编辑器',
      description: expect.stringMatching(/[\u3400-\u9fff]/u),
      contributes: {
        commands: [{ id: 'editor-request', title: '视频编辑器请求', category: '视频' }],
        'views.rightSidebar': [{ id: 'editor', title: 'Kun 视频编辑器' }],
        'message.resultPreviews': [{ id: 'render-preview', title: '视频渲染结果' }],
        settings: [{
          id: 'video-editor',
          title: 'Kun 视频编辑器',
          properties: {
            defaultRenderPreset: { title: '默认渲染预设' },
            defaultCaptionMode: { title: '默认字幕模式' },
            localTranscriber: { title: '本地转录器' }
          }
        }]
      }
    })
    expect(unsupported.displayName).toBe('Kun Video Editor')
    expect(unsupported.contributes['views.rightSidebar'][0]?.title).toBe('Kun Video Editor')
    expect(unsupported.contributes['message.resultPreviews'][0]?.title).toBe('Video render')
  })
})
