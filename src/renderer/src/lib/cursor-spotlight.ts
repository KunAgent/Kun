let installed = false

export function installCursorSpotlightTracking(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

  let frame = 0
  let target: HTMLElement | null = null
  let clientX = 0
  let clientY = 0

  document.addEventListener('pointermove', (event) => {
    if (document.documentElement.dataset.cursorSpotlight !== 'on') return
    target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-cursor-spotlight-target]')
      : null
    if (!target) return
    clientX = event.clientX
    clientY = event.clientY
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!target) return
      const rect = target.getBoundingClientRect()
      target.style.setProperty('--spotlight-x', `${clientX - rect.left}px`)
      target.style.setProperty('--spotlight-y', `${clientY - rect.top}px`)
    })
  }, { passive: true })
}
