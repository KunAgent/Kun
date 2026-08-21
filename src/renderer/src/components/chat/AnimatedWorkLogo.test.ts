import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveUiPluginFigure } from '@shared/ui-plugin'
import { useUiPluginStore } from '../../store/ui-plugin-store'
import { readStylesheetBundle } from '../../testing/stylesheet-bundle'
import enCommon from '../../locales/en/common'
import zhCommon from '../../locales/zh/common'
import {
  AnimatedWorkLogo,
  IKUN_CAMEO_DURATIONS_MS,
  IKUN_CAMEO_TYPES,
  IkunCameo,
  IKUN_WORK_LOGO_VARIANTS,
  IKUN_WORK_LOGO_VARIANT_LABEL_KEYS,
  KUN_CELEBRATION_DURATIONS_MS,
  KUN_CELEBRATION_VARIANTS,
  KunCelebration,
  KunStateFigure,
  SidebarMascot,
  UI_PLUGIN_CAMEO_SLOTS,
  UI_PLUGIN_CELEBRATION_SLOTS,
  UI_PLUGIN_STATE_SLOTS,
  WORK_LOGO_SWIM_MODES,
  WORK_LOGO_SWIM_MODE_LABEL_KEYS,
  pickIkunCameo,
  pickKunCelebration
} from './AnimatedWorkLogo'
import { WorkMetaRow } from './message-timeline-cards'

