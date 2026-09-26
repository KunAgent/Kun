import { useMemo, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, FileCode2, FolderClosed, FolderOpen } from 'lucide-react'
import type { TaskWorkspaceDiffFile } from '@shared/task-workspace'

/**
 * Directory-collapsed file list for the review panel (11 §3): each file row
 * carries its +N −M counts and scrolls the matching diff block into view.
 */

type TreeDir = {
  name: string
  dirs: Map<string, TreeDir>
  files: TaskWorkspaceDiffFile[]
}

function buildTree(files: TaskWorkspaceDiffFile[]): TreeDir {
  const root: TreeDir = { name: '', dirs: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part)
      if (!next) {
        next = { name: part, dirs: new Map(), files: [] }
        dir.dirs.set(part, next)
      }
      dir = next
    }
    dir.files.push(file)
  }
  return root
}

function scrollToFile(path: string): void {
  if (typeof document === 'undefined') return
  document
    .getElementById(`review-file-${encodeURIComponent(path)}`)
    ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function FileRow({ file, depth }: { file: TaskWorkspaceDiffFile; depth: number }): ReactElement {
  return (
    <button
      type="button"
      onClick={() => scrollToFile(file.path)}
      title={file.path}
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11.5px] hover:bg-ds-hover"
      style={{ paddingLeft: `${depth * 12 + 6}px` }}
    >
      <FileCode2 className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate font-mono text-ds-ink">
        {file.path.split('/').at(-1)}
      </span>
      <span className="shrink-0 font-mono text-[10.5px]">
        <span className="text-emerald-600 dark:text-emerald-400">+{file.insertions}</span>{' '}
        <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
      </span>
    </button>
  )
}

function DirNode({ dir, depth }: { dir: TreeDir; depth: number }): ReactElement {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11.5px] text-ds-muted hover:bg-ds-hover"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {open
          ? <ChevronDown className="h-3 w-3 shrink-0" />
          : <ChevronRight className="h-3 w-3 shrink-0" />}
        {open
          ? <FolderOpen className="h-3 w-3 shrink-0" strokeWidth={1.8} />
          : <FolderClosed className="h-3 w-3 shrink-0" strokeWidth={1.8} />}
        <span className="truncate">{dir.name}</span>
      </button>
      {open ? <DirChildren dir={dir} depth={depth + 1} /> : null}
    </div>
  )
}

function DirChildren({ dir, depth }: { dir: TreeDir; depth: number }): ReactElement {
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
  const files = [...dir.files].sort((a, b) => a.path.localeCompare(b.path))
  return (
    <>
      {dirs.map((child) => <DirNode key={child.name} dir={child} depth={depth} />)}
      {files.map((file) => <FileRow key={file.path} file={file} depth={depth} />)}
    </>
  )
}

export function ReviewFileTree({ files }: { files: TaskWorkspaceDiffFile[] }): ReactElement {
  const root = useMemo(() => buildTree(files), [files])
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <DirChildren dir={root} depth={0} />
    </div>
  )
}
