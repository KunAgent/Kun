import { describe, expect, it } from 'vitest'
import {
  buildUiPluginTokenCss,
  isSafeUiPluginFigurePath,
  normalizeUiPluginManifest,
  resolveUiPluginFigure
} from './ui-plugin'

const validManifest = {
  id: 'starlight',
  name: '星夜模式',
  version: '1.0.0',
  author: 'tester',
  description: 'demo pack',
  figures: {
    swim: 'img/swim.png',
    greet: 'img/greet.webp'
  },
  labels: { zh: { working: '巡航中…' }, en: { working: 'Cruising…' } },
  tokens: { light: { '--ds-accent': '#8a63e8' }, dark: { '--ds-accent': '#b39df2' } },
  features: { cameos: true }
}

describe('normalizeUiPluginManifest', () => {
  it('accepts a fully-featured valid manifest', () => {
    const result = normalizeUiPluginManifest(validManifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('starlight')
    expect(result.manifest.figures.swim).toBe('img/swim.png')
    expect(result.manifest.labels?.zh?.working).toBe('巡航中…')
    expect(result.manifest.features?.cameos).toBe(true)
  })

  it('does not accept host effects from plugin-authored manifests', () => {
    const result = normalizeUiPluginManifest({
      ...validManifest,
      hostEffect: { kind: 'shuimo-yijing' }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest).not.toHaveProperty('hostEffect')
  })

  it('rejects reserved and malformed ids', () => {
    for (const id of ['default', 'kun', 'ON', 'a', 'Has Space', '../x']) {
      const result = normalizeUiPluginManifest({ ...validManifest, id })
      expect(result.ok).toBe(false)
    }
  })

  it('allows the bundled ikun id (iKun ships as a pre-installed plugin)', () => {
    expect(normalizeUiPluginManifest({ ...validManifest, id: 'ikun' }).ok).toBe(true)
  })

  it('rejects traversal, absolute paths, and non-image extensions in figures', () => {
    for (const path of ['../escape.png', '/abs.png', 'img/../../x.png', 'img/script.svg', 'img/run.js', 'img\\win.png']) {
      const result = normalizeUiPluginManifest({
        ...validManifest,
        figures: { swim: path }
      })
      expect(result.ok, path).toBe(false)
    }
  })

  it('rejects unknown slots, locales, label keys, and oversized labels', () => {
    expect(normalizeUiPluginManifest({ ...validManifest, figures: { hat: 'img/h.png' } }).ok).toBe(false)
    expect(
      normalizeUiPluginManifest({ ...validManifest, labels: { fr: { working: 'oui' } } }).ok
    ).toBe(false)
    expect(
      normalizeUiPluginManifest({ ...validManifest, labels: { zh: { bogus: 'x' } } }).ok
    ).toBe(false)
    expect(
      normalizeUiPluginManifest({
        ...validManifest,
        labels: { zh: { working: 'x'.repeat(25) } }
      }).ok
    ).toBe(false)
  })

  it('rejects non-whitelisted token names and unsafe values', () => {
    expect(
      normalizeUiPluginManifest({
        ...validManifest,
        tokens: { light: { '--evil': 'red' } }
      }).ok
    ).toBe(false)
    for (const value of ['red; background: url(x)', 'url(http://x)', 'a}b{', 'x\\65 xpression']) {
      const result = normalizeUiPluginManifest({
        ...validManifest,
        tokens: { light: { '--ds-accent': value } }
      })
      expect(result.ok, value).toBe(false)
    }
  })

  it('requires at least one figure', () => {
    expect(normalizeUiPluginManifest({ ...validManifest, figures: {} }).ok).toBe(false)
  })
})

describe('isSafeUiPluginFigurePath', () => {
  it('accepts nested relative image paths', () => {
    expect(isSafeUiPluginFigurePath('img/a/b/figure.png')).toBe(true)
    expect(isSafeUiPluginFigurePath('cover.webp')).toBe(true)
  })
})

describe('buildUiPluginTokenCss', () => {
  it('scopes light tokens away from dark theme and dark tokens to it', () => {
    const result = normalizeUiPluginManifest(validManifest)
    if (!result.ok) throw new Error('expected valid manifest')
    const css = buildUiPluginTokenCss(result.manifest)
    expect(css).toContain("html[data-ui-plugin='starlight']:not([data-theme='dark'])")
    expect(css).toContain("html[data-ui-plugin='starlight'][data-theme='dark']")
    expect(css).toContain('--ds-accent: #8a63e8;')
    expect(css).not.toContain('url(')
    // 同时覆盖 .ds-workbench-shell 子作用域,否则 dark 下对话区会就地重声明
    // palette token 而遮蔽插件 token(本次修复的核心)。
    expect(css).toContain("html[data-ui-plugin='starlight'][data-theme='dark'] .ds-workbench-shell")
    expect(css).toContain(
      "html[data-ui-plugin='starlight']:not([data-theme='dark']) .ds-workbench-shell"
    )
  })

  it('returns empty string when no tokens declared', () => {
    const result = normalizeUiPluginManifest({ ...validManifest, tokens: undefined })
    if (!result.ok) throw new Error('expected valid manifest')
    expect(buildUiPluginTokenCss(result.manifest)).toBe('')
  })
})

describe('resolveUiPluginFigure', () => {
  it('walks the fallback chain and returns null when nothing matches', () => {
    const figures = { sit: 'data:image/png;base64,sit' }
    expect(resolveUiPluginFigure(figures, ['run', 'sit'])).toBe('data:image/png;base64,sit')
    expect(resolveUiPluginFigure(figures, ['run', 'swim'])).toBeNull()
    expect(resolveUiPluginFigure(null, ['swim'])).toBeNull()
  })
})
