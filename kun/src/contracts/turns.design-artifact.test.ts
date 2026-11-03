import { describe, expect, it } from 'vitest'
import { GuiDesignArtifactContextSchema } from './turns.js'

describe('GuiDesignArtifactContextSchema', () => {
  it('keeps accepting versioned SVG artifacts', () => {
    expect(GuiDesignArtifactContextSchema.safeParse({
      kind: 'svg', artifactId: 'logo', relativePath: '.kun-design/doc/logo/v2.svg'
    }).success).toBe(true)
  })

  it('accepts a reserved HTML screen with its design notes', () => {
    expect(GuiDesignArtifactContextSchema.safeParse({
      kind: 'html',
      artifactId: 'compact',
      relativePath: '.kun-design/doc/compact/v1.html',
      designMdPath: '.kun-design/doc/compact/DESIGN.md'
    }).success).toBe(true)
  })

  it('rejects reservations outside the design root or with traversal', () => {
    for (const relativePath of ['src/v1.html', '.kun-design/../secret/v1.html', '.kun-design/doc/a/page.html']) {
      expect(GuiDesignArtifactContextSchema.safeParse({
        kind: 'html', artifactId: 'a', relativePath
      }).success).toBe(false)
    }
    expect(GuiDesignArtifactContextSchema.safeParse({
      kind: 'html', artifactId: 'a', relativePath: '.kun-design/doc/a/v1.html', designMdPath: '/etc/passwd'
    }).success).toBe(false)
    expect(GuiDesignArtifactContextSchema.safeParse({
      kind: 'svg', artifactId: 'a', relativePath: '.kun-design/doc/a/v1.html'
    }).success).toBe(false)
  })
})
