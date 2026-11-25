import type { ColabNotebookOutput, JupyterSessionView } from '@shared/colab/colab-notebook-types'
import type { ColabSessionView } from '@shared/colab/colab-types'
import i18n from '../../i18n'
import { buildComposerFileContextPrompt, type ComposerFileReference } from '../../lib/composer-file-references'
import { composerReasoningEffortRequestValue } from '../../components/chat/floating-composer-model-picker-logic'
import { serviceTierForComposerSelection } from '../../components/chat/composer-fast-mode'
import { readWorkbenchComposerFileContextEntries } from '../../components/workbench/workbench-composer-file-context'
import { composerReferencesToUserFileReferences } from '../../components/workbench/workbench-composer-prompts'
import { useChatStore } from '../../store/chat-store'
import { workAssistantThreadRoute, workAssistantUsesExternalAgent } from '../../write/work-assistant-agent'
import type { NotebookCell } from './ipynb-format'

function summarizeOutputs(outputs: ColabNotebookOutput[]): string {
  const raw = outputs
    .map((o) => {
      if (o.type === 'stream') return o.text
      if (o.type === 'error') return o.traceback || `${o.ename}: ${o.evalue}`
      return '[image/png]'
    })
    .join('\n')
    .trim()
  return raw.length > 1600 ? `${raw.slice(0, 1600)}…` : raw
}

export function buildColabKunTurnPrompt(input: {
  request: string
  activePath: string | null
  cells: NotebookCell[]
  selectedCellNumber: number | null
  includeNotebook: boolean
  session: ColabSessionView | null
  jupyterSession?: JupyterSessionView | null
  driveMountPath?: string | null
}): string {
  const lines: string[] = [input.request.trim()]
  const contextParts: string[] = []
  if (input.includeNotebook && input.activePath) {
    contextParts.push(
      `Active notebook: \`${input.activePath}\` (${input.cells.length} cell(s)) in the workspace. When modifying cells, edit \`${input.activePath}\` directly as valid .ipynb JSON so the open notebook editor reloads your changes automatically.`
    )
  }
  if (input.jupyterSession) {
    contextParts.push(
      `Connected Jupyter server: \`${input.jupyterSession.serverName}\` (${input.jupyterSession.baseUrl}, kernel \`${input.jupyterSession.kernelName}\`). Code runs on that server, so relative file paths resolve on the server, not in the local workspace.`
    )
  } else if (input.session) {
    const driveNote = input.driveMountPath
      ? `; Google Drive mounted at \`${input.driveMountPath}\` — store large model weights & training checkpoints (\`output_dir\`) under \`${input.driveMountPath}/...\` instead of ephemeral \`/content\``
      : '; `/content` is wiped when the runtime stops — mount Google Drive at `/content/drive` via `from google.colab import drive; drive.mount("/content/drive")` (or the Files tab) and store large model weights & training checkpoints (`output_dir`) under `/content/drive/MyDrive/...`'
    contextParts.push(
      `Connected Colab runtime: ${input.session.accelerator} (working dir /content${driveNote}).`
    )
  } else {
    contextParts.push('Notebook runtime: currently disconnected. Ask the user to connect one in the Runtime tab before running cells.')
  }
  if (input.jupyterSession || input.session) {
    contextParts.push(
      'Use `notebook_run_cells` (1-based cell numbers) to execute cells on this kernel after saving your .ipynb edits, and `notebook_variables` to inspect kernel state. Do not start a new Colab session with `colab_run` for notebook work.'
    )
  }
  if (input.selectedCellNumber != null) {
    const cell = input.cells[input.selectedCellNumber - 1]
    if (cell) {
      const out = summarizeOutputs(cell.outputs)
      const src = cell.source.length > 2400 ? `${cell.source.slice(0, 2400)}…` : cell.source
      contextParts.push(
        `Focused cell [${input.selectedCellNumber}] (${cell.kind}):\n\`\`\`${cell.kind === 'code' ? 'python' : 'markdown'}\n${src}\n\`\`\`${
          out ? `\nLatest output of [${input.selectedCellNumber}]:\n\`\`\`text\n${out}\n\`\`\`` : ''
        }`
      )
    }
  }
  if (contextParts.length > 0) {
    lines.push('', '<colab_notebook_context>', ...contextParts, '</colab_notebook_context>')
  }
  return lines.join('\n')
}

export async function sendColabKunTurn(input: {
  workspaceRoot: string
  threadId: string | null
  request: string
  activePath: string | null
  cells: NotebookCell[]
  selectedCellNumber: number | null
  includeNotebook: boolean
  session: ColabSessionView | null
  jupyterSession?: JupyterSessionView | null
  driveMountPath?: string | null
  fileReferences: ComposerFileReference[]
  mode?: 'plan' | 'agent' | 'auto'
  /** Called with the target thread before the turn starts, so the pane can claim it while it streams. */
  onThreadReady?: (threadId: string) => void
}): Promise<{ sent: boolean; threadId: string | null }> {
  const request = input.request.trim()
  if (!request) return { sent: false, threadId: input.threadId }
  const store = useChatStore.getState()
  let threadId = input.threadId
  if (!threadId) {
    const route = workAssistantThreadRoute(store)
    const credentialMode =
      route.credentialMode === 'native-login' ||
      route.credentialMode === 'provider' ||
      route.credentialMode === 'kun-gateway'
        ? route.credentialMode
        : undefined
    threadId = await store.createThread({
      workspaceRoot: input.workspaceRoot,
      forceNew: true,
      agentSurface: 'code',
      ...(route.harnessId ? { harnessId: route.harnessId } : {}),
      ...(credentialMode ? { credentialMode } : {}),
      ...(route.gatewayBinding ? { gatewayBinding: route.gatewayBinding } : {}),
      ...(route.model ? { model: route.model } : {}),
      ...(route.providerId ? { providerId: route.providerId } : {})
    })
    if (!threadId) return { sent: false, threadId: null }
  } else if (store.activeThreadId !== threadId) {
    await store.selectThread(threadId)
  }
  if (useChatStore.getState().activeThreadId !== threadId) return { sent: false, threadId }
  input.onThreadReady?.(threadId)

  let promptText = buildColabKunTurnPrompt({
    request,
    activePath: input.activePath,
    cells: input.cells,
    selectedCellNumber: input.selectedCellNumber,
    includeNotebook: input.includeNotebook,
    session: input.session,
    jupyterSession: input.jupyterSession,
    driveMountPath: input.driveMountPath
  })
  if (input.fileReferences.length > 0 && input.workspaceRoot) {
    const t = (key: string, options?: Record<string, unknown>): string => String(i18n.t(key, options))
    promptText = buildComposerFileContextPrompt(
      promptText,
      await readWorkbenchComposerFileContextEntries(input.fileReferences, input.workspaceRoot, t)
    )
  }
  const state = useChatStore.getState()
  const reasoningEffort = composerReasoningEffortRequestValue(state.composerReasoningEffort)
  const serviceTier = serviceTierForComposerSelection(
    state.composerFastMode,
    state.composerModelGroups,
    state.composerModel,
    state.composerProviderId
  )
  const externalAgent = workAssistantUsesExternalAgent(state)
  const sent = await state.sendMessage(promptText, input.mode === 'plan' && !externalAgent ? 'plan' : 'agent', {
    expectedThreadId: threadId,
    useComposerAgent: true,
    displayText: request,
    ...(input.fileReferences.length ? { fileReferences: composerReferencesToUserFileReferences(input.fileReferences) } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {})
  })
  return { sent, threadId }
}
