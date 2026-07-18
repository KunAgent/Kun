import { describe, expect, it } from 'vitest'
import {
  buildUiPluginBackgroundCss,
  buildUiPluginPresentationCss,
  buildUiPluginSceneCss,
  buildUiPluginTokenCss,
  isSafeUiPluginBackgroundPath,
  isSafeUiPluginFigurePath,
  normalizeUiPluginManifest,
  resolveUiPluginFigure,
  UI_PLUGIN_LIMITS
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

const validPresentationManifest = {
  ...validManifest,
  figures: {
    ...validManifest.figures,
    portrait: 'img/portrait.png'
  },
  presentation: {
    character: {
      anchor: 'right',
      size: 'hero',
      offsetX: 4,
      offsetY: -2,
      opacity: 0.94,
      frame: 'hologram',
      motion: 'float',
      contentReserve: 'wide'
    },
    readability: {
      scrim: 'opposite-character',
      strength: 'strong'
    },
    surfaces: {
      sidebar: 'strong-glass',
      topbar: 'glass',
      composer: 'strong-glass',
      cards: 'translucent'
    }
  }
}

const sceneMotion = {
  preset: 'float',
  speed: 'slow',
  phase: 'b'
} as const

const dedicatedCharacterChromeRecipes = [
  'botanical',
  'fortune-ledger',
  'dream-gate',
  'washi',
  'scrapbook',
  'aurora',
  'synth',
  'midnight-pass',
  'nautical',
  'dimension-lab',
  'starlight'
] as const

const validSceneManifest = {
  ...validPresentationManifest,
  scene: {
    apiVersion: '1.6',
    layout: 'rail-left',
    character: {
      scale: 'hero',
      fit: 'contain',
      focalPoint: 'bottom',
      mask: 'arch',
      offsetX: 3,
      offsetY: -2,
      opacity: 0.96,
      flipX: false,
      motion: {
        preset: 'sway',
        speed: 'slow',
        phase: 'b'
      }
    },
    artwork: {
      backdrop: {
        path: 'scene/backdrop.webp',
        darkPath: 'scene/backdrop-dark.webp',
        anchor: 'center',
        size: 'full',
        fit: 'cover',
        offsetX: 0,
        offsetY: 0,
        opacity: 0.72,
        blend: 'screen',
        motion: { ...sceneMotion, preset: 'drift-x' }
      },
      frame: {
        path: 'scene/frame.png',
        anchor: 'center',
        size: 'large',
        fit: 'contain',
        offsetX: 1,
        offsetY: -1,
        opacity: 1,
        blend: 'normal',
        motion: { ...sceneMotion, preset: 'none', speed: 'normal', phase: 'a' }
      }
    },
    chrome: {
      sidebar: 'paper',
      topbar: 'editorial',
      composer: 'hologram',
      cards: 'ticket'
    }
  }
} as const

describe('normalizeUiPluginManifest', () => {
  it('accepts a fully-featured valid manifest', () => {
    const result = normalizeUiPluginManifest(validManifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('starlight')
    expect(result.manifest.figures.swim).toBe('img/swim.png')
    expect(result.manifest.labels?.zh?.working).toBe('巡航中…')
    expect(result.manifest.features?.cameos).toBe(true)
    expect(result.manifest.backgrounds).toBeUndefined()
  })

  it('strictly normalizes the host-rendered portrait presentation', () => {
    const result = normalizeUiPluginManifest(validPresentationManifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.figures.portrait).toBe('img/portrait.png')
    expect(result.manifest.presentation).toEqual(validPresentationManifest.presentation)
  })

  it('strictly normalizes a complete host-rendered scene v1.6', () => {
    const result = normalizeUiPluginManifest(validSceneManifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.scene).toEqual(validSceneManifest.scene)
    expect(result.manifest.presentation).toEqual(validPresentationManifest.presentation)
    expect(result.manifest.figures.portrait).toBe('img/portrait.png')
  })

  it('accepts every host-owned per-character chrome recipe on all four surfaces', () => {
    for (const recipe of dedicatedCharacterChromeRecipes) {
      const chrome = {
        sidebar: recipe,
        topbar: recipe,
        composer: recipe,
        cards: recipe
      }
      const result = normalizeUiPluginManifest({
        ...validSceneManifest,
        scene: { ...validSceneManifest.scene, chrome }
      })
      expect(result.ok, recipe).toBe(true)
      if (result.ok) expect(result.manifest.scene?.chrome).toEqual(chrome)
    }
  })

  it('rejects unlisted chrome recipes on each scene surface', () => {
    for (const surface of ['sidebar', 'topbar', 'composer', 'cards'] as const) {
      const result = normalizeUiPluginManifest({
        ...validSceneManifest,
        scene: {
          ...validSceneManifest.scene,
          chrome: {
            ...validSceneManifest.scene.chrome,
            [surface]: 'user-supplied-css'
          }
        }
      })
      expect(result.ok, surface).toBe(false)
    }
  })

  it('requires portrait, v1.5 fallback, and at least one artwork layer for scene v1.6', () => {
    const noPortrait = normalizeUiPluginManifest({
      ...validSceneManifest,
      figures: validManifest.figures
    })
    expect(noPortrait.ok).toBe(false)
    if (!noPortrait.ok) expect(noPortrait.errors).toContain('scene 需要同时声明 figures.portrait 人物图片')

    const noFallback = normalizeUiPluginManifest({
      ...validSceneManifest,
      presentation: undefined
    })
    expect(noFallback.ok).toBe(false)
    if (!noFallback.ok) expect(noFallback.errors).toContain('scene 需要同时声明 presentation 作为 v1.5 fallback')

    const noArtwork = normalizeUiPluginManifest({
      ...validSceneManifest,
      scene: { ...validSceneManifest.scene, artwork: {} }
    })
    expect(noArtwork.ok).toBe(false)
    if (!noArtwork.ok) expect(noArtwork.errors).toContain('scene.artwork 至少需要声明一个专属图片槽位')
  })

  it('rejects unknown scene keys, active assets, invalid blend roles, and arbitrary motion', () => {
    const invalidScenes = [
      { ...validSceneManifest.scene, selector: '.ds-chat-stage' },
      {
        ...validSceneManifest.scene,
        character: { ...validSceneManifest.scene.character, easing: 'linear' }
      },
      {
        ...validSceneManifest.scene,
        artwork: {
          frame: { ...validSceneManifest.scene.artwork.frame, path: 'scene/frame.gif' }
        }
      },
      {
        ...validSceneManifest.scene,
        artwork: {
          frame: { ...validSceneManifest.scene.artwork.frame, blend: 'screen' }
        }
      },
      {
        ...validSceneManifest.scene,
        artwork: {
          frame: {
            ...validSceneManifest.scene.artwork.frame,
            motion: { ...sceneMotion, preset: 'spring(1,2)' }
          }
        }
      }
    ]
    for (const scene of invalidScenes) {
      expect(normalizeUiPluginManifest({ ...validSceneManifest, scene }).ok).toBe(false)
    }
  })

  it('enforces bounded scene numeric fields and a boolean flip flag', () => {
    for (const [key, value] of [
      ['offsetX', 13],
      ['offsetY', -13],
      ['opacity', Number.NaN],
      ['opacity', 1.01],
      ['flipX', 'yes']
    ] as const) {
      expect(normalizeUiPluginManifest({
        ...validSceneManifest,
        scene: {
          ...validSceneManifest.scene,
          character: { ...validSceneManifest.scene.character, [key]: value }
        }
      }).ok, `${key}=${String(value)}`).toBe(false)
    }
  })

  it('requires a portrait whenever presentation is declared', () => {
    const result = normalizeUiPluginManifest({
      ...validPresentationManifest,
      figures: validManifest.figures
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContain('presentation 需要同时声明 figures.portrait 人物图片')
  })

  it('rejects unknown presentation keys and arbitrary strings', () => {
    const invalidPresentations = [
      {
        ...validPresentationManifest.presentation,
        selector: '.ds-chat-stage'
      },
      {
        ...validPresentationManifest.presentation,
        character: {
          ...validPresentationManifest.presentation.character,
          css: 'position:fixed',
          anchor: 'center'
        }
      },
      {
        ...validPresentationManifest.presentation,
        readability: {
          ...validPresentationManifest.presentation.readability,
          scrim: 'linear-gradient(red, blue)'
        }
      },
      {
        ...validPresentationManifest.presentation,
        surfaces: {
          ...validPresentationManifest.presentation.surfaces,
          composer: 'url(https://example.test/x)'
        }
      }
    ]
    for (const presentation of invalidPresentations) {
      expect(
        normalizeUiPluginManifest({ ...validPresentationManifest, presentation }).ok
      ).toBe(false)
    }
  })

  it('enforces integer offsets and finite 0-1 presentation opacity', () => {
    for (const [key, value] of [
      ['offsetX', 12.5],
      ['offsetX', 13],
      ['offsetY', -13],
      ['opacity', Number.NaN],
      ['opacity', Number.POSITIVE_INFINITY],
      ['opacity', -0.01],
      ['opacity', 1.01]
    ] as const) {
      const presentation = {
        ...validPresentationManifest.presentation,
        character: {
          ...validPresentationManifest.presentation.character,
          [key]: value
        }
      }
      expect(
        normalizeUiPluginManifest({ ...validPresentationManifest, presentation }).ok,
        `${key}=${String(value)}`
      ).toBe(false)
    }
  })

  it('accepts a background-only plugin and keeps normalized figures compatible', () => {
    const result = normalizeUiPluginManifest({
      id: 'background-only',
      name: 'Background only',
      version: '1.0.0',
      backgrounds: { light: { app: 'img/app.png' } }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.figures).toEqual({})
    expect(result.manifest.backgrounds?.light?.app).toEqual({
      path: 'img/app.png',
      fit: 'cover',
      position: 'center',
      opacity: 0.22
    })
  })

  it('normalizes shorthand and per-slot background defaults', () => {
    const result = normalizeUiPluginManifest({
      ...validManifest,
      figures: {},
      backgrounds: {
        dark: {
          app: 'bg/app.jpeg',
          sidebar: 'bg/sidebar.webp',
          stage: 'bg/stage.jpg'
        }
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.backgrounds?.dark).toEqual({
      app: { path: 'bg/app.jpeg', fit: 'cover', position: 'center', opacity: 0.22 },
      sidebar: { path: 'bg/sidebar.webp', fit: 'cover', position: 'center', opacity: 0.18 },
      stage: { path: 'bg/stage.jpg', fit: 'cover', position: 'center', opacity: 0.32 }
    })
  })

  it('normalizes an explicit background layer without replacing supplied values', () => {
    const result = normalizeUiPluginManifest({
      ...validManifest,
      backgrounds: {
        light: {
          stage: {
            path: 'bg/stage.png',
            fit: 'contain',
            position: 'bottom-right',
            opacity: 0
          }
        }
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.backgrounds?.light?.stage).toEqual({
      path: 'bg/stage.png',
      fit: 'contain',
      position: 'bottom-right',
      opacity: 0
    })
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
    for (const path of [
      '../escape.png',
      '/abs.png',
      'img/../../x.png',
      'img/script.svg',
      'img/run.js',
      'img\\win.png'
    ]) {
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
    for (const value of [
      'red; background: url(x)',
      'url(http://x)',
      'URL(//host/x)',
      'url (//host/x)',
      'uRl\n\t(//host/x)',
      'a}b{',
      'x\\65 xpression'
    ]) {
      const result = normalizeUiPluginManifest({
        ...validManifest,
        tokens: { light: { '--ds-accent': value } }
      })
      expect(result.ok, value).toBe(false)
    }
  })

  it('requires at least one figure or background resource', () => {
    expect(normalizeUiPluginManifest({ ...validManifest, figures: {} }).ok).toBe(false)
    expect(
      normalizeUiPluginManifest({
        id: 'no-assets',
        name: 'No assets',
        version: '1.0.0'
      }).ok
    ).toBe(false)
  })

  it('strictly rejects unknown background themes, slots, and layer keys', () => {
    const invalidBackgrounds = [
      { system: { app: 'bg/app.png' } },
      { light: { dialog: 'bg/dialog.png' } },
      { light: { app: { path: 'bg/app.png', blendMode: 'multiply' } } }
    ]
    for (const backgrounds of invalidBackgrounds) {
      expect(normalizeUiPluginManifest({ ...validManifest, backgrounds }).ok).toBe(false)
    }
  })

  it('strictly rejects invalid background layer values', () => {
    const invalidLayers = [
      null,
      42,
      {},
      { path: 'bg/app.gif' },
      { path: 'bg/app.svg' },
      { path: '../app.png' },
      { path: '/app.png' },
      { path: 'bg\\app.png' },
      { path: 'bg/app.png', fit: 'fill' },
      { path: 'bg/app.png', position: '25% 30%' },
      { path: 'bg/app.png', opacity: Number.NaN },
      { path: 'bg/app.png', opacity: Number.POSITIVE_INFINITY },
      { path: 'bg/app.png', opacity: -0.01 },
      { path: 'bg/app.png', opacity: 1.01 },
      { path: 'bg/app.png', opacity: '0.5' }
    ]
    for (const layer of invalidLayers) {
      const result = normalizeUiPluginManifest({
        ...validManifest,
        backgrounds: { light: { app: layer } }
      })
      expect(result.ok, JSON.stringify(layer)).toBe(false)
    }
  })

  it('exposes the background and aggregate limits used by the host', () => {
    expect(UI_PLUGIN_LIMITS).toMatchObject({
      portraitPreviewBytes: 96 * 1024,
      portraitPreviewMaxDimension: 256,
      backgroundBytes: 8 * 1024 * 1024,
      totalBackgroundBytes: 32 * 1024 * 1024,
      totalAssetBytes: 48 * 1024 * 1024,
      backgroundMaxDimension: 8192,
      backgroundMaxPixels: 24_000_000,
      totalBackgroundPixels: 64_000_000,
      sceneAssetBytes: 4 * 1024 * 1024,
      totalSceneAssetBytes: 16 * 1024 * 1024,
      sceneAssetMaxDimension: 4096,
      sceneAssetMaxPixels: 12_000_000,
      totalSceneAssetPixels: 40_000_000
    })
  })
})

describe('isSafeUiPluginFigurePath', () => {
  it('accepts nested relative image paths', () => {
    expect(isSafeUiPluginFigurePath('img/a/b/figure.png')).toBe(true)
    expect(isSafeUiPluginFigurePath('cover.webp')).toBe(true)
  })
})

describe('isSafeUiPluginBackgroundPath', () => {
  it('allows raster background formats but not animated or executable formats', () => {
    for (const path of ['bg/app.png', 'bg/app.webp', 'bg/app.jpg', 'bg/app.jpeg']) {
      expect(isSafeUiPluginBackgroundPath(path), path).toBe(true)
    }
    for (const path of ['bg/app.gif', 'bg/app.svg', 'bg/app.html', '../app.png']) {
      expect(isSafeUiPluginBackgroundPath(path), path).toBe(false)
    }
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

describe('buildUiPluginPresentationCss', () => {
  it('emits only scoped host numeric variables', () => {
    const result = normalizeUiPluginManifest(validPresentationManifest)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    const css = buildUiPluginPresentationCss(result.manifest)
    expect(css).toBe(
      "html[data-ui-plugin='starlight'] {\n" +
        '  --kun-ui-plugin-character-offset-x: 4%;\n' +
        '  --kun-ui-plugin-character-offset-y: -2%;\n' +
        '  --kun-ui-plugin-character-opacity: 0.94;\n' +
        '}'
    )
    expect(css).not.toContain('hologram')
    expect(css).not.toContain('opposite-character')
    expect(css).not.toContain('url(')
  })

  it('returns no CSS for a manifest without presentation', () => {
    const result = normalizeUiPluginManifest(validManifest)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    expect(buildUiPluginPresentationCss(result.manifest)).toBe('')
  })

  it('keeps gradient stage tokens separate from presentation numeric CSS', () => {
    const result = normalizeUiPluginManifest({
      ...validPresentationManifest,
      tokens: {
        light: {
          '--ds-bg-main': 'linear-gradient(180deg,#fff 0%,#eef2ff 100%)'
        }
      }
    })
    if (!result.ok) throw new Error(result.errors.join('\n'))
    expect(buildUiPluginTokenCss(result.manifest)).toContain(
      '--ds-bg-main: linear-gradient(180deg,#fff 0%,#eef2ff 100%);'
    )
    expect(buildUiPluginPresentationCss(result.manifest)).not.toContain('--ds-bg-main')
  })

  it('defensively rejects unnormalized numeric presentation values', () => {
    const result = normalizeUiPluginManifest(validPresentationManifest)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    expect(
      buildUiPluginPresentationCss({
        ...result.manifest,
        presentation: {
          ...result.manifest.presentation!,
          character: {
            ...result.manifest.presentation!.character,
            offsetX: 99
          }
        }
      })
    ).toBe('')
  })
})

describe('buildUiPluginSceneCss', () => {
  it('emits only scoped bounded numeric scene variables', () => {
    const result = normalizeUiPluginManifest(validSceneManifest)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    const css = buildUiPluginSceneCss(result.manifest)
    expect(css).toContain("html[data-ui-plugin='starlight']")
    expect(css).toContain('--kun-ui-plugin-scene-character-offset-x: 3%;')
    expect(css).toContain('--kun-ui-plugin-scene-character-offset-y: -2%;')
    expect(css).toContain('--kun-ui-plugin-scene-character-opacity: 0.96;')
    expect(css).toContain('--kun-ui-plugin-scene-frame-offset-x: 1%;')
    expect(css).toContain('--kun-ui-plugin-scene-backdrop-opacity: 0.72;')
    expect(css).not.toContain('scene/frame.png')
    expect(css).not.toContain('rail-left')
    expect(css).not.toContain('sway')
  })

  it('returns no CSS without scene and rejects unnormalized scene numbers', () => {
    const legacy = normalizeUiPluginManifest(validPresentationManifest)
    if (!legacy.ok) throw new Error(legacy.errors.join('\n'))
    expect(buildUiPluginSceneCss(legacy.manifest)).toBe('')

    const scene = normalizeUiPluginManifest(validSceneManifest)
    if (!scene.ok) throw new Error(scene.errors.join('\n'))
    expect(buildUiPluginSceneCss({
      ...scene.manifest,
      scene: {
        ...scene.manifest.scene!,
        artwork: {
          ...scene.manifest.scene!.artwork,
          frame: { ...scene.manifest.scene!.artwork.frame!, offsetX: 99 }
        }
      }
    })).toBe('')
  })
})

describe('buildUiPluginBackgroundCss', () => {
  const pngDataUrl = 'data:image/png;base64,aW1hZ2U='
  const jpegDataUrl = 'data:image/jpeg;base64,AAAA'

  it('isolates light/dark themes, maps layouts, and never emits raw asset paths', () => {
    const result = normalizeUiPluginManifest({
      ...validManifest,
      backgrounds: {
        light: {
          app: {
            path: 'private/raw-app.png',
            fit: 'contain',
            position: 'top-left',
            opacity: 0.25
          },
          stage: 'private/raw-stage.png'
        },
        dark: { sidebar: 'private/raw-sidebar.jpg' }
      }
    })
    if (!result.ok) throw new Error(result.errors.join('\n'))

    const css = buildUiPluginBackgroundCss(result.manifest, {
      assets: {
        'private/raw-app.png': pngDataUrl,
        'private/raw-stage.png': pngDataUrl,
        'private/raw-sidebar.jpg': jpegDataUrl
      }
    })
    expect(css).toContain(
      "html[data-ui-plugin='starlight']:not([data-theme='dark']) .ds-workbench-shell::after"
    )
    expect(css).toContain(
      "html[data-ui-plugin='starlight']:not([data-theme='dark']) .ds-settings-surface::after"
    )
    expect(css).toContain(
      "html[data-ui-plugin='starlight']:not([data-theme='dark']) .ds-stage-surface::after"
    )
    expect(css).toContain(
      "html[data-ui-plugin='starlight']:not([data-theme='dark']) .ds-settings-stage::after"
    )
    expect(css).toContain(
      "html[data-ui-plugin='starlight'][data-theme='dark'] .ds-sidebar-shell::after"
    )
    expect(css).toContain(
      "html[data-ui-plugin='starlight'][data-theme='dark'] .ds-settings-sidebar::after"
    )
    expect(css).toContain('background-size: contain;')
    expect(css).toContain('background-position: left top;')
    expect(css).toContain('opacity: 0.25;')
    expect(css).toContain('z-index: -1;')
    expect(css).toContain('.ds-stage-route-host > *')
    expect(css).toContain('.ds-stage-design-canvas')
    expect(css).toContain('.ds-stage-design-canvas-fill')
    expect(css).toContain('background-color: transparent !important;')
    expect(css).toContain('background: var(--ds-stage-gradient);')
    expect(css).toContain(pngDataUrl)
    expect(css).toContain(jpegDataUrl)
    expect(css.split(pngDataUrl)).toHaveLength(2)
    expect(css.split(jpegDataUrl)).toHaveLength(2)
    expect(css).not.toContain('private/raw-')
    expect(css).not.toContain('.ds-stage-surface > *')
    expect(css).not.toContain('.ds-workbench-shell > *')
  })

  it('does not generate rules for missing slots', () => {
    const result = normalizeUiPluginManifest({
      ...validManifest,
      backgrounds: { light: { app: 'bg/app.png' } }
    })
    if (!result.ok) throw new Error(result.errors.join('\n'))
    const css = buildUiPluginBackgroundCss(result.manifest, { light: { app: pngDataUrl } })
    expect(css).toContain('.ds-sidebar-shell')
    expect(css).toContain('.ds-stage-surface')
    expect(css).not.toContain('.ds-sidebar-shell::after')
    expect(css).not.toContain('.ds-stage-surface::after')
    expect(css).toContain('background: transparent;')
  })

  it('keeps the legacy theme-slot runtime shape readable', () => {
    const result = normalizeUiPluginManifest({
      ...validManifest,
      backgrounds: { light: { stage: 'bg/stage.png' } }
    })
    if (!result.ok) throw new Error(result.errors.join('\n'))
    const css = buildUiPluginBackgroundCss(result.manifest, {
      light: { stage: pngDataUrl }
    })
    expect(css).toContain(pngDataUrl)
    expect(css).toContain('background-image: var(--kun-ui-plugin-background-0);')
  })

  it('rejects non-base64, active, malformed, and unsupported runtime URLs', () => {
    const result = normalizeUiPluginManifest({
      ...validManifest,
      tokens: undefined,
      backgrounds: { light: { app: 'bg/app.png' } }
    })
    if (!result.ok) throw new Error(result.errors.join('\n'))
    const invalidUrls = [
      'https://host/app.png',
      'data:image/png,AAAA',
      'data:image/svg+xml;base64,AAAA',
      'data:image/jpg;base64,AAAA',
      'data:text/html;base64,AAAA',
      'data:image/png;base64,AAA',
      'data:image/png;base64,AAAA");}body{color:red}/*'
    ]
    for (const dataUrl of invalidUrls) {
      expect(
        buildUiPluginBackgroundCss(result.manifest, { light: { app: dataUrl } }),
        dataUrl
      ).toBe('')
    }
  })

  it('emits a theme-scoped topbar rule only when the theme declares its token', () => {
    const result = normalizeUiPluginManifest({
      ...validManifest,
      tokens: {
        light: { '--ds-topbar-bg': 'rgba(255,255,255,.72)' },
        dark: { '--ds-accent': '#b39df2' }
      }
    })
    if (!result.ok) throw new Error(result.errors.join('\n'))
    const css = buildUiPluginBackgroundCss(result.manifest, {})
    expect(css).toContain(
      "html[data-ui-plugin='starlight']:not([data-theme='dark']) .ds-topbar-surface"
    )
    expect(css).toContain('background: var(--ds-topbar-bg);')
    expect(css).not.toContain(
      "html[data-ui-plugin='starlight'][data-theme='dark'] .ds-topbar-surface"
    )
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
