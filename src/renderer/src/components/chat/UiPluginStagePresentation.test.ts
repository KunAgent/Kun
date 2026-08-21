import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UiPluginPresentation, UiPluginSceneV16 } from '@shared/ui-plugin'
import { readStylesheetBundle } from '../../testing/stylesheet-bundle'
import { UiPluginStagePresentation } from './UiPluginStagePresentation'

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
  'grand-line',
  'arc-reactor',
  'dimension-lab',
  'starlight'
] as const

const presentation: UiPluginPresentation = {
  character: {
    anchor: 'right',
    size: 'hero',
    offsetX: 2,
    offsetY: -1,
    opacity: 0.95,
    frame: 'crystal',
    motion: 'breathe',
    contentReserve: 'wide'
  },
  readability: { scrim: 'opposite-character', strength: 'medium' },
  surfaces: {
    sidebar: 'glass',
    topbar: 'glass',
    composer: 'strong-glass',
    cards: 'translucent'
  }
}

const scene: UiPluginSceneV16 = {
  apiVersion: '1.6',
  layout: 'rail-left',
  character: {
    scale: 'hero',
    fit: 'contain',
    focalPoint: 'bottom',
    mask: 'arch',
    offsetX: 1,
    offsetY: -2,
    opacity: 0.96,
    flipX: false,
    motion: { preset: 'sway', speed: 'slow', phase: 'b' }
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
      motion: { preset: 'drift-x', speed: 'slow', phase: 'a' }
    },
    frame: {
      path: 'scene/frame.png',
      anchor: 'center',
      size: 'large',
      fit: 'contain',
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      blend: 'normal',
      motion: { preset: 'none', speed: 'normal', phase: 'a' }
    }
  },
  chrome: {
    sidebar: 'paper',
    topbar: 'editorial',
    composer: 'hologram',
    cards: 'ticket'
  }
}

