import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/default/app/path'
  }
}))

import { bundledSkillsDirectory } from './bundled-skill-resources'

describe('bundledSkillsDirectory', () => {
  it('resolves packaged skills below process resources', () => {
    expect(bundledSkillsDirectory({
      isPackaged: true,
      resourcesPath: '/Applications/Kun.app/Contents/Resources',
      appRoot: '/ignored'
    })).toBe('/Applications/Kun.app/Contents/Resources/bundled-skills')
  })

  it('resolves development skills below the repository resources directory', () => {
    expect(bundledSkillsDirectory({
      isPackaged: false,
      resourcesPath: '/ignored',
      appRoot: '/workspace/DeepSeek-GUI'
    })).toBe('/workspace/DeepSeek-GUI/resources/bundled-skills')
  })
})
