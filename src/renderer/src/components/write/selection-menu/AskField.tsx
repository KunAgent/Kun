import { ArrowUp, Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveAskKey } from './ask-keys'
import { isMacPlatform } from './shortcut-label'

export function AskField({ value, onChange, onSubmit, readOnly, onFreeze, onRelease, onRestore }: {
  value: string; onChange: (value: string) => void; onSubmit: (mode: 'edit' | 'chat') => void
  readOnly: boolean; onFreeze?: () => void; onRelease?: () => void; onRestore?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return <div className="write-selection-menu-ask" onPointerDownCapture={onFreeze} onFocusCapture={onFreeze}
    onBlurCapture={(event) => { if (!event.currentTarget.closest('.write-selection-menu')?.contains(event.relatedTarget as Node)) onRelease?.() }}>
    <Sparkles aria-hidden="true" />
    <input value={value} aria-label={t(readOnly ? 'writeSelectionAskReadOnlyPlaceholder' : 'writeSelectionAskPlaceholder')}
      placeholder={t(readOnly ? 'writeSelectionAskReadOnlyPlaceholder' : 'writeSelectionAskPlaceholder')}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        const action = resolveAskKey({ ...event, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode }, value, isMacPlatform())
        if (!action) return
        event.preventDefault(); event.stopPropagation()
        if (action === 'clear' || action === 'blur') {
          onChange(''); onRestore?.(); event.currentTarget.blur(); onRelease?.()
        } else onSubmit(readOnly ? 'chat' : action)
      }} />
    <button type="button" className={value.trim() ? 'is-ready' : ''} disabled={!value.trim()}
      aria-label={t(readOnly ? 'writeSelectionAskChat' : 'writeSelectionAskEdit')}
      onMouseDown={(event) => event.preventDefault()} onClick={() => onSubmit(readOnly ? 'chat' : 'edit')}><ArrowUp /></button>
  </div>
}