describe('UiPluginStagePresentation', () => {
  it('renders only the fixed inert host layers and validated portrait image', () => {
    const html = renderToStaticMarkup(
      createElement(UiPluginStagePresentation, {
        portraitSrc: 'data:image/png;base64,AAAA',
        presentation
      })
    )

    expect(html).toContain('class="ds-ui-plugin-decor-layer"')
    expect(html).toContain('class="ds-ui-plugin-character-layer"')
    expect(html).toContain('class="ds-ui-plugin-character"')
    expect(html).toContain('class="ds-ui-plugin-readability-scrim"')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).toContain('alt=""')
    expect(html).toContain('draggable="false"')
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3)
    expect(html).not.toContain('<style')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })

  it('applies a normalized user scale to the legacy stage character', () => {
    const html = renderToStaticMarkup(
      createElement(UiPluginStagePresentation, {
        portraitSrc: 'data:image/png;base64,AAAA',
        presentation,
        characterScale: 1.65
      })
    )

    expect(html).toContain('--kun-ui-plugin-character-user-scale:1.65')
    expect(html.match(/--kun-ui-plugin-character-user-scale/g)).toHaveLength(1)
  })

  it('renders nothing unless both portrait and presentation are active', () => {
    expect(
      renderToStaticMarkup(
        createElement(UiPluginStagePresentation, { portraitSrc: null, presentation })
      )
    ).toBe('')
    expect(
      renderToStaticMarkup(
        createElement(UiPluginStagePresentation, {
          portraitSrc: 'data:image/png;base64,AAAA',
          presentation: null
        })
      )
    ).toBe('')
  })

  it('renders scene v1.6 through fixed inert slots and validated light/dark data images', () => {
    const html = renderToStaticMarkup(
      createElement(UiPluginStagePresentation, {
        portraitSrc: 'data:image/png;base64,AAAA',
        presentation,
        scene,
        sceneAssets: {
          assets: {
            'scene/backdrop.webp': 'data:image/webp;base64,AAAA',
            'scene/backdrop-dark.webp': 'data:image/webp;base64,AQID',
            'scene/frame.png': 'data:image/png;base64,AAAA'
          }
        }
      })
    )

    expect(html).toContain('class="ds-ui-plugin-scene-stage-layer"')
    expect(html).toContain('class="ds-ui-plugin-scene-visual-zone"')
    expect(html).toContain('ds-ui-plugin-scene-character')
    expect(html).toContain('data-scene-slot="backdrop"')
    expect(html).toContain('data-scene-variant="default"')
    expect(html).toContain('data-scene-variant="dark"')
    expect(html).toContain('data-scene-slot="frame"')
    expect(html).toContain('data-scene-motion="drift-x"')
    expect(html).toContain('data-scene-blend="screen"')
    expect(html).not.toContain('scene/backdrop.webp')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })

  it('applies the user scale only to the scene character and not scene artwork', () => {
    const html = renderToStaticMarkup(
      createElement(UiPluginStagePresentation, {
        portraitSrc: 'data:image/png;base64,AAAA',
        presentation,
        scene,
        characterScale: 0.75,
        sceneAssets: {
          assets: {
            'scene/backdrop.webp': 'data:image/webp;base64,AAAA',
            'scene/frame.png': 'data:image/png;base64,AAAA'
          }
        }
      })
    )

    expect(html).toContain('--kun-ui-plugin-character-user-scale:0.75')
    expect(html.match(/--kun-ui-plugin-character-user-scale/g)).toHaveLength(1)
  })

  it('does not render a scene artwork path when Main did not return a safe raster data URL', () => {
    const html = renderToStaticMarkup(
      createElement(UiPluginStagePresentation, {
        portraitSrc: 'data:image/png;base64,AAAA',
        presentation,
        scene,
        sceneAssets: {
          assets: {
            'scene/backdrop.webp': 'data:image/svg+xml;base64,AAAA',
            'scene/backdrop-dark.webp': 'data:image/webp;base64,AAA',
            'scene/frame.png': 'https://example.test/frame.png'
          }
        }
      })
    )

    expect(html).not.toContain('ds-ui-plugin-scene-artwork')
    expect(html).toContain('ds-ui-plugin-scene-character')
  })

  it('uses host-owned color primitives when presentation tokens may be gradients', async () => {
    const css = await readStylesheetBundle(new URL('../../styles/surfaces-write.css', import.meta.url))
    expect(css).toContain('--kun-ui-plugin-host-bg-color: var(--bg-app, #f3f5fc);')
    expect(css).toContain('--kun-ui-plugin-host-surface-color: var(--surface-2, #ffffff);')
    expect(css).toContain('var(--kun-ui-plugin-host-bg-color) 0%')
    expect(css).not.toMatch(/color-mix\([^;]*var\(--ds-bg-main\)/)
    expect(css).not.toMatch(/color-mix\([^;]*var\(--ds-surface-elevated\)/)
    expect(css).toContain("html[data-ui-plugin-scene-layout='rail-left']")
    expect(css).toContain("[data-ui-plugin-readability-scrim='opposite-character']")
    expect(css).toContain('--ds-chat-side-rail-reserve: 5.25rem;')
    expect(css).toContain(".ds-chat-stage[data-terminal-open='true']")
    expect(css).toContain("[data-scene-motion='orbit']")
    expect(css).toContain('@keyframes ds-ui-plugin-scene-sway')
    expect(css).toContain('scale: var(--kun-ui-plugin-character-user-scale, 1);')
    expect(css).toContain('calc(-1 * var(--kun-ui-plugin-character-user-scale, 1))')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('skins every application surface with each dedicated host-owned chrome recipe', async () => {
    const css = await readStylesheetBundle(new URL('../../styles/surfaces-write.css', import.meta.url))

    for (const [index, recipe] of dedicatedCharacterChromeRecipes.entries()) {
      const recipeStartMarker =
        `html[data-ui-plugin-scene-chrome-sidebar='${recipe}']`
      const recipeStart = css.indexOf(recipeStartMarker)
      expect(recipeStart, `${recipe} recipe start`).toBeGreaterThanOrEqual(0)

      const nextRecipe = dedicatedCharacterChromeRecipes[index + 1]
      const recipeEnd = nextRecipe
        ? css.indexOf(
            `html[data-ui-plugin-scene-chrome-sidebar='${nextRecipe}']`,
            recipeStart + recipeStartMarker.length
          )
        : css.indexOf('\nhtml:is(', recipeStart + recipeStartMarker.length)
      expect(recipeEnd, `${recipe} recipe end`).toBeGreaterThan(recipeStart)

      const recipeCss = css.slice(recipeStart, recipeEnd)
      for (const recipeSelector of [
        `data-ui-plugin-scene-chrome-sidebar='${recipe}'`,
        `data-ui-plugin-scene-chrome-topbar='${recipe}'`,
        `data-ui-plugin-scene-chrome-composer='${recipe}'`,
        `data-ui-plugin-scene-chrome-cards='${recipe}'`
      ]) {
        expect(recipeCss, `${recipe} selector ${recipeSelector}`).toContain(recipeSelector)
      }

      for (const hostSurface of [
        '.ds-sidebar-shell',
        '.ds-settings-sidebar',
        '.ds-topbar-surface',
        '.ds-composer-shell.ds-chat-composer',
        '.ds-user-message-bubble',
        '.ds-chat-answer',
        '.ds-card-soft',
        '.ds-card-strong',
        '.ds-card-muted',
        '.ds-card-ghost',
        '.ds-surface-soft',
        '.ds-surface-strong',
        '.ds-markdown',
        "[data-streamdown='table-wrapper']",
        '> div:last-child',
        "[data-streamdown='table']"
      ]) {
        expect(recipeCss, `${recipe} surface ${hostSurface}`).toContain(hostSurface)
      }
    }
  })

  it('keeps the Grand Line conversation card and composer status rail visually connected', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const [css, workbenchStage, sidebarFocusMode, executionPicker, nauticalCss, grandLineCss] = await Promise.all([
      readStylesheetBundle(new URL('../../styles/surfaces-write.css', import.meta.url)),
      readFile(new URL('../workbench/WorkbenchChatStage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../sidebar/SidebarFocusModeControl.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./FloatingComposerExecutionPicker.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../styles/surfaces-write/plugin-chrome-recipes.css', import.meta.url), 'utf8'),
      readFile(new URL('../../styles/surfaces-write/grand-line-sidebar.css', import.meta.url), 'utf8')
    ])

    expect(css).toContain(
      "html[data-ui-plugin-scene-chrome-cards='grand-line'] .ds-chat-answer"
    )
    expect(css).toContain("[data-streamdown='table-wrapper']")
    expect(css).toContain(
      "html[data-ui-plugin-scene-chrome-composer='grand-line'] .ds-composer-footer::before"
    )
    expect(css).toContain('.ds-ui-plugin-scene-artwork-foreground')
    expect(css).toContain('height: auto;')
    expect(css).toContain('object-position: center bottom;')
    expect(css).toContain('.ds-sidebar-mascot-slot')
    expect(css).toContain(".ds-focus-mode-toggle[aria-checked='false']")
    expect(css).toContain(".ds-focus-mode-toggle[aria-checked='true']")
    expect(css).toContain(
      "html[data-theme='dark'][data-ui-plugin-scene-chrome-sidebar='grand-line']"
    )
    expect(css).toContain(
      "html[data-theme='dark'][data-ui-plugin-scene-chrome-topbar='grand-line']"
    )
    expect(css).toContain(
      "html[data-theme='dark'][data-ui-plugin-scene-chrome-composer='grand-line']"
    )
    expect(css).toContain('.ds-composer-textarea::placeholder')
    expect(css).toContain('.ds-composer-model-picker .text-accent')
    expect(css).toContain('.ds-composer-permission-menu')
    for (const permissionMode of [
      'ask-for-approval',
      'approve-for-me',
      'full-access'
    ]) {
      expect(css).toContain(`[data-permission-mode='${permissionMode}']`)
    }
    expect(css).toContain('.session-header-compact-meta')
    expect(css).toContain(
      '.ds-message-timeline-content :is(.text-ds-ink, .text-ds-muted, .text-ds-faint)'
    )
    expect(sidebarFocusMode).toContain('ds-sidebar-focus-row')
    expect(sidebarFocusMode).toContain('ds-sidebar-mascot-slot')
    expect(sidebarFocusMode).toContain('ds-focus-mode-toggle-track')
    expect(executionPicker).toContain('ds-composer-permission-menu')
    expect(executionPicker).toContain('ds-composer-permission-option')
    expect(executionPicker).toContain('data-permission-mode={mode}')
    expect(nauticalCss).toContain(".ds-composer-permission-button[data-permission-mode='full-access']")
    expect(nauticalCss).toContain('background: transparent;')
    expect(nauticalCss).toContain('box-shadow: none;')
    expect(grandLineCss).toContain(".ds-composer-permission-button[data-permission-mode='full-access']")
    expect(grandLineCss).toContain('background: transparent !important;')
    expect(grandLineCss).toContain('clip-path: none;')
    expect(workbenchStage).toContain('ds-composer-dock')
  })
})