describe('AnimatedWorkLogo', () => {
  it('ships the Kun bird asset used as the default work mark', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const birdFigure = await readFile(new URL('../../../../asset/img/kun_bird.png', import.meta.url))

    expect(pngDimensions(birdFigure)).toEqual({ width: 751, height: 512 })
  })

  it('renders layered logo markup for swim animation', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedWorkLogo, { active: true, className: 'extra-class', size: 'md' })
    )

    expect(html).toContain('ds-work-logo')
    expect(html).toContain('ds-work-logo-md')
    expect(html).toContain('ds-work-logo-phase-lead')
    expect(html).toContain('is-active')
    expect(html).toContain('extra-class')
    expect(html).toContain('ds-work-logo-gust')
    expect(html).toContain('ds-work-logo-current')
    expect(html).toContain('ds-work-logo-swell')
    expect(html).toContain('ds-work-logo-wave-back')
    expect(html).toContain('ds-work-logo-ripple')
    expect(html).toContain('ds-work-logo-wave-front')
    expect(html).toContain('ds-work-logo-breaker')
    expect(html).toContain('ds-work-logo-wake')
    expect(html).toContain('ds-work-logo-foam')
    expect(html).toContain('ds-work-logo-crest')
    expect(html).toContain('ds-work-logo-splash')
    expect(html).toContain('ds-work-logo-spray')
    expect(html).toContain('ds-work-logo-bubbles')
    expect(html).toContain('ds-work-logo-echo')
    expect(html).toContain('ds-work-logo-track')
    expect(html).toContain('ds-work-logo-body')
    expect(html).toContain('ds-work-logo-image')
    expect(html).toContain('ds-ikun-logo')
    expect(html).toContain('ds-ikun-figure')
    expect(html).toMatch(/ds-ikun-logo-(dribble|run|boba)/)
    expect(html).toMatch(/ds-work-logo-mode-(propel|sprint|dive|surf)/)
  })

  it('renders the state figures with their kind classes', () => {
    for (const kind of ['greet', 'sleep', 'sit'] as const) {
      const html = renderToStaticMarkup(createElement(KunStateFigure, { kind }))
      expect(html).toContain(`ds-kun-state-${kind}`)
      expect(html).toContain('ds-kun-state-figure')
      expect(html).toContain('ds-ikun-state-figure')
    }
  })

  describe('UI plugin slot fallback chains', () => {
    const figures = {
      swim: 'data:image/png;base64,SWIM',
      greet: 'data:image/png;base64,GREET'
    }

    it('every surface chain ends at swim so partial skins always resolve', () => {
      const chains = [
        ...Object.values(UI_PLUGIN_STATE_SLOTS),
        ...Object.values(UI_PLUGIN_CAMEO_SLOTS),
        ...Object.values(UI_PLUGIN_CELEBRATION_SLOTS)
      ]
      for (const chain of chains) {
        expect(chain[chain.length - 1]).toBe('swim')
      }
    })

    it('resolves missing slots through the chains', () => {
      expect(resolveUiPluginFigure(figures, UI_PLUGIN_STATE_SLOTS.greet)).toBe(figures.greet)
      // sleep 槽位缺失 → 回退链最终落到 swim
      expect(resolveUiPluginFigure(figures, UI_PLUGIN_STATE_SLOTS.sleep)).toBe(figures.swim)
      expect(resolveUiPluginFigure(figures, UI_PLUGIN_CAMEO_SLOTS.dash)).toBe(figures.swim)
      expect(resolveUiPluginFigure(figures, UI_PLUGIN_CELEBRATION_SLOTS.cheer)).toBe(figures.greet)
      expect(resolveUiPluginFigure(null, UI_PLUGIN_STATE_SLOTS.greet)).toBeNull()
    })

    it('keeps default art when no plugin is active', () => {
      expect(useUiPluginStore.getState().activeRuntime).toBeNull()
      const html = renderToStaticMarkup(createElement(KunStateFigure, { kind: 'greet' }))
      expect(html).not.toContain('data:image')
      expect(html).toContain('ds-kun-state-figure')
    })
  })

  it('pins the swim mode when one is provided', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedWorkLogo, { active: true, mode: 'dive' })
    )

    expect(html).toContain('ds-work-logo-mode-dive')
  })

  it('pins the ikun variant when one is provided', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedWorkLogo, { active: true, ikunVariant: 'boba' })
    )

    expect(html).toContain('ds-ikun-logo-boba')
  })

  it('renders the sidebar mascot with a state figure', () => {
    const html = renderToStaticMarkup(createElement(SidebarMascot))

    expect(html).toContain('ds-sidebar-mascot')
    expect(html).toMatch(/ds-kun-state-(sit|greet|sleep)/)
  })

  it('renders every ikun cameo type with side classes', () => {
    for (const type of ['dash', 'peek', 'boba', 'nap'] as const) {
      const html = renderToStaticMarkup(createElement(IkunCameo, { cameo: { type, side: 'left' } }))
      expect(html).toContain(`ds-ikun-cameo-${type}`)
      expect(html).toContain('is-left')
      expect(html).toContain('ds-ikun-cameo-figure')
    }

    const chaseHtml = renderToStaticMarkup(
      createElement(IkunCameo, { cameo: { type: 'chase', side: 'right' } })
    )
    expect(chaseHtml.match(/ds-ikun-cameo-dash/g)?.length).toBe(2)
    expect(chaseHtml).toContain('is-second')
  })

  it('renders every celebration variant with dual figures and confetti', () => {
    for (const variant of KUN_CELEBRATION_VARIANTS) {
      const html = renderToStaticMarkup(createElement(KunCelebration, { variant }))
      expect(html).toContain(`ds-kun-celebration-${variant}`)
      expect(html).toContain('is-kun')
      expect(html).toContain('is-ikun')
      expect(html).toContain('ds-kun-confetti')
      expect(html.match(/<i><\/i>/g)?.length).toBe(10)
      expect(KUN_CELEBRATION_DURATIONS_MS[variant]).toBeGreaterThan(0)
    }
  })

  it('picks valid celebration variants with increasing ids', () => {
    const first = pickKunCelebration()
    const second = pickKunCelebration()

    expect(KUN_CELEBRATION_VARIANTS).toContain(first.variant)
    expect(second.id).toBeGreaterThan(first.id)
  })

  it('picks valid cameo specs with increasing ids and complete durations', () => {
    const first = pickIkunCameo()
    const second = pickIkunCameo()

    expect(IKUN_CAMEO_TYPES).toContain(first.type)
    expect(['left', 'right']).toContain(first.side)
    expect(second.id).toBeGreaterThan(first.id)

    for (const type of IKUN_CAMEO_TYPES) {
      expect(IKUN_CAMEO_DURATIONS_MS[type]).toBeGreaterThan(0)
    }
  })

  it('maps every swim mode and ikun variant to a status label key in both locales', () => {
    const zh = zhCommon as Record<string, unknown>
    const en = enCommon as Record<string, unknown>

    for (const swimMode of WORK_LOGO_SWIM_MODES) {
      const labelKey = WORK_LOGO_SWIM_MODE_LABEL_KEYS[swimMode]
      expect(labelKey).toBeTruthy()
      expect(zh[labelKey]).toBeTruthy()
      expect(en[labelKey]).toBeTruthy()
    }

    for (const variant of IKUN_WORK_LOGO_VARIANTS) {
      const labelKey = IKUN_WORK_LOGO_VARIANT_LABEL_KEYS[variant]
      expect(labelKey).toBeTruthy()
      expect(zh[labelKey]).toBeTruthy()
      expect(en[labelKey]).toBeTruthy()
    }
  })

  it('defaults to a static logo unless active', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo))

    expect(html).toContain('ds-work-logo')
    expect(html).toContain('ds-work-logo-phase-lead')
    expect(html).not.toContain('is-active')
  })

  it('keeps wave and splash layers mounted in static state to avoid layout churn', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo, { size: 'sm' }))

    expect(html).toContain('ds-work-logo-sm')
    expect(html).toContain('ds-work-logo-gust')
    expect(html).toContain('ds-work-logo-swell')
    expect(html).toContain('ds-work-logo-wave-back')
    expect(html).toContain('ds-work-logo-wave-front')
    expect(html).toContain('ds-work-logo-breaker')
    expect(html).toContain('ds-work-logo-foam')
    expect(html).toContain('ds-work-logo-crest')
    expect(html).toContain('ds-work-logo-splash')
    expect(html).toContain('ds-work-logo-spray')
    expect(html).not.toContain('is-active')
  })

  it('can render a desynchronized trailing phase', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo, { active: true, phase: 'trail' }))

    expect(html).toContain('is-active')
    expect(html).toContain('ds-work-logo-phase-trail')
  })

  it('keeps the processing work row as a static elapsed-time divider', () => {
    const html = renderToStaticMarkup(
      createElement(WorkMetaRow, {
        processing: true,
        durationMs: 74_000,
        expanded: true,
        collapsible: false,
        onToggle: () => undefined
      })
    )

    expect(html).toMatch(/Processing|处理中|processing/)
    expect(html).toContain('1m 14s')
    expect(html).toContain('border-b')
    expect(html).not.toContain('ds-shiny-text')
    expect(html).not.toContain('ds-work-logo-slot')
    expect(html).not.toContain('aria-expanded')
  })

  it('labels collapsed completed work without a step count', () => {
    const html = renderToStaticMarkup(
      createElement(WorkMetaRow, {
        processing: false,
        durationMs: 101_000,
        expanded: false,
        onToggle: () => undefined
      })
    )

    expect(html).toMatch(/Processed 1m 41s|已处理 1m 41s/)
    expect(html).not.toMatch(/steps|步|Work process|工作过程/)
    expect(html).toContain('aria-expanded="false"')
  })

  it('keeps the swim animation layers wired in CSS', async () => {
    const baseShellCss = await readStylesheetBundle(new URL('../../styles/base-shell.css', import.meta.url))

    for (const layer of [
      'gust',
      'swell',
      'wave-front',
      'breaker',
      'wake',
      'foam',
      'waterline',
      'crest',
      'splash',
      'spray',
      'bubbles'
    ]) {
      expect(baseShellCss).toContain(`ds-work-logo-${layer}`)
    }

    expect(baseShellCss).toContain('.ds-work-logo.is-active .ds-work-logo-body::after')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-waterline')
    expect(baseShellCss).not.toContain('ds-work-logo-tail')
    expect(baseShellCss).not.toContain('transform: translateZ(0) scaleX(-1)')
    expect(baseShellCss).toContain('.ds-work-logo.ds-work-logo-mode-sprint')
    expect(baseShellCss).toContain('.ds-work-logo.ds-work-logo-mode-dive')
    expect(baseShellCss).toContain('.ds-work-logo.ds-work-logo-mode-surf')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-sprint-path')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-dive-path')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-dive-figure')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-surf-path')
    expect(baseShellCss).toContain('@keyframes ds-kun-greet-wave')
    expect(baseShellCss).toContain('@keyframes ds-kun-sleep-breathe')
    expect(baseShellCss).toContain('@keyframes ds-kun-sit-sway')
    expect(baseShellCss).toContain('.ds-work-logo:hover')
    expect(baseShellCss).toContain('.ds-kun-state:hover')
    expect(baseShellCss).toContain("[data-ikun-mode='on'] .ds-work-logo .ds-ikun-logo")
    expect(baseShellCss).toContain("[data-ikun-mode='on'] {")
    expect(baseShellCss).toContain("[data-theme='dark'][data-ikun-mode='on'],")
    expect(baseShellCss).toContain("[data-theme='dark'][data-ikun-mode='on'] .ds-workbench-shell")
    expect(baseShellCss).toContain('@keyframes ds-ikun-dribble')
    expect(baseShellCss).toContain('@keyframes ds-ikun-run')
    expect(baseShellCss).toContain('@keyframes ds-ikun-boba')
    expect(baseShellCss).toContain('.ds-ikun-cameo-layer')
    expect(baseShellCss).toContain('@keyframes ds-ikun-cameo-cross')
    expect(baseShellCss).toContain('@keyframes ds-ikun-cameo-peek')
    expect(baseShellCss).toContain('@keyframes ds-ikun-cameo-rise')
    expect(baseShellCss).toContain('@keyframes ds-ikun-cameo-doze')
    expect(baseShellCss).toContain('.ds-kun-celebration-layer')
    expect(baseShellCss).toContain('@keyframes ds-kun-celebrate-cheer')
    expect(baseShellCss).toContain('@keyframes ds-kun-celebrate-lap')
    expect(baseShellCss).toContain('@keyframes ds-kun-celebrate-toast')
    expect(baseShellCss).toContain('@keyframes ds-kun-confetti-burst')
    expect(baseShellCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-ikun-cameo-layer")
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-kun-celebration-layer")
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-kun-state")
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-work-logo")
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-work-logo-slot:has(.ds-work-logo)")
    expect(baseShellCss).toContain('display: none !important;')
    expect(baseShellCss).not.toContain("[data-focus-mode='on'] .ds-shiny-text")
    expect(baseShellCss).not.toContain("[data-focus-mode='on'] .ds-runtime-wake-shell::before")
  })

  it('keeps generated Kun PNG icon dimensions stable for packaging', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const appIcon = await readFile(new URL('../../../../asset/img/kun.png', import.meta.url))
    const macIcon = await readFile(new URL('../../../../asset/img/kun_mac.png', import.meta.url))
    const trayIcon = await readFile(new URL('../../../../asset/img/kun_tray.png', import.meta.url))
    const macTrayIcon = await readFile(
      new URL('../../../../asset/img/kun_tray_mac.png', import.meta.url)
    )
    const macRetinaTrayIcon = await readFile(
      new URL('../../../../asset/img/kun_tray_mac@2x.png', import.meta.url)
    )

    expect(pngDimensions(appIcon)).toEqual({ width: 1254, height: 1254 })
    expect(pngDimensions(macIcon)).toEqual({ width: 1024, height: 1024 })
    expect(pngDimensions(trayIcon)).toEqual({ width: 954, height: 994 })
    expect(pngDimensions(macTrayIcon)).toEqual({ width: 16, height: 16 })
    expect(pngDimensions(macRetinaTrayIcon)).toEqual({ width: 32, height: 32 })
  })

  it('ships the iKun figure asset used by ikun mode', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const ikunFigure = await readFile(new URL('../../../../asset/img/ikun.png', import.meta.url))

    expect(pngDimensions(ikunFigure)).toEqual({ width: 512, height: 512 })
  })

  it('ships the Kun state figure assets', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const expected: Record<string, { width: number; height: number }> = {
      kun_greet: { width: 512, height: 460 },
      kun_sleep: { width: 512, height: 390 },
      kun_surf: { width: 512, height: 479 },
      kun_sit: { width: 512, height: 493 }
    }

    for (const [name, dimensions] of Object.entries(expected)) {
      const figure = await readFile(new URL(`../../../../asset/img/${name}.png`, import.meta.url))
      expect(pngDimensions(figure)).toEqual(dimensions)
    }
  })

  it('ships the iKun state and variant figure assets', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const expected: Record<string, { width: number; height: number }> = {
      ikun_sleep: { width: 455, height: 512 },
      ikun_boba: { width: 422, height: 512 },
      ikun_run: { width: 378, height: 512 },
      ikun_wave: { width: 435, height: 512 },
      ikun_stand: { width: 368, height: 512 }
    }

    for (const [name, dimensions] of Object.entries(expected)) {
      const figure = await readFile(new URL(`../../../../asset/img/${name}.png`, import.meta.url))
      expect(pngDimensions(figure)).toEqual(dimensions)
    }
  })
})

function pngDimensions(buffer: Uint8Array): { width: number; height: number } {
  const signature = [...buffer.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  expect(signature).toBe('89504e470d0a1a0a')
  return {
    width: readUint32BE(buffer, 16),
    height: readUint32BE(buffer, 20)
  }
}

function readUint32BE(buffer: Uint8Array, offset: number): number {
  return (
    buffer[offset] * 16_777_216 +
    buffer[offset + 1] * 65_536 +
    buffer[offset + 2] * 256 +
    buffer[offset + 3]
  )
}
