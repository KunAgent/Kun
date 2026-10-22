import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultKunLabSettings, type KunLabSettingsV1 } from '@shared/app-settings'
import { PptSkillSettingsPanel } from './settings-section-lab-ppt'

const labels: Record<string, string> = {
  labPptTitle: 'PPT skill',
  labPptDescription: 'PPT description',
  labPptEnabled: 'Enable PPT tools',
  labPptEnabledDesc: 'Enable description',
  labPptImageAssets: 'Generated image assets',
  labPptImageAssetsDesc: 'Fill image slots with generated assets.',
  labPptImageAssetsReadyHint: 'Image generation is available.',
  labPptImageAssetsUnavailableHint: 'No image model is configured.',
  labPptImageAssetsOffHint: 'Image slots use your material only.',
  labPptPreviewRenderer: 'Preview rendering',
  labPptPreviewRendererDesc: 'Previews come from the editable deck.',
  labPptPreviewRendererBuiltIn: 'Built in'
}
const t = (key: string): string => labels[key] ?? key

function settings(imageAssets: boolean): KunLabSettingsV1 {
  return {
    ...defaultKunLabSettings(),
    pptAgent: { enabled: true, imageAssets },
    conversationVisualization: { enabled: false }
  }
}

function render(value: KunLabSettingsV1, imageGen: { available: boolean; reason?: string; supportsReferenceEdit?: boolean }): string {
  return renderToStaticMarkup(createElement(PptSkillSettingsPanel, {
    t,
    value,
    imageGen,
    onChange: () => undefined
  }))
}

describe('PptSkillSettingsPanel image assets', () => {
  it('defaults the asset toggle on and explains the capability state', () => {
    const ready = render(settings(true), { available: true, supportsReferenceEdit: true })
    expect(ready).toContain('Generated image assets')
    expect(ready).toContain('Image generation is available.')
    expect(ready).toContain('aria-checked="true"')

    const unavailable = render(settings(true), { available: false, reason: 'provider is not configured' })
    expect(unavailable).toContain('No image model is configured. provider is not configured')
  })

  it('says slots fall back to user material when the toggle is off', () => {
    const off = render(settings(false), { available: true })
    expect(off).toContain('Image slots use your material only.')
    expect(off).not.toContain('Image generation is available.')
  })

  it('always shows the built-in preview renderer', () => {
    const markup = render(settings(true), { available: false })
    expect(markup).toContain('Preview rendering')
    expect(markup).toContain('Built in')
  })
})
