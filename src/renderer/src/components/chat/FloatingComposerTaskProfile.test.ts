import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  FloatingComposerTaskProfile,
  resolveDesignProfileSummaryPopupLayout,
  resolveDesignStylePopupLayout
} from './FloatingComposerTaskProfile'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const htmlProfile = { outputMedium: 'html', target: 'web', preset: 'none' } as const

describe('FloatingComposerTaskProfile', () => {
  it('flips the design profile summary popover above when the viewport bottom would clip it', () => {
    expect(resolveDesignProfileSummaryPopupLayout({ top: 900, bottom: 936 }, 1100)).toEqual({
      placement: 'top',
      maxHeight: 320
    })
    expect(resolveDesignProfileSummaryPopupLayout({ top: 300, bottom: 336 }, 900)).toEqual({
      placement: 'bottom',
      maxHeight: 320
    })
  })

  it('flips the design style popover above when the viewport bottom would clip it', () => {
    expect(resolveDesignStylePopupLayout({ top: 900, bottom: 936 }, 1100)).toEqual({
      placement: 'top',
      maxHeight: 344
    })
    expect(resolveDesignStylePopupLayout({ top: 300, bottom: 336 }, 900)).toEqual({
      placement: 'bottom',
      maxHeight: 344
    })
  })

  it('keeps Code and Design accessible as one responsive task selector', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: false,
      profile: htmlProfile,
      imageGenerationEnabled: true,
      imageGenerationAvailable: true,
      onSurfaceChange: vi.fn(),
      onProfileChange: vi.fn()
    }))

    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('data-task-surface="design"')
    expect(html).toContain('ds-design-profile-summary')
    expect(html).toContain('designConfiguration')
    expect(html).toContain('designOutputHtml')
    expect(html).toContain('designStyleAuto')
  })

  it('locks profile controls without restoring the conversation-mode selector', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: true,
      profileLocked: true,
      showSurfaceSelector: false,
      profile: { ...htmlProfile, outputMedium: 'image' },
      imageGenerationEnabled: false,
      imageGenerationAvailable: false,
      imageGenerationReason: 'Provider missing',
      onSurfaceChange: vi.fn(),
      onProfileChange: vi.fn()
    }))

    expect(html).toContain('data-task-surface-locked="true"')
    expect(html).not.toContain('role="radiogroup"')
    expect(html).toContain('ds-design-profile-summary')
    expect(html).toContain('designConfigureImageGeneration')
  })

  it('omits AI image when image generation is disabled before the first send', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: false,
      profile: htmlProfile,
      imageGenerationEnabled: false,
      imageGenerationAvailable: false,
      imageGenerationReason: 'Provider missing',
      onSurfaceChange: vi.fn(),
      onProfileChange: vi.fn()
    }))

    expect(html).toContain('ds-design-profile-summary')
    expect(html).toContain('designOutputHtml')
    expect(html).not.toContain('designOutputImage')
  })

  it('does not flash AI image while runtime capability state is unknown', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: false,
      profile: htmlProfile,
      imageGenerationAvailable: false,
      onSurfaceChange: vi.fn(),
      onProfileChange: vi.fn()
    }))

    expect(html).not.toContain('designOutputImage')
  })

  it('keeps an existing image draft honest while runtime capability state is unknown', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: false,
      showSurfaceSelector: false,
      variant: 'summary',
      profile: { ...htmlProfile, outputMedium: 'image' },
      imageGenerationAvailable: false,
      onProfileChange: vi.fn()
    }))

    expect(html).toContain('designOutputImage · designTargetWeb')
    expect(html).toContain('lucide-image')
    expect(html).not.toContain('designConfigureImageGeneration')
  })

  it('renders an inconsistent unlocked stale image profile as HTML while disabled', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: false,
      showSurfaceSelector: false,
      variant: 'summary',
      profile: { ...htmlProfile, outputMedium: 'image' },
      imageGenerationEnabled: false,
      imageGenerationAvailable: false,
      onProfileChange: vi.fn()
    }))

    expect(html).toContain('designOutputHtml · designTargetWeb')
    expect(html).not.toContain('designOutputImage')
  })

  it('keeps AI image visible but disabled when the enabled provider is unavailable', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: false,
      profile: htmlProfile,
      imageGenerationEnabled: true,
      imageGenerationAvailable: false,
      imageGenerationReason: 'Provider missing',
      onSurfaceChange: vi.fn(),
      onProfileChange: vi.fn()
    }))

    expect(html).toContain('ds-design-profile-summary')
    expect(html).toContain('designOutputHtml')
  })

  it('can render Design profile controls without duplicating the page-level selector', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: false,
      showSurfaceSelector: false,
      profile: htmlProfile,
      imageGenerationEnabled: true,
      imageGenerationAvailable: true,
      onProfileChange: vi.fn()
    }))

    expect(html).toContain('data-task-surface="design"')
    expect(html).toContain('ds-design-profile-summary')
    expect(html).toContain('designOutputHtml')
    expect(html).not.toContain('role="radiogroup"')
  })

  it('collapses empty-page Design controls into one configuration summary', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: false,
      showSurfaceSelector: false,
      variant: 'summary',
      profile: { outputMedium: 'image', target: 'web', preset: 'ios' },
      imageGenerationEnabled: true,
      imageGenerationAvailable: true,
      onProfileChange: vi.fn()
    }))

    expect(html).toContain('ds-design-profile-summary')
    expect(html).toContain('designConfiguration')
    expect(html).toContain('designOutputImage · designTargetWeb · iOS / Apple')
    expect(html).not.toContain('role="radiogroup"')
    expect(html.match(/<summary/g)).toHaveLength(1)
    expect(html.match(/<select/g)).toBeNull()
    expect(html).toContain('data-profile-select="output"')
    expect(html).toContain('data-profile-select="target"')
    expect(html).toContain('data-design-style-picker')
    expect(html).toContain('aria-haspopup="listbox"')
  })

  it('identifies the immutable project DESIGN.md source after admission', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerTaskProfile, {
      surface: 'design',
      locked: false,
      profileLocked: true,
      profile: {
        ...htmlProfile,
        presetSource: 'root-design-md',
        styleSourceName: 'Acme Product',
        styleSourceHash: 'sha256:abc'
      },
      imageGenerationEnabled: true,
      imageGenerationAvailable: true
    }))

    expect(html).toContain('data-design-style-source="root-design-md"')
    expect(html).toContain('designStyleProjectSource')
    expect(html).toContain('Acme Product · sha256:abc')
  })
})
