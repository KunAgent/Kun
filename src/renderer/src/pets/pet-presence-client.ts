import { PetKeyboardState, petTypingMaskForCode, petTypingZoneForCode, type PetKeyMask, type PetKeyZone } from '@shared/pets-typing'
import type { PetPresenceSignal, PetReactionKind } from '@shared/pets-interactions'

let sequence = 0

function send(signal: PetPresenceSignal): void {
  if (typeof window === 'undefined') return
  try {
    const bridge = window.kunGui?.pets ?? window.kunPetOverlay
    bridge?.updatePetPresence?.(signal)
  } catch { /* Optional pet feedback must never interrupt editing or audio. */ }
}

export function publishPetModel(model: string, provider: string, announce = true): void {
  send({ type: 'model', model: model.slice(0, 200), provider: provider.slice(0, 100), announce })
}

export function createPetPresenceSource(label: string) {
  const source = `${label}:${Date.now().toString(36)}:${++sequence}`
  let disposed = false
  return {
    report(kind: PetReactionKind | 'idle', level = 0): void {
      if (!disposed) send({ type: 'input', source, kind, level: Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0 })
    },
    keyboard(held: PetKeyMask, tap: PetKeyMask, zone?: PetKeyZone): void {
      if (!disposed) send({ type: 'keyboard', source, held, tap, ...(zone ? { zone } : {}) })
    },
    mouse(buttons: number, wheel: -1 | 0 | 1 = 0): void {
      if (!disposed) send({ type: 'mouse', source, buttons: buttons & 7, wheel })
    },
    dispose(): void {
      if (!disposed) send({ type: 'input', source, kind: 'idle', level: 0 })
      disposed = true
    }
  }
}

export function isPetTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const editor = target.closest('textarea, input, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')
  if (!editor || editor.matches('[disabled], [readonly], input[type="password"], input[type="hidden"], input[type="checkbox"], input[type="radio"], input[type="range"], input[type="file"], input[type="color"], input[type="button"], input[type="submit"], input[type="reset"]')) return false
  if (editor.tagName === 'TEXTAREA') return true
  return Boolean(editor.closest('[data-floating-composer], [data-pet-typing], .pet-quick-composer, .pet-work-bubble, .cm-editor, .monaco-editor, .tiptap, .ProseMirror, .xterm'))
}

export function startPetTypingPresence(doc: Document): () => void {
  const source = createPetPresenceSource('typing')
  const keys = new PetKeyboardState()
  let lastPhysical = -Infinity, lastFallback = -Infinity, alternate: PetKeyMask = 1
  let mouseButtons = 0, lastWheelAt = -Infinity
  let heartbeat: ReturnType<typeof setTimeout> | undefined
  const modelFromFocus = (event: Event): void => {
    if (!(event.target instanceof Element)) return
    const picker = event.target.closest('[data-floating-composer]')?.querySelector('[data-pet-model]')
    const model = picker?.getAttribute('data-pet-model')
    if (model !== null && model !== undefined) publishPetModel(model, picker?.getAttribute('data-pet-provider') ?? '')
  }
  const keepHeld = (): void => {
    clearTimeout(heartbeat)
    if (!keys.held) return
    heartbeat = setTimeout(() => { source.keyboard(keys.held, 0); keepHeld() }, 500)
  }
  const down = (event: KeyboardEvent): void => {
    if (!isPetTypingTarget(event.target) || !petTypingMaskForCode(event.code)) return
    lastPhysical = Date.now()
    modelFromFocus(event)
    const state = keys.down(event.code, event.repeat)
    if (state) {
      source.keyboard(state.held, state.tap, state.tap ? petTypingZoneForCode(event.code) : undefined)
      keepHeld()
    }
  }
  const up = (event: KeyboardEvent): void => {
    const state = keys.up(event.code)
    if (state) { source.keyboard(state.held, 0); keepHeld() }
  }
  // IME/virtual editors without a physical key event still get a short real-input tap.
  const input = (event: Event): void => {
    const now = Date.now()
    if (!isPetTypingTarget(event.target) || now - lastPhysical < 80 || now - lastFallback < 50) return
    lastFallback = now; modelFromFocus(event)
    source.keyboard(keys.held, alternate); alternate = alternate === 1 ? 2 : 1
  }
  const mouseButton = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('.pet-hit')) return
    const next = event.type === 'mouseup' ? (event.buttons & 7) : ((event.buttons || (1 << Math.min(2, event.button))) & 7)
    if (next === mouseButtons) return
    mouseButtons = next
    source.mouse(mouseButtons, 0)
  }
  const wheel = (event: WheelEvent): void => {
    if (event.target instanceof Element && event.target.closest('.pet-hit')) return
    const now = Date.now()
    if (now - lastWheelAt < 60 || Math.abs(event.deltaY) < 1) return
    lastWheelAt = now
    source.mouse(mouseButtons, event.deltaY > 0 ? 1 : -1)
  }
  const stop = (): void => {
    clearTimeout(heartbeat); keys.reset()
    if (mouseButtons !== 0) { mouseButtons = 0; source.mouse(0, 0) }
    source.report('idle')
    lastPhysical = lastFallback = -Infinity
  }
  const visibility = (): void => { if (doc.hidden) stop() }
  doc.addEventListener('keydown', down, true)
  doc.addEventListener('keyup', up, true)
  doc.addEventListener('mousedown', mouseButton, true)
  doc.addEventListener('mouseup', mouseButton, true)
  doc.addEventListener('wheel', wheel, { capture: true, passive: true })
  for (const event of ['input', 'compositionupdate']) doc.addEventListener(event, input, true)
  doc.addEventListener('focusin', modelFromFocus, true)
  doc.addEventListener('focusout', stop, true)
  doc.addEventListener('visibilitychange', visibility)
  doc.defaultView?.addEventListener('blur', stop)
  return () => {
    doc.removeEventListener('keydown', down, true); doc.removeEventListener('keyup', up, true)
    doc.removeEventListener('mousedown', mouseButton, true); doc.removeEventListener('mouseup', mouseButton, true)
    doc.removeEventListener('wheel', wheel, true)
    for (const event of ['input', 'compositionupdate']) doc.removeEventListener(event, input, true)
    doc.removeEventListener('focusin', modelFromFocus, true)
    doc.removeEventListener('focusout', stop, true)
    doc.removeEventListener('visibilitychange', visibility)
    doc.defaultView?.removeEventListener('blur', stop)
    clearTimeout(heartbeat); keys.reset()
    if (mouseButtons !== 0) { mouseButtons = 0; source.mouse(0, 0) }
    source.dispose()
  }
}
