import { useEffect, useRef } from 'react'
import type {
  ColabNotebookAgentCellResult,
  ColabNotebookAgentRequest,
  ColabNotebookAgentResult,
  ColabNotebookOutput
} from '@shared/colab/colab-notebook-types'
import { normalizeColabWorkspaceKey } from '../colab-store'
import { useColabNotebookStore } from './colab-notebook-store'
import type { NotebookCell } from './ipynb-format'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

const MAX_CELL_OUTPUT_CHARS = 4000

function summarizeOutputs(outputs: ColabNotebookOutput[]): string {
  const text = outputs
    .map((o) => (o.type === 'stream' ? o.text : o.type === 'error' ? o.traceback || `${o.ename}: ${o.evalue}` : '[image/png]'))
    .join('')
    .trim()
  return text.length > MAX_CELL_OUTPUT_CHARS ? `…${text.slice(-MAX_CELL_OUTPUT_CHARS)}` : text
}

function cellResult(cell: NotebookCell, number: number, ran: boolean): ColabNotebookAgentCellResult {
  const failed = cell.outputs.some((o) => o.type === 'error')
  return {
    number,
    kind: cell.kind,
    status: cell.kind === 'markdown' ? 'skipped' : !ran ? 'not_run' : failed ? 'error' : 'ok',
    executionCount: cell.executionCount,
    output: ran ? summarizeOutputs(cell.outputs) : ''
  }
}

/** Normalizes a Kun-provided path to the workspace-relative form the notebook list uses. */
function relativeNotebookPath(path: string, wsKey: string): string {
  const unified = path.replaceAll('\\', '/').trim()
  const root = wsKey.replaceAll('\\', '/').replace(/\/+$/, '')
  if (root && unified.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return unified.slice(root.length + 1)
  return unified.replace(/^\.\//, '')
}

export async function handleColabNotebookAgentRequest(
  request: ColabNotebookAgentRequest,
  runtime: ColabNotebookRuntime
): Promise<ColabNotebookAgentResult> {
  const store = useColabNotebookStore.getState
  if (request.workspaceRoot && normalizeColabWorkspaceKey(request.workspaceRoot) !== runtime.wsKey) {
    return { ok: false, message: 'The Colab page is open for a different project. Ask the user to switch projects.' }
  }
  if (request.kind === 'interrupt') {
    await store().interrupt()
    return { ok: true }
  }
  const sessionId = runtime.activeSessionId
  if (!sessionId) {
    return {
      ok: false,
      message: 'No notebook runtime is connected. Ask the user to connect Colab or a Jupyter server in the Runtime tab.'
    }
  }
  const runtimeLabel = runtime.activeRuntimeLabel ?? undefined
  if (request.kind === 'variables') {
    await store().loadVariables(sessionId)
    return { ok: true, runtime: runtimeLabel, variables: store().variables }
  }

  if (request.path) {
    const target = relativeNotebookPath(request.path, runtime.wsKey)
    if (target !== store().activePath) {
      await store().refreshNotebooks(runtime.wsKey)
      if (!store().notebooks.includes(target)) return { ok: false, message: `Notebook not found in workspace: ${target}` }
      await store().openNotebook(target)
    }
  }
  const activePath = store().activePath
  if (!activePath || store().loadError) {
    return { ok: false, message: store().loadError ?? 'No notebook is open in the Colab page.' }
  }
  // Pick up the .ipynb edits Kun just wrote before resolving cell numbers.
  await store().reloadActiveNotebook()
  const cells = store().cells
  const numbers = request.cells?.length ? request.cells : cells.map((_, i) => i + 1)
  const invalid = numbers.filter((n) => n < 1 || n > cells.length)
  if (invalid.length > 0) {
    return { ok: false, message: `Cell number(s) ${invalid.join(', ')} out of range; notebook has ${cells.length} cell(s).` }
  }
  const targets = numbers.map((n) => cells[n - 1]!)
  const before = new Map(targets.map((c) => [c.id, c.executionCount]))
  await store().runCellsAndWait(
    sessionId,
    targets.filter((c) => c.kind === 'code').map((c) => c.id)
  )
  await store().saveNotebook()
  const after = store().cells
  const results = numbers.map((n, i) => {
    const original = targets[i]!
    const current = after.find((c) => c.id === original.id) ?? original
    const ran = current.executionCount != null && current.executionCount !== before.get(original.id)
    return cellResult(current, n, ran)
  })
  return { ok: true, notebookPath: activePath, runtime: runtimeLabel, cells: results }
}

/** Serves Kun notebook tool calls while the Colab notebook page is mounted. */
export function useColabNotebookAgent(runtime: ColabNotebookRuntime): void {
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime

  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.kunGui
    if (typeof api?.onColabNotebookAgentRequest !== 'function') return undefined
    return api.onColabNotebookAgentRequest((request) => {
      void api.colabNotebookAgentRespond({ requestId: request.requestId, ack: true })
      void handleColabNotebookAgentRequest(request, runtimeRef.current)
        .catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }))
        .then((result) => api.colabNotebookAgentRespond({ requestId: request.requestId, result }))
    })
  }, [])
}
