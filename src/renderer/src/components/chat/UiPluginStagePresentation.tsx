import type { ReactElement, ReactNode } from 'react'
import {
  UI_PLUGIN_SCENE_ARTWORK_SLOTS,
  type UiPluginPresentation,
  type UiPluginRuntimeSceneAssets,
  type UiPluginSceneArtworkLayer,
  type UiPluginSceneArtworkSlot,
  type UiPluginSceneV16
} from '@shared/ui-plugin'
import { useUiPluginStore } from '../../store/ui-plugin-store'

export type UiPluginStagePresentationProps = {
  portraitSrc: string | null
  presentation: UiPluginPresentation | null
  scene?: UiPluginSceneV16 | null
  sceneAssets?: UiPluginRuntimeSceneAssets | null
}

const SAFE_SCENE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/

function safeSceneAsset(
  assets: UiPluginRuntimeSceneAssets | null | undefined,
  path: string | undefined
): string | null {
  if (!path) return null
  const value = assets?.assets?.[path]
  if (!value) return null
  const match = SAFE_SCENE_DATA_URL.exec(value)
  return match && match[1].length % 4 === 0 ? value : null
}

function SceneArtworkImage({
  slot,
  layer,
  src,
  variant,
  hasDark
}: {
  slot: UiPluginSceneArtworkSlot
  layer: UiPluginSceneArtworkLayer
  src: string
  variant: 'default' | 'dark'
  hasDark: boolean
}): ReactElement {
  return (
    <img
      className={`ds-ui-plugin-scene-artwork ds-ui-plugin-scene-artwork-${slot}`}
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      data-scene-slot={slot}
      data-scene-variant={variant}
      data-scene-has-dark={hasDark ? 'true' : 'false'}
      data-scene-anchor={layer.anchor}
      data-scene-size={layer.size}
      data-scene-fit={layer.fit}
      data-scene-blend={layer.blend}
      data-scene-motion={layer.motion.preset}
      data-scene-motion-speed={layer.motion.speed}
      data-scene-motion-phase={layer.motion.phase}
    />
  )
}

function renderSceneArtwork(
  scene: UiPluginSceneV16,
  assets: UiPluginRuntimeSceneAssets | null | undefined,
  slots: readonly UiPluginSceneArtworkSlot[]
): ReactNode[] {
  return slots.flatMap((slot) => {
    const layer = scene.artwork[slot]
    if (!layer) return []
    const defaultSrc = safeSceneAsset(assets, layer.path)
    const darkSrc = safeSceneAsset(assets, layer.darkPath)
    if (!defaultSrc) return []
    const nodes: ReactNode[] = [
      <SceneArtworkImage
        key={`${slot}-default`}
        slot={slot}
        layer={layer}
        src={defaultSrc}
        variant="default"
        hasDark={Boolean(darkSrc)}
      />
    ]
    if (darkSrc) {
      nodes.push(
        <SceneArtworkImage
          key={`${slot}-dark`}
          slot={slot}
          layer={layer}
          src={darkSrc}
          variant="dark"
          hasDark
        />
      )
    }
    return nodes
  })
}

/**
 * Fixed host markup for declarative character themes. The plugin contributes
 * only a main-process-validated image and normalized enum values; it cannot
 * contribute markup, event handlers, selectors, or executable code.
 */
export function UiPluginStagePresentation({
  portraitSrc,
  presentation,
  scene = null,
  sceneAssets = null
}: UiPluginStagePresentationProps): ReactElement | null {
  if (!portraitSrc || !presentation) return null

  if (scene) {
    const stageSlots = UI_PLUGIN_SCENE_ARTWORK_SLOTS.filter(
      (slot) => slot === 'backdrop' || slot === 'ambient'
    )
    const visualSlots = UI_PLUGIN_SCENE_ARTWORK_SLOTS.filter(
      (slot) => slot !== 'backdrop' && slot !== 'ambient'
    )
    return (
      <>
        <div className="ds-ui-plugin-scene-stage-layer" aria-hidden="true">
          {renderSceneArtwork(scene, sceneAssets, stageSlots)}
        </div>
        <div className="ds-ui-plugin-scene-visual-zone" aria-hidden="true">
          <img
            className="ds-ui-plugin-character ds-ui-plugin-scene-character"
            src={portraitSrc}
            alt=""
            draggable={false}
            decoding="async"
          />
          {renderSceneArtwork(scene, sceneAssets, visualSlots)}
        </div>
        <div className="ds-ui-plugin-readability-scrim" aria-hidden="true" />
      </>
    )
  }

  return (
    <>
      <div className="ds-ui-plugin-decor-layer" aria-hidden="true" />
      <div className="ds-ui-plugin-character-layer" aria-hidden="true">
        <img
          className="ds-ui-plugin-character"
          src={portraitSrc}
          alt=""
          draggable={false}
          decoding="async"
        />
      </div>
      <div className="ds-ui-plugin-readability-scrim" aria-hidden="true" />
    </>
  )
}

export function ActiveUiPluginStagePresentation(): ReactElement | null {
  const runtime = useUiPluginStore((state) => state.activeRuntime)
  return (
    <UiPluginStagePresentation
      portraitSrc={runtime?.figures.portrait ?? null}
      presentation={runtime?.manifest.presentation ?? null}
      scene={runtime?.manifest.scene ?? null}
      sceneAssets={runtime?.sceneAssets ?? null}
    />
  )
}
