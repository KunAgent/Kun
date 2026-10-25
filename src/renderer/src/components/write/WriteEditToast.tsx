import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { modifierLabel } from './selection-menu/shortcut-label'
import { writeFocusModeFloatingLayerClassName } from '../../write/write-focus-mode'
export function WriteEditToast({ onUndo, onDismiss, focusMode }: {
  onUndo: () => void; onDismiss: () => void; focusMode: boolean
}): ReactElement {
  const { t } = useTranslation('common'), [hovered, setHovered] = useState(false)
  const remaining = useRef(6000), dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    if (hovered) return
    const start = Date.now(), timer = window.setTimeout(() => dismissRef.current(), remaining.current)
    return () => { clearTimeout(timer); remaining.current -= Date.now() - start }
  }, [hovered])
  return <div className={`write-edit-toast ${writeFocusModeFloatingLayerClassName(focusMode, 'z-50')}`} role="status"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <Check /><span>{t('writeEditAppliedToast')}</span><button type="button" onClick={onUndo}>{t('writeEditUndo')} <kbd>{modifierLabel()}Z</kbd></button>
  </div>
}
