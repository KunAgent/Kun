import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultKunLabSettings } from '@shared/app-settings-kun-merge'
import { CodexReferenceBranchesSettingsPanel } from './settings-section-lab-codex-reference'
import en from '../locales/en/settings/migration-system.json'

describe('Codex reference laboratory settings panel', () => {
  it('explains source dependency and stays off by default', () => {
    const html = renderToStaticMarkup(createElement(CodexReferenceBranchesSettingsPanel, {
      value: defaultKunLabSettings(), onChange: () => undefined,
      t: (key: string) => (en as Record<string, string>)[key] ?? key
    }))
    expect(html).toContain('Codex history branches')
    expect(html).toContain('without copying entire logs')
    expect(html).toContain('aria-checked="false"')
  })
})
