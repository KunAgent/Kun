import { describe, expect, it } from 'vitest'
import { canWritePath } from './sandbox-policy.js'

const context = {
  workspace: '/repo/workspace',
  sandboxMode: 'workspace-write' as const,
  guiDesignArtifact: {
    kind: 'html' as const,
    artifactId: 'compact',
    relativePath: '.kun-design/doc/compact/v1.html',
    designMdPath: '.kun-design/doc/compact/DESIGN.md'
  }
}

describe('screen-generation write scope', () => {
  it('allows the reserved page and its design notes', () => {
    expect(canWritePath('/repo/workspace/.kun-design/doc/compact/v1.html', context)).toEqual({ ok: true })
    expect(canWritePath('.kun-design/doc/compact/DESIGN.md', context)).toEqual({ ok: true })
  })

  it('refuses a sibling screen with a message the model can act on', () => {
    const result = canWritePath('/repo/workspace/.kun-design/doc/detail/v1.html', context)
    expect(result).toMatchObject({ ok: false, block: { code: 'sandbox_write_blocked' } })
    expect(!result.ok && result.block.message).toContain('design_write_scope_violation')
    expect(!result.ok && result.block.message).toContain('.kun-design/doc/compact/v1.html')
  })

  it('leaves writes outside the design root untouched', () => {
    expect(canWritePath('/repo/workspace/src/app.ts', context)).toEqual({ ok: true })
  })

  it('does not restrict turns that reserve no HTML screen', () => {
    const { guiDesignArtifact: _ignored, ...plain } = context
    expect(canWritePath('/repo/workspace/.kun-design/doc/detail/v1.html', plain)).toEqual({ ok: true })
  })
})
