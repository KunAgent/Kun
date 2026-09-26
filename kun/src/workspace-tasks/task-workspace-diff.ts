import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import { splitPatchByFile, type PatchFileSection } from './patch-split.js'
import { workspaceGit } from './workspace-git.js'

/**
 * Review diff assembly (docs/ade/11 §3): the captured patch artifact is
 * split per file for the list view; per-file requests add old/new full
 * texts — old from `git show <base>:<path>`, new from the worktree —
 * while binary or > 1 MiB files degrade to stats only.
 */
export const DIFF_TEXT_LIMIT_BYTES = 1024 * 1024

export type TaskWorkspaceDiffFile = {
  path: string
  oldPath?: string
  status: PatchFileSection['status']
  insertions: number
  deletions: number
  binary: boolean
  tooLarge: boolean
}

export type TaskWorkspaceDiffList = {
  files: TaskWorkspaceDiffFile[]
  headRevision?: string
}

export type TaskWorkspaceDiffFileDetail = TaskWorkspaceDiffFile & {
  patch?: string
  oldText?: string
  newText?: string
}

type PatchReader = { get(id: string): Promise<string | null> }

const bytes = (text: string | undefined): number =>
  text === undefined ? 0 : Buffer.byteLength(text)

async function patchFor(record: TaskWorkspaceRecord, artifacts: PatchReader): Promise<string> {
  if (!record.patchArtifactId) return ''
  return (await artifacts.get(record.patchArtifactId)) ?? ''
}

export async function taskWorkspaceDiffList(
  record: TaskWorkspaceRecord,
  artifacts: PatchReader
): Promise<TaskWorkspaceDiffList> {
  const sections = splitPatchByFile(await patchFor(record, artifacts))
  return {
    files: sections.map(({ patch, ...section }) => ({
      ...section,
      tooLarge: bytes(patch) > DIFF_TEXT_LIMIT_BYTES
    })),
    ...(record.headRevision ? { headRevision: record.headRevision } : {})
  }
}

async function readCapped(path: string): Promise<{ text?: string; tooLarge: boolean }> {
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) return { tooLarge: false }
  if (info.size > DIFF_TEXT_LIMIT_BYTES) return { tooLarge: true }
  return { text: await readFile(path, 'utf8').catch(() => undefined), tooLarge: false }
}

export async function taskWorkspaceDiffFile(
  record: TaskWorkspaceRecord,
  artifacts: PatchReader,
  path: string
): Promise<TaskWorkspaceDiffFileDetail | undefined> {
  const section = splitPatchByFile(await patchFor(record, artifacts))
    .find((s) => s.path === path || s.oldPath === path)
  if (!section) return undefined
  const stats: TaskWorkspaceDiffFile = {
    path: section.path,
    ...(section.oldPath ? { oldPath: section.oldPath } : {}),
    status: section.status,
    insertions: section.insertions,
    deletions: section.deletions,
    binary: section.binary,
    tooLarge: false
  }
  const oldText = section.binary || section.status === 'added' || !record.baseRevision
    ? undefined
    : await workspaceGit(
        record.path,
        ['show', `${record.baseRevision}:${section.oldPath ?? section.path}`]
      ).catch(() => undefined)
  const newRead = section.binary || section.status === 'deleted'
    ? { tooLarge: false }
    : await readCapped(resolve(record.path, section.path))
  const newText = newRead.text
  const tooLarge =
    bytes(section.patch) > DIFF_TEXT_LIMIT_BYTES ||
    bytes(oldText) > DIFF_TEXT_LIMIT_BYTES ||
    newRead.tooLarge
  if (tooLarge) return { ...stats, tooLarge: true }
  return {
    ...stats,
    patch: section.patch,
    ...(oldText !== undefined ? { oldText } : {}),
    ...(newText !== undefined ? { newText } : {})
  }
}
