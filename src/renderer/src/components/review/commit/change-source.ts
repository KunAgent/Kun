import type { GitChangeEntry, GitChangeStatus, GitWorkingState } from '@shared/git-commit'
import type { ChatBlock } from '../../../agent/types'
import { extractUnifiedDiffText } from '../../../lib/diff-stats'

/** What the Changes panel shows. Anything else is a task workspace id. */
export type ChangeSourceId = 'conversation' | 'last-turn' | 'git-unstaged' | 'git-staged' | 'git-branch'

export const GIT_SOURCES: readonly ChangeSourceId[] = ['git-unstaged', 'git-staged', 'git-branch']

export function isGitSource(id: string): id is 'git-unstaged' | 'git-staged' | 'git-branch' {
  return (GIT_SOURCES as readonly string[]).includes(id)
}

export function isConversationSource(id: string): id is 'conversation' | 'last-turn' {
  return id === 'conversation' || id === 'last-turn'
}

/** Blocks of the latest reply: everything after the last user message. */
export function lastTurnBlocks(blocks: ChatBlock[]): ChatBlock[] {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].kind === 'user') return blocks.slice(index + 1)
  }
  return blocks
}

/** File changes the inspector can show (a tool block that carries a unified diff). */
export function conversationFileCount(blocks: ChatBlock[]): number {
  return blocks.filter((block) =>
    block.kind === 'tool' && block.toolKind === 'file_change' && Boolean(extractUnifiedDiffText(block.detail))).length
}

const STATUS_LETTERS: Record<GitChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflicted: '!'
}

export function statusLetter(status: GitChangeStatus): string {
  return STATUS_LETTERS[status]
}

export function splitRepositoryPath(path: string): { name: string; directory: string } {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? { name: path, directory: '' } : { name: path.slice(slash + 1), directory: path.slice(0, slash) }
}

type ReadyState = Extract<GitWorkingState, { ok: true }>

export type CommitPlan = {
  /** Nothing staged but the tree is dirty: the commit stages everything first. */
  stageAll: boolean
  /** Files the commit records. */
  fileCount: number
  canCommit: boolean
  canPush: boolean
  /** The first push sets the upstream. */
  firstPush: boolean
  /** Commits waiting for a push when there is nothing to commit. */
  pushOnly: number
  blocker: 'conflicts' | null
  pushBlocker: 'detached' | 'no_remote' | null
}

export function commitPlan(state: ReadyState): CommitPlan {
  const stageAll = state.staged.length === 0 && state.unstaged.length > 0
  const fileCount = stageAll ? state.unstaged.length : state.staged.length
  const conflicts = state.unstaged.some((entry) => entry.status === 'conflicted')
  const pushBlocker = !state.branch ? 'detached' : !state.pushRemote ? 'no_remote' : null
  const canPush = pushBlocker === null
  const firstPush = canPush && !state.upstream
  const hasCommits = state.head !== null
  return {
    stageAll,
    fileCount,
    canCommit: fileCount > 0 && !conflicts,
    canPush,
    firstPush,
    pushOnly: fileCount === 0 && canPush && hasCommits ? Math.max(state.unpushed, firstPush ? 1 : 0) : 0,
    blocker: conflicts ? 'conflicts' : null,
    pushBlocker
  }
}

export function firstPushCommand(state: ReadyState): string {
  return `git push -u ${state.pushRemote ?? 'origin'} ${state.branch ?? ''}`.trim()
}

/** Paths whose unstaged changes a discard would drop, split the way the confirmation explains them. */
export function discardSummary(entries: GitChangeEntry[]): { tracked: GitChangeEntry[]; untracked: GitChangeEntry[] } {
  const usable = entries.filter((entry) => entry.status !== 'conflicted')
  return {
    tracked: usable.filter((entry) => entry.status !== 'untracked'),
    untracked: usable.filter((entry) => entry.status === 'untracked')
  }
}
