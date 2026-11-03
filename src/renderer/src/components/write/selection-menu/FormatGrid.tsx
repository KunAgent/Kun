import { Bold, Code, Italic, Link, RemoveFormatting, Strikethrough } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { WriteInlineFormatKind } from '../../../write/inline-format'
import { MenuButton } from './MenuButton'
import { modifierLabel } from './shortcut-label'
const formats = [
  { kind: 'bold', label: 'writeFormatBold', icon: Bold, key: 'B' },
  { kind: 'italic', label: 'writeFormatItalic', icon: Italic, key: 'I' },
  { kind: 'strikethrough', label: 'writeFormatStrikethrough', icon: Strikethrough },
  { kind: 'code', label: 'writeFormatCode', icon: Code, key: 'E' },
  { kind: 'link', label: 'writeFormatLink', icon: Link, key: 'K' },
  { kind: 'clear', label: 'writeFormatClear', icon: RemoveFormatting }
] as const
export function FormatGrid({ active = [], richMode, onApply }: {
  active?: WriteInlineFormatKind[]; richMode?: boolean; onApply: (kind: WriteInlineFormatKind) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return <div className="write-selection-menu-formats" role="group">
    {formats.map(({ kind, label, icon: Icon, ...item }) => <MenuButton key={kind}
      className="write-selection-menu-format" label={t(label)} role="menuitem"
      title={`${t(label)}${richMode && 'key' in item ? ` (${modifierLabel()}${item.key})` : ''}`}
      aria-pressed={active.includes(kind)} onActivate={() => onApply(kind)}><Icon strokeWidth={kind === 'bold' ? 2.2 : 1.9} /></MenuButton>)}
  </div>
}
