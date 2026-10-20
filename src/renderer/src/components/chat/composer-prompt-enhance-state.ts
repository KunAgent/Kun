import type {
  ModelProviderModelGroup,
  PromptOptimizationFailureCode,
  PromptOptimizationResult
} from '@shared/kun-gui-api'
import type { KunPromptOptimizationSettingsV1 } from '@shared/app-settings'
import { isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'
import { providerIdForComposerModel } from '../../store/chat-store-helpers'

/**
 * Which model the enhance button would call, or why it cannot. An empty
 * `providerId` means Kun's own default model; `label` is empty when the
 * model is only known once Main resolves it.
 */
export type PromptEnhanceTarget =
  | { kind: 'ready'; providerId: string; model: string; label: string }
  | { kind: 'unsupported'; agentLabel?: string }

export type PromptEnhanceNotice =
  | { kind: 'empty' }
  | { kind: 'unsupported'; agentLabel?: string }
  | { kind: 'error'; code: Exclude<PromptOptimizationFailureCode, 'empty' | 'unsupported_model' | 'cancelled'>; message: string }

export type PromptEnhanceState = {
  running: { requestId: string; source: string; label: string } | null
  notice: PromptEnhanceNotice | null
  /** The draft before the latest successful rewrite; offered while the draft still equals `enhanced`. */
  undo: { original: string; enhanced: string; label: string } | null
}

export type PromptEnhanceAction =
  | { type: 'started'; requestId: string; source: string; label: string }
  | { type: 'blocked'; notice: PromptEnhanceNotice }
  | { type: 'resolved'; requestId: string; result: PromptOptimizationResult }
  | { type: 'cancelled' }
  | { type: 'draft-changed'; input: string }
  | { type: 'undone' }
  | { type: 'dismissed' }
  | { type: 'reset' }

export const INITIAL_PROMPT_ENHANCE_STATE: PromptEnhanceState = { running: null, notice: null, undo: null }

function modelLabel(model: string, fallback: string): string {
  const trimmed = model.trim()
  return trimmed && trimmed.toLowerCase() !== 'auto' ? trimmed : fallback
}

/**
 * Mirrors the main-process choice: a model pinned in Settings wins, otherwise
 * the composer's selected model when it belongs to a Kun provider. Main
 * re-checks this; the renderer only needs it to explain the button.
 */
export function resolvePromptEnhanceTarget(input: {
  settings: Pick<KunPromptOptimizationSettingsV1, 'providerId' | 'model'>
  providerId: string
  model: string
  kunGroups: readonly ModelProviderModelGroup[]
  /** The composer runs Kun itself, so an unresolved model falls back to Kun's default. */
  kunHarness: boolean
  /** Set when the composer runs another agent through that agent's own sign-in. */
  agentLabel?: string
}): PromptEnhanceTarget {
  const pinnedProviderId = input.settings.providerId.trim()
  const pinnedModel = input.settings.model.trim()
  if (pinnedProviderId || pinnedModel) {
    const group = input.kunGroups.find((item) => item.providerId === pinnedProviderId)
    return { kind: 'ready', providerId: pinnedProviderId, model: pinnedModel, label: modelLabel(pinnedModel, group?.label ?? '') }
  }
  // Surfaces other than Code pass no provider id; when Kun runs the model, the model alone identifies
  // its group. Another agent's model id may collide with a Kun model, so it never takes this path.
  const providerId = input.providerId.trim() ||
    (input.kunHarness ? providerIdForComposerModel(input.kunGroups, input.model) : '')
  const group = providerId ? input.kunGroups.find((item) => item.providerId === providerId) : undefined
  if (group && isKunModelProviderGroup(group)) {
    return { kind: 'ready', providerId, model: input.model.trim(), label: modelLabel(input.model, group.label) }
  }
  if (input.kunHarness && !input.agentLabel) {
    return { kind: 'ready', providerId: '', model: '', label: modelLabel(input.model, '') }
  }
  return input.agentLabel ? { kind: 'unsupported', agentLabel: input.agentLabel } : { kind: 'unsupported' }
}

export type PromptEnhanceClick = 'cancel' | 'empty' | 'unsupported' | 'start'

export function decidePromptEnhanceClick(input: {
  state: PromptEnhanceState
  text: string
  target: PromptEnhanceTarget
}): PromptEnhanceClick {
  if (input.state.running) return 'cancel'
  if (!input.text.trim()) return 'empty'
  if (input.target.kind === 'unsupported') return 'unsupported'
  return 'start'
}

function noticeForFailure(result: Extract<PromptOptimizationResult, { ok: false }>): PromptEnhanceNotice | null {
  if (result.code === 'cancelled') return null
  if (result.code === 'empty') return { kind: 'empty' }
  if (result.code === 'unsupported_model') return { kind: 'unsupported' }
  return { kind: 'error', code: result.code, message: result.message }
}

export function promptEnhanceReducer(state: PromptEnhanceState, action: PromptEnhanceAction): PromptEnhanceState {
  switch (action.type) {
    case 'started':
      return { ...state, running: { requestId: action.requestId, source: action.source, label: action.label }, notice: null }
    case 'blocked':
      return state.running ? state : { ...state, notice: action.notice }
    case 'resolved': {
      // A cancelled or superseded request may still answer; only the current one counts.
      const running = state.running
      if (!running || running.requestId !== action.requestId) return state
      if (action.result.ok) {
        return {
          running: null,
          notice: null,
          undo: { original: running.source, enhanced: action.result.text, label: action.result.model || running.label }
        }
      }
      return { ...state, running: null, notice: noticeForFailure(action.result) }
    }
    case 'cancelled':
      return state.running ? { ...state, running: null } : state
    case 'draft-changed': {
      const undo = state.undo && action.input !== state.undo.enhanced ? null : state.undo
      const notice = state.notice?.kind === 'empty' && action.input.trim() ? null : state.notice
      return undo === state.undo && notice === state.notice ? state : { ...state, undo, notice }
    }
    case 'undone':
      return { ...state, undo: null, notice: null }
    case 'dismissed':
      return state.notice ? { ...state, notice: null } : { ...state, undo: null }
    case 'reset':
      return INITIAL_PROMPT_ENHANCE_STATE
  }
}

/** Cmd/Ctrl+Z restores the pre-rewrite draft only while the rewrite is untouched. */
export function isPromptEnhanceUndoShortcut(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  state: PromptEnhanceState,
  input: string
): boolean {
  if (!state.undo || state.running || input !== state.undo.enhanced) return false
  if (event.shiftKey || event.altKey || !(event.metaKey || event.ctrlKey)) return false
  return event.key === 'z' || event.key === 'Z'
}
