import { useEffect } from 'react'
import type { SelectionEditController } from './use-selection-edit'
export function editBarKeyAllowed(target: EventTarget | null, editor: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('input,textarea,select,[role="dialog"],.write-find-bar')) return false
  return target === document.body || Boolean(editor?.contains(target) || target.closest('.write-selection-edit'))
}
export function useEditBarKeys(controller: SelectionEditController): void {
  useEffect(() => {
    if (!controller.session) return
    const handler = (event: KeyboardEvent): void => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (!editBarKeyAllowed(event.target, controller.getHandle()?.getElement() ?? null)) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (controller.session?.phase === 'running') controller.stop()
        else controller.reject()
      } else if (event.key === 'Enter' && controller.session?.phase === 'review') {
        event.preventDefault(); event.stopPropagation(); controller.accept()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [controller])
}
