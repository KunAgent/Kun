import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KunStartupArtwork } from './KunStartupArtwork'
import {
  KUN_STARTUP_VARIANT_CONFIG,
  KUN_STARTUP_VARIANTS,
  selectKunStartupVariant,
  type KunStartupVariant
} from './kun-startup-variants'

describe('selectKunStartupVariant', () => {
  it.each<[number, KunStartupVariant]>([
    [0, 'signal'],
    [0.199999, 'signal'],
    [0.2, 'wave'],
    [0.399999, 'wave'],
    [0.4, 'dash'],
    [0.599999, 'dash'],
    [0.6, 'focus'],
    [0.799999, 'focus'],
    [0.8, 'cast'],
    [0.999999, 'cast']
  ])('maps random value %s to %s', (randomValue, expected) => {
    expect(selectKunStartupVariant(randomValue)).toBe(expected)
  })

  it('clamps out-of-contract values to a stable endpoint', () => {
    expect(selectKunStartupVariant(-1)).toBe('signal')
    expect(selectKunStartupVariant(Number.NaN)).toBe('signal')
    expect(selectKunStartupVariant(1)).toBe('cast')
    expect(selectKunStartupVariant(Number.POSITIVE_INFINITY)).toBe('signal')
  })
})

describe('KunStartupArtwork variants', () => {
  it.each(KUN_STARTUP_VARIANTS)('renders the paired %s character resources', (variant) => {
    const html = renderToStaticMarkup(createElement(KunStartupArtwork, {
      motion: 'running',
      variant
    }))

    expect(html).toContain(`data-variant="${variant}"`)
    expect(html).toContain('data-testid="kun-startup-artwork"')
    expect(html).toContain('data-testid="kun-startup-kun"')
    expect(html).toContain('data-testid="kun-startup-bird"')
    expect(html).toContain('data-testid="kun-startup-prop"')
    expect(html).toContain('data-testid="kun-startup-workspace-link"')
    expect(html).toContain(`src="${KUN_STARTUP_VARIANT_CONFIG[variant].avatarUrl}"`)
    expect(html).toContain(`src="${KUN_STARTUP_VARIANT_CONFIG[variant].birdUrl}"`)
    expect(html).toContain(`src="${KUN_STARTUP_VARIANT_CONFIG[variant].propUrl}"`)
    expect(html).not.toContain('kun-startup-artwork__console')
    expect(html).not.toContain('kun-startup-artwork__ground-glow')
  })

  it('defaults to the signal variant for existing callers', () => {
    const html = renderToStaticMarkup(createElement(KunStartupArtwork, { motion: 'paused' }))

    expect(html).toContain('data-variant="signal"')
    expect(html).toContain(`src="${KUN_STARTUP_VARIANT_CONFIG.signal.avatarUrl}"`)
    expect(html).toContain(`src="${KUN_STARTUP_VARIANT_CONFIG.signal.birdUrl}"`)
    expect(html).toContain(`src="${KUN_STARTUP_VARIANT_CONFIG.signal.propUrl}"`)
  })

  it.each(['avatarUrl', 'birdUrl', 'propUrl'] as const)(
    'keeps every configured %s resource unique',
    (resourceKey) => {
      const resourceUrls = KUN_STARTUP_VARIANTS.map(
        (variant) => KUN_STARTUP_VARIANT_CONFIG[variant][resourceKey]
      )

      expect(new Set(resourceUrls).size).toBe(KUN_STARTUP_VARIANTS.length)
    }
  )

  it('keeps the animated prop decorative and controlled by startup motion', () => {
    const html = renderToStaticMarkup(createElement(KunStartupArtwork, {
      motion: 'running',
      variant: 'cast'
    }))

    expect(html).toContain('kun-startup-artwork__prop-wrap kun-startup__motion')
    expect(html).toMatch(/class="kun-startup-artwork__prop"[^>]*alt=""/)
  })

  it('uses a directional workspace link instead of a rectangular console', () => {
    const html = renderToStaticMarkup(createElement(KunStartupArtwork, {
      motion: 'running',
      variant: 'signal'
    }))

    expect(html).toContain('kun-startup-artwork__workspace-flow kun-startup__motion')
    expect(html).toContain('kun-startup-artwork__workspace-icon')
  })
})
