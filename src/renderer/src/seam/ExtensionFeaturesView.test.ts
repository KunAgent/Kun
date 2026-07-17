import { describe, expect, it } from 'vitest'
import { EXTENSION_FEATURE_PANELS } from './ExtensionFeaturesView'

describe('ExtensionFeaturesView', () => {
  it('does not expose migrated Design resources as a standalone capability page', () => {
    expect(EXTENSION_FEATURE_PANELS.map((panel) => panel.title)).not.toContain('Design System')
    expect(EXTENSION_FEATURE_PANELS.map((panel) => panel.id)).not.toContain('design-library-browser')
  })
})
