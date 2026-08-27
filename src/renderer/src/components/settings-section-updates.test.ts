import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UpdatesSettingsSection } from './settings-section-updates'

function render(busy: 'idle' | 'checking' | 'downloading' | 'installing'): string {
  const checking = busy === 'checking'
  const downloading = busy === 'downloading'
  const installing = busy === 'installing'
  return renderToStaticMarkup(createElement(UpdatesSettingsSection, {
    ctx: {
      t: (key: string) => key,
      form: { guiUpdate: { channel: 'stable' } },
      update: () => undefined,
      selectControlClass: 'select',
      guiUpdateInfo: null,
      checkingGuiUpdate: checking,
      downloadingGuiUpdate: downloading,
      installingGuiUpdate: installing,
      guiUpdateDownloaded: false,
      guiUpdateProgress: null,
      guiUpdateError: null,
      checkGuiUpdate: async () => undefined,
      downloadGuiUpdate: async () => undefined,
      installGuiUpdate: async () => undefined
    }
  }))
}

describe('UpdatesSettingsSection', () => {
  it.each(['checking', 'downloading', 'installing'] as const)('disables channel switching while %s', (busy) => {
    expect(render(busy)).toContain('<select class="select" disabled="" aria-busy="true"')
  })

  it('keeps channel switching enabled when idle', () => {
    const html = render('idle')
    expect(html).toContain('<select class="select" aria-busy="false"')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('value="frontier"')
    expect(html).toContain('value="stable"')
  })
})
