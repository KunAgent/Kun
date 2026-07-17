import { expertsRendererFeature } from './experts/index.js'
import { automationRendererFeature } from './automation/index.js'
import { designRendererFeature } from './design/index.js'
import { collaborationRendererFeature } from './collaboration/index.js'
import { moaRendererFeature } from './moa/index.js'

/**
 * EXT-SEAM: Enabled renderer features.
 *
 * Each feature exports panels and routes that get wired into the main app.
 */

export const ENABLED_RENDERER_FEATURES = [
  expertsRendererFeature,
  collaborationRendererFeature,
  moaRendererFeature,
  automationRendererFeature,
  designRendererFeature
]
