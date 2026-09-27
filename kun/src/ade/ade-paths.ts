import { createHash } from 'node:crypto'
import { join } from 'node:path'

/**
 * ADE control-plane data lives outside the thread store so it survives turn
 * churn while still being deleted together with the manager thread.
 * Layout: `dataDir/ade/teams/<managerThreadId>/{team,dispatches,questions,notices}.json`
 */

/** Thread ids are caller-derived; sanitize before using them as path parts. */
function safeId(id: string): string {
  const trimmed = id.trim()
  if (/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) return trimmed
  // Fall back to a stable digest for ids carrying unexpected characters.
  return `x${createHash('sha256').update(trimmed, 'utf8').digest('hex').slice(0, 48)}`
}

export function adeRootDir(dataDir: string): string {
  return join(dataDir, 'ade')
}

export function adeTeamsDir(dataDir: string): string {
  return join(adeRootDir(dataDir), 'teams')
}

export function adeTeamDir(dataDir: string, managerThreadId: string): string {
  return join(adeTeamsDir(dataDir), safeId(managerThreadId))
}

export function adeTeamFile(dataDir: string, managerThreadId: string): string {
  return join(adeTeamDir(dataDir, managerThreadId), 'team.json')
}

export function adeDispatchesFile(dataDir: string, managerThreadId: string): string {
  return join(adeTeamDir(dataDir, managerThreadId), 'dispatches.json')
}

export function adeQuestionsFile(dataDir: string, managerThreadId: string): string {
  return join(adeTeamDir(dataDir, managerThreadId), 'questions.json')
}

export function adeNoticesFile(dataDir: string, managerThreadId: string): string {
  return join(adeTeamDir(dataDir, managerThreadId), 'notices.json')
}

/** Line-level review comments live per task workspace (11 §4.1). */
export function adeReviewsDir(dataDir: string): string {
  return join(adeRootDir(dataDir), 'reviews')
}

export function adeReviewFile(dataDir: string, workspaceId: string): string {
  return join(adeReviewsDir(dataDir), `${safeId(workspaceId)}.json`)
}
