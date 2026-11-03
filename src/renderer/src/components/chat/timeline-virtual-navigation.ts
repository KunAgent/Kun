export const REVEAL_VIRTUAL_TIMELINE_BLOCK = 'kun:reveal-virtual-timeline-block'

export function revealVirtualTimelineBlock(turn: HTMLElement, blockId: string): boolean {
  return !turn.dispatchEvent(new CustomEvent(REVEAL_VIRTUAL_TIMELINE_BLOCK, {
    detail: blockId, cancelable: true
  }))
}
