import type { ReactElement } from 'react'
import { WORKSPACE_TEXT_ENCODINGS, type WorkspaceTextEncoding } from '@shared/workspace-file'
import { PreviewMenuButton } from './WorkspaceFilePreviewMenus'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type PreviewStatusItem = { label: string; notice?: boolean; title?: string }

const ENCODING_LABELS: Record<WorkspaceTextEncoding, string> = {
  'utf-8': 'UTF-8',
  gb18030: 'GB18030',
  big5: 'Big5',
  shift_jis: 'Shift_JIS',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1252': 'Windows-1252'
}

export function workspaceEncodingLabel(encoding: WorkspaceTextEncoding): string {
  return ENCODING_LABELS[encoding]
}

const LANGUAGE_NAMES: Record<string, string> = {
  astro: 'Astro', bash: 'Shell', c: 'C', cpp: 'C++', cs: 'C#', css: 'CSS', csv: 'CSV', dart: 'Dart',
  diff: 'Diff', dockerfile: 'Dockerfile', dotenv: 'Dotenv', fish: 'Fish', go: 'Go', html: 'HTML', ini: 'INI',
  java: 'Java', js: 'JavaScript', json: 'JSON', jsonc: 'JSON', jsx: 'JSX', just: 'Just', kotlin: 'Kotlin',
  less: 'Less', log: 'Log', lua: 'Lua', makefile: 'Makefile', md: 'Markdown', php: 'PHP', powershell: 'PowerShell',
  properties: 'Properties', python: 'Python', ruby: 'Ruby', rust: 'Rust', sass: 'Sass', scss: 'SCSS',
  shell: 'Shell', sql: 'SQL', svelte: 'Svelte', swift: 'Swift', toml: 'TOML', ts: 'TypeScript', tsx: 'TSX',
  vue: 'Vue', xml: 'XML', yaml: 'YAML'
}

export function workspaceLanguageName(language: string): string {
  return LANGUAGE_NAMES[language] ?? language.toUpperCase()
}

export function workspaceLineEnding(content: string): 'CRLF' | 'LF' | null {
  const index = content.indexOf('\n')
  if (index < 0) return null
  return index > 0 && content[index - 1] === '\r' ? 'CRLF' : 'LF'
}

type Props = {
  t: Translate
  left: PreviewStatusItem[]
  right: PreviewStatusItem[]
  encoding?: {
    current: WorkspaceTextEncoding
    notice: boolean
    onPick: (encoding: WorkspaceTextEncoding) => void
  }
}

export function WorkspaceFilePreviewStatusBar({ t, left, right, encoding }: Props): ReactElement {
  const [first, ...rest] = left
  const item = (entry: PreviewStatusItem, key: string): ReactElement => (
    <span key={key} title={entry.title} className={`ds-file-preview-status-item ${entry.notice ? 'is-notice' : ''}`}>
      {entry.label}
    </span>
  )
  return (
    <div className="ds-file-preview-statusbar">
      {first ? item(first, 'left-0') : null}
      {encoding ? (
        <PreviewMenuButton
          label={t('filePreviewEncodingMenu', { encoding: ENCODING_LABELS[encoding.current] })}
          align="start"
          placement="above"
          className={`ds-file-preview-status-item ${encoding.notice ? 'is-notice' : ''}`}
          items={WORKSPACE_TEXT_ENCODINGS.map((value) => ({
            kind: 'check' as const,
            label: ENCODING_LABELS[value],
            checked: value === encoding.current,
            onSelect: () => encoding.onPick(value)
          }))}
        >
          {ENCODING_LABELS[encoding.current]}
        </PreviewMenuButton>
      ) : null}
      {rest.map((entry, index) => item(entry, `left-${index + 1}`))}
      <span className="min-w-0 flex-1" />
      {right.map((entry, index) => item(entry, `right-${index}`))}
    </div>
  )
}
