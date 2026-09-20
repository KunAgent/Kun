import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSession } from '../../domain/session.js'
import { atomicWriteFile } from './atomic-write.js'

export async function readSessionSnapshot(directory: string): Promise<AgentSession | null> {
  try {
    return JSON.parse(await readFile(join(directory, 'session.json'), 'utf8')) as AgentSession
  } catch {
    return null
  }
}

/** The caller holds the canonical SessionStore write queue (owned by Service Manager). */
export async function writeSessionSnapshot(directory: string, session: AgentSession): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const prior = session.historyRefId ? null : await readSessionSnapshot(directory)
  const saved = prior?.historyRefId ? {
    ...session, historyRefId: prior.historyRefId, workspace: session.workspace ?? prior.workspace
  } : session
  await atomicWriteFile(join(directory, 'session.json'), JSON.stringify(saved))
}
