export type RoomTimelinePosition = { messageId?: string; offset: number; top: number; atBottom: boolean }
export function captureTimelinePosition(scroller: HTMLElement, atBottom: boolean): RoomTimelinePosition {
  const top = scroller.getBoundingClientRect?.().top ?? 0
  const elements = Array.from(scroller.querySelectorAll?.<HTMLElement>('[data-timeline-id]') ?? [])
  const first = elements.find((element) => element.getBoundingClientRect().bottom > top)
  return { top: scroller.scrollTop, atBottom,
    messageId: first?.dataset.timelineId, offset: first ? first.getBoundingClientRect().top - top : 0 }
}
export function restoreTimelinePosition(scroller: HTMLElement, position: RoomTimelinePosition): boolean {
  if (position.atBottom) { scroller.scrollTop = scroller.scrollHeight; return true }
  const element = Array.from(scroller.querySelectorAll?.<HTMLElement>('[data-timeline-id]') ?? [])
    .find((row) => row.dataset.timelineId === position.messageId)
  if (element) {
    scroller.scrollTop += element.getBoundingClientRect().top - (scroller.getBoundingClientRect?.().top ?? 0) - position.offset
    return true
  }
  scroller.scrollTop = position.top
  return !position.messageId
}
