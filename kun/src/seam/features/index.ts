import type { KunExtension } from '../types.js'
import expertsExtension from './experts.feature.js'

/**
 * Enabled feature extensions.
 * Stage 0: empty array (no features yet).
 * Stage 1+: import and list feature modules here.
 */
export const ENABLED_FEATURES: KunExtension[] = [
  expertsExtension
]
