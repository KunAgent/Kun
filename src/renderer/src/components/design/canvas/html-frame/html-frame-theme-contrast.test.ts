import { describe, expect, it } from 'vitest'
import { htmlFrameSurfaceClasses, qualityBadgeClasses, qualityFindingClasses } from './html-frame-helpers'

describe('HTML frame dark-theme contrast classes', () => {
  it.each([
    { active: false, transparentGeneratingSurface: false },
    { active: true, transparentGeneratingSurface: false },
    { active: false, transparentGeneratingSurface: true },
    { active: true, transparentGeneratingSurface: true }
  ])('keeps mounted HTML on opaque paper, including during generation: %o', (state) => {
    const classes = htmlFrameSurfaceClasses({ ...state, hasPreview: true })
    expect(classes.split(' ')).toContain('bg-white')
    expect(classes).not.toContain('bg-transparent')
    expect(classes).not.toContain('dark:bg-')
    if (state.active) expect(classes).toContain('border-accent')
  })

  it.each([false, true])('keeps the empty brush placeholder transparent (active=%s)', (active) => {
    const classes = htmlFrameSurfaceClasses({ active, hasPreview: false, transparentGeneratingSurface: true })
    expect(classes).toContain('bg-transparent')
    expect(classes).toContain('border-dashed')
  })

  it('keeps loading/error UI on an application-themed surface when no preview exists', () => {
    const classes = htmlFrameSurfaceClasses({ active: false, hasPreview: false, transparentGeneratingSurface: false })
    expect(classes).toContain('bg-ds-card')
    expect(classes).not.toContain('bg-white')
  })

  it.each([false, true])('keeps an empty failed preview on a themed surface (placeholder=%s)', (transparentGeneratingSurface) => {
    const classes = htmlFrameSurfaceClasses({
      active: false,
      hasPreview: false,
      transparentGeneratingSurface,
      hasError: true
    })
    expect(classes).toContain('bg-ds-card')
    expect(classes).not.toContain('bg-transparent')
  })

  it('keeps last-good HTML on paper when a later revision fails', () => {
    const classes = htmlFrameSurfaceClasses({
      active: true,
      hasPreview: true,
      transparentGeneratingSurface: true,
      hasError: true
    })
    expect(classes.split(' ')).toContain('bg-white')
    expect(classes).not.toContain('bg-ds-card')
  })

  it.each(['critical', 'warning', 'passed', 'checking'] as const)(
    'provides an explicit dark surface and foreground for %s quality badges',
    (kind) => {
      const classes = qualityBadgeClasses(kind)
      expect(classes).toMatch(/dark:bg-/)
      expect(classes).toMatch(/dark:text-/)
      expect(classes).toMatch(/dark:border-/)
    }
  )

  it.each(['critical', 'warning', 'info'] as const)(
    'provides an explicit dark semantic treatment for %s findings',
    (severity) => {
      const classes = qualityFindingClasses(severity)
      expect(classes).toMatch(/dark:bg-/)
      expect(classes).toMatch(/dark:text-/)
      expect(classes).toMatch(/dark:border-/)
    }
  )
})
