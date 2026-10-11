import type { ReactElement } from 'react'

export type WorkFileKind =
  | 'markdown'
  | 'word'
  | 'sheet'
  | 'slide'
  | 'pdf'
  | 'image'
  | 'whiteboard'
  | 'code'

const EXTENSION_KINDS: Record<string, WorkFileKind> = {
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', txt: 'markdown', rtf: 'markdown',
  doc: 'word', docx: 'word', odt: 'word', pages: 'word',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet', ods: 'sheet', numbers: 'sheet',
  ppt: 'slide', pptx: 'slide', odp: 'slide', key: 'slide',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', heic: 'image'
}

const TILE_COLORS: Record<WorkFileKind, string> = {
  markdown: '#6b7a90',
  word: '#2f6fc4',
  sheet: '#1f9d55',
  slide: '#e07a2e',
  pdf: '#d6493f',
  image: '#8a63d2',
  whiteboard: '#0f9c98',
  code: '#4b5563'
}

export function workFileKindForName(name: string, fallback: WorkFileKind = 'markdown'): WorkFileKind {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim())
  return (match && EXTENSION_KINDS[match[1].toLowerCase()]) || fallback
}

function Glyph({ kind }: { kind: WorkFileKind }): ReactElement {
  const stroke = { stroke: '#fff', fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (kind) {
    case 'sheet':
      return <path d="M4.5 4.5h7v7h-7zM4.5 8h7M8 4.5v7" strokeWidth={1.2} {...stroke} />
    case 'slide':
      return (
        <>
          <rect x={4.5} y={4.5} width={7} height={4.5} rx={1} strokeWidth={1.2} {...stroke} />
          <path d="M6 11.5h4" strokeWidth={1.3} {...stroke} />
        </>
      )
    case 'pdf':
      return <path d="M6 11.5v-7h2.2a2 2 0 0 1 0 4H6" strokeWidth={1.4} {...stroke} />
    case 'image':
      return (
        <>
          <circle cx={6} cy={6} r={1.3} fill="#fff" />
          <path d="m3.8 12 3-3.4 2 2 1.6-1.6 2.2 3" strokeWidth={1.2} {...stroke} />
        </>
      )
    case 'whiteboard':
      return (
        <>
          <circle cx={6.2} cy={10} r={1.9} strokeWidth={1.2} {...stroke} />
          <path d="M8.8 4.8h2.7v2.7H8.8z" strokeWidth={1.2} {...stroke} />
        </>
      )
    case 'code':
      return <path d="M6.5 5.5 4.5 8l2 2.5M9.5 5.5l2 2.5-2 2.5" strokeWidth={1.3} {...stroke} />
    default:
      return <path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4.5" strokeWidth={1.3} {...stroke} />
  }
}

/**
 * Filled 16px file-type tile: the colors office users already associate with
 * each format, so a type reads at a glance in the tree, tabs and file cards.
 */
export function WorkFileTypeIcon({
  name,
  kind,
  size = 16,
  className = ''
}: {
  name?: string
  kind?: WorkFileKind
  size?: number
  className?: string
}): ReactElement {
  const resolved = kind ?? workFileKindForName(name ?? '')
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`work-file-tile ${className}`.trim()}
      data-file-kind={resolved}
    >
      <rect x={1.5} y={1} width={13} height={14} rx={3} fill={TILE_COLORS[resolved]} />
      <Glyph kind={resolved} />
    </svg>
  )
}
