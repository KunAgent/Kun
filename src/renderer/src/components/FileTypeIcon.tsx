import type { LucideIcon } from 'lucide-react'
import {
  File,
  FileArchive,
  FileChartColumnIncreasing,
  FileCode2,
  FileCog,
  FileDigit,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileVideo,
  FileVolume,
  Folder,
  FolderOpen
} from 'lucide-react'
import type { ReactElement } from 'react'
import { workspaceFileIconKind, type FileIconKind } from '../lib/workspace-file-icons'

const GLYPH_BY_KIND: Record<FileIconKind, LucideIcon> = {
  ts: FileCode2,
  js: FileCode2,
  py: FileCode2,
  go: FileCode2,
  rs: FileCode2,
  java: FileCode2,
  c: FileCode2,
  rb: FileCode2,
  php: FileCode2,
  swift: FileCode2,
  code: FileCode2,
  html: FileCode2,
  css: FileCode2,
  json: FileJson,
  md: FileText,
  txt: FileText,
  sh: FileTerminal,
  env: FileKey,
  cfg: FileCog,
  lock: FileLock,
  img: FileImage,
  vid: FileVideo,
  aud: FileVolume,
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slide: FileChartColumnIncreasing,
  zip: FileArchive,
  bin: FileDigit,
  file: File
}

type Props = {
  path: string
  /** Overrides the kind derived from the path. */
  kind?: FileIconKind
  size?: number
  className?: string
}

/** Tinted file-type glyph used by the file tree, tabs and preview cards. */
export function FileTypeIcon({ path, kind, size = 16, className }: Props): ReactElement {
  const resolved = kind ?? workspaceFileIconKind(path)
  const Glyph = GLYPH_BY_KIND[resolved]
  return (
    <Glyph
      aria-hidden="true"
      data-file-icon={resolved}
      className={`ds-file-icon shrink-0 ${className ?? ''}`}
      width={size}
      height={size}
      strokeWidth={size <= 16 ? 1.8 : 1.6}
    />
  )
}

type FolderIconProps = {
  open: boolean
  size?: number
  className?: string
}

export function FolderTypeIcon({ open, size = 16, className }: FolderIconProps): ReactElement {
  const Glyph = open ? FolderOpen : Folder
  return (
    <Glyph
      aria-hidden="true"
      data-file-icon="folder"
      className={`ds-file-icon shrink-0 ${className ?? ''}`}
      width={size}
      height={size}
      strokeWidth={1.75}
    />
  )
}
