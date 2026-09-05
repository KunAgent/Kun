import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultKunLabSettings, type KunLabSettingsV1 } from '@shared/app-settings'
import { PptAgentSettingsPanel } from './settings-section-lab-ppt'

const labels: Record<string, string> = {
  labPptTitle: 'PPT Agent',
  labPptDescription: 'PPT description',
  labPptEnabled: 'Enable ppt_agent',
  labPptEnabledDesc: 'Enable description',
  labPptImageFirst: 'Generate visual previews first',
  labPptImageFirstDesc: 'Generate complete previews before the deck.',
  labPptImageFirstReadyHint: 'Image generation is available.',
  labPptImageFirstReferenceEditHint: 'Reference edits are available.',
  labPptImageFirstRegenerateOnlyHint: 'Only full-page regeneration is available.',
  labPptImageFirstUnavailableHint: 'Image generation is not available.',
  labPptModelMode: 'Model policy',
  labPptModelModeDesc: 'Model policy description',
  labPptModelModeInherit: 'Follow main model',
  labPptModelModeFixed: 'Use fixed model',
  labPptModel: 'PPT model',
  labPptModelDesc: 'Model description',
  labPptReasoningEffort: 'PPT reasoning effort',
  labPptReasoningEffortDesc: 'Reasoning description',
  graphSettingsReasoningAuto: 'Auto',
  graphSettingsReasoningOff: 'Off',
  graphSettingsReasoningLow: 'Low',
  graphSettingsReasoningMedium: 'Medium',
  graphSettingsReasoningHigh: 'High',
  graphSettingsReasoningMax: 'Max',
  labPptFast: 'Codex Fast mode',
  labPptFastDesc: 'Fast description',
  labPptFastUnsupportedHint: 'Fast unsupported'
}
const t = (key: string): string => labels[key] ?? key

function settings(imageFirst: boolean): KunLabSettingsV1 {
  return {
    ...defaultKunLabSettings(),
    pptAgent: { enabled: true, model: '', providerId: '', fast: false, imageFirst },
      conversationVisualization: { enabled: false }
  }
}

function render(value: KunLabSettingsV1, imageGen: { available: boolean; reason?: string; supportsReferenceEdit?: boolean }): string {
  return renderToStaticMarkup(createElement(PptAgentSettingsPanel, {
    t,
    value,
    modelProviders: [],
    leadProviderId: 'deepseek',
    leadModel: 'deepseek-v4-pro',
    imageGen,
    selectControlClass: 'select',
    onChange: () => undefined
  }))
}

describe('PptAgentSettingsPanel image-first mode', () => {
  it('shows ready and fallback capability hints while defaulting the toggle on', () => {
    const ready = render(settings(true), { available: true, supportsReferenceEdit: true })
    expect(ready).toContain('Generate visual previews first')
    expect(ready).toContain('Image generation is available.')
    expect(ready).toContain('Reference edits are available.')
    expect(ready).toContain('aria-checked="true"')

    const unavailable = render(settings(true), { available: false, reason: 'provider is not configured' })
    expect(unavailable).toContain('Image generation is not available. provider is not configured')

    const regenerateOnly = render(settings(true), { available: true, supportsReferenceEdit: false })
    expect(regenerateOnly).toContain('Only full-page regeneration is available.')
  })

  it('hides capability messaging when image-first is disabled', () => {
    const direct = render(settings(false), { available: false })
    expect(direct).toContain('Generate visual previews first')
    expect(direct).not.toContain('Image generation is not available.')
  })
})
