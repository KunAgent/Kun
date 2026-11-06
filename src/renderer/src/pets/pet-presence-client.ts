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
    dispose(): void {
      if (!disposed) send({ type: 'input', source, kind: 'idle', level: 0 })
      disposed = true
    }
  }
}

export function isPetTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const editor = target.closest('textarea, input, [contenteditable="true"]')
  if (!editor || editor.matches('[disabled], [readonly], input[type="password"], input[type="hidden"]')) return false
  return Boolean(editor.closest('[data-floating-composer], [data-pet-typing], .pet-quick-composer, .pet-work-bubble, .cm-editor, .monaco-editor, .tiptap, .ProseMirror'))
}

export function startPetTypingPresence(doc: Document): () => void {
  const source = createPetPresenceSource('typing')
  let last = -Infinity
  const modelFromFocus = (event: Event): void => {
    if (!(event.target instanceof Element)) return
    const picker = event.target.closest('[data-floating-composer]')?.querySelector('[data-pet-model]')
    const model = picker?.getAttribute('data-pet-model')
    if (model !== null && model !== undefined) publishPetModel(model, picker?.getAttribute('data-pet-provider') ?? '')
  }
  const input = (event: Event): void => {
    if (!isPetTypingTarget(event.target) || Date.now() - last < 100) return
    last = Date.now()
    modelFromFocus(event)
    source.report('typing')
  }
  const stop = (): void => { source.report('idle'); last = -Infinity }
  const visibility = (): void => { if (doc.hidden) stop() }
  for (const event of ['input', 'compositionupdate']) doc.addEventListener(event, input, true)
  doc.addEventListener('focusin', modelFromFocus, true)
  doc.addEventListener('focusout', stop, true)
  doc.addEventListener('visibilitychange', visibility)
  doc.defaultView?.addEventListener('blur', stop)
  return () => {
    for (const event of ['input', 'compositionupdate']) doc.removeEventListener(event, input, true)
    doc.removeEventListener('focusin', modelFromFocus, true)
    doc.removeEventListener('focusout', stop, true)
    doc.removeEventListener('visibilitychange', visibility)
    doc.defaultView?.removeEventListener('blur', stop)
    source.dispose()
  }
}
