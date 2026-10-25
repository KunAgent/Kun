import { DESIGN_CRAFT_LINES } from '../prompt/design-authoring-rules.js'
import {
  DESIGN_CANVAS_EXAMPLE_LINES,
  designCanvasPlacementLine,
  designCanvasReferenceLines
} from '../prompt/design-canvas-reference.js'
import { DESIGN_MODE_INSTRUCTION } from './design-mode.js'

/**
 * Stable policy for Design-surface canvas turns (`guiDesignMode` with
 * `guiDesignCanvas`): the request classifier plus the canvas operating
 * reference. The renderer keeps only the snapshot, selection, frame target and
 * brief in the user message, so consecutive canvas turns pay for the reference
 * once. The Code sidebar whiteboard still sends its own variant inline.
 */
export const DESIGN_CANVAS_MODE_INSTRUCTION = [
  DESIGN_MODE_INSTRUCTION,
  '',
  'Design canvas operating reference. The latest Design user message carries the current canvas snapshot, selection, design target, and brief; wherever this reference mentions the snapshot below, it means that snapshot.',
  '',
  ...designCanvasReferenceLines('design', designCanvasPlacementLine('design')),
  ...DESIGN_CRAFT_LINES.slice(0, 5),
  '',
  ...DESIGN_CANVAS_EXAMPLE_LINES
].join('\n')
