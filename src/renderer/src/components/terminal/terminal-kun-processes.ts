import { create } from 'zustand'
import { KUN_BACKGROUND_SHELLS_PATH, kunBackgroundShellStdinPath, kunBackgroundShellStopPath } from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'

/**
 * Kun's own background shells (bash with background=true) for the dock. One
 * poller serves every consumer; it runs while anything subscribes.
 */
export type KunBackgroundProcess = {
  id: string
  threadId: string
  turnId: string
  command: string
  cwd: string
  status: 'running' | 'completed' | 'stopped' | 'failed'
  startedAt: string
  finishedAt?: string
  exitCode: number | null
  output: string
  outputTruncated?: boolean
}

type KunProcessState = {
  processes: KunBackgroundProcess[]
  loaded: boolean
}

export const useKunProcessStore = create<KunProcessState>(() => ({ processes: [], loaded: false }))

const POLL_ACTIVE_MS = 2_000
const POLL_IDLE_MS = 8_000
let subscribers = 0
let timer: ReturnType<typeof setTimeout> | null = null
let fast = 0

async function poll(): Promise<void> {
  timer = null
  try {
    const result = await rendererRuntimeClient.runtimeRequest(KUN_BACKGROUND_SHELLS_PATH, undefined, undefined, { priority: 'background' })
    if (result.ok) {
      const parsed = JSON.parse(result.body) as { sessions?: KunBackgroundProcess[] }
      useKunProcessStore.setState({ processes: Array.isArray(parsed.sessions) ? parsed.sessions : [], loaded: true })
    }
  } catch { /* Runtime not ready: try again on the next tick. */ }
  if (subscribers > 0) {
    const running = useKunProcessStore.getState().processes.some((process) => process.status === 'running')
    timer = setTimeout(() => void poll(), running || fast > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS)
  }
}

/** Keep the poller alive while the caller is mounted; `active` polls faster. */
export function subscribeKunProcesses(active: boolean): () => void {
  subscribers += 1
  if (active) fast += 1
  if (!timer) void poll()
  return () => {
    subscribers -= 1
    if (active) fast -= 1
    if (subscribers <= 0 && timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}

/** Processes started inside this workspace (by cwd), newest first. */
export function processesInWorkspace(processes: readonly KunBackgroundProcess[], workspaceRoot: string): KunBackgroundProcess[] {
  const root = workspaceRootIdentityKey(workspaceRoot)
  if (!root) return []
  return processes.filter((process) => {
    const cwd = workspaceRootIdentityKey(process.cwd)
    return cwd === root || cwd.startsWith(`${root}/`)
  })
}

export async function stopKunProcess(id: string): Promise<void> {
  await rendererRuntimeClient.runtimeRequest(kunBackgroundShellStopPath(id), 'POST')
  void poll()
}

export async function sendKunProcessInput(id: string, input: string): Promise<boolean> {
  const result = await rendererRuntimeClient.runtimeRequest(kunBackgroundShellStdinPath(id), 'POST', JSON.stringify({ input }))
  void poll()
  if (!result.ok) return false
  try {
    return (JSON.parse(result.body) as { written?: boolean }).written === true
  } catch {
    return false
  }
}

/** Find a running process whose command runs this package script. */
export function runningScriptProcess(
  processes: readonly KunBackgroundProcess[],
  script: string
): KunBackgroundProcess | undefined {
  const pattern = new RegExp(`(?:^|\\s)(?:npm|pnpm|yarn|bun)(?:\\s+run)?\\s+${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`)
  return processes.find((process) => process.status === 'running' && pattern.test(process.command))
}
