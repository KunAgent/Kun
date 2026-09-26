import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultKunLabSettings } from '@shared/app-settings-kun-merge'
import { ConversationVisualizationSettingsPanel } from './settings-section-lab-conversation-visualization'

const labels: Record<string, string> = {
  labConversationVisualizationTitle: 'Session display optimization',
  labConversationVisualizationDescription: 'Experimental visualization.',
  labConversationVisualizationEnabled: 'Enable session display optimization',
  labConversationVisualizationEnabledDesc: 'Preserves visualizations in history.'
}
const t = (key: string): string => labels[key] ?? key

describe('ConversationVisualizationSettingsPanel', () => {
  it('defaults off and describes history preservation', () => {
    const markup = renderToStaticMarkup(createElement(ConversationVisualizationSettingsPanel, {
      t,
      value: defaultKunLabSettings(),
      onChange: () => undefined
    }))
    expect(markup).toContain('Session display optimization')
    expect(markup).toContain('Preserves visualizations in history.')
    expect(markup).toContain('aria-checked="false"')
  })
})
