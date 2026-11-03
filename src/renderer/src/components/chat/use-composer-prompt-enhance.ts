import { useCallback, useEffect, useReducer, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { useChatStore } from '../../store/chat-store'
import {
  INITIAL_PROMPT_ENHANCE_STATE,
  decidePromptEnhanceClick,
  isPromptEnhanceUndoShortcut,
  promptEnhanceReducer,
  resolvePromptEnhanceTarget,
  type PromptEnhanceState,
  type PromptEnhanceTarget
} from './composer-prompt-enhance-state'
import { usePromptOptimizationSettings } from './use-voice-dictation'

const EMPTY_NOTICE_MS = 3_000
const EMPTY_GROUPS: ModelProviderModelGroup[] = []

export type ComposerPromptEnhance = {
  visible: boolean
  /** False while the composer itself cannot be edited (e.g. a thread is loading). */
  editable: boolean
  running: boolean
  state: PromptEnhanceState
  target: PromptEnhanceTarget
  onClick: () => void
  onUndo: () => void
  onDismiss: () => void
  /** Returns true when the keydown was consumed (Esc cancels, Cmd/Ctrl+Z undoes the rewrite). */
  handleKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `enhance-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useComposerPromptEnhance(options: {
  available: boolean
  editable: boolean
  input: string
  setInput: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  setCursor: (cursor: number) => void
  activeThreadId: string | null | undefined
  providerId: string
  model: string
  kunHarness: boolean
  /** Display name of a non-Kun agent driving the composer through its own sign-in. */
  agentLabel?: string
}): ComposerPromptEnhance {
  const settings = usePromptOptimizationSettings()
  const kunGroups = useChatStore((state) => state.composerModelGroups) ?? EMPTY_GROUPS
  const [state, dispatch] = useReducer(promptEnhanceReducer, INITIAL_PROMPT_ENHANCE_STATE)
  const stateRef = useRef(state)
  stateRef.current = state
  const inputRef = useRef(options.input)
  inputRef.current = options.input
  const bridgeReady = typeof window !== 'undefined' && typeof window.kunGui?.optimizePrompt === 'function'
  const visible = options.available && settings?.enabled === true && bridgeReady
  const target = resolvePromptEnhanceTarget({
    settings: settings ?? { providerId: '', model: '' },
    providerId: options.providerId,
    model: options.model,
    kunGroups,
    kunHarness: options.kunHarness,
    agentLabel: options.agentLabel
  })

  const { setInput, textareaRef, setCursor } = options
  const replaceDraft = useCallback((text: string): void => {
    setInput(text)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(text.length, text.length)
      setCursor(text.length)
    })
  }, [setCursor, setInput, textareaRef])

  const cancel = useCallback((): void => {
    const running = stateRef.current.running
    if (!running) return
    dispatch({ type: 'cancelled' })
    void window.kunGui?.cancelPromptOptimization?.({ requestId: running.requestId }).catch(() => undefined)
  }, [])

  const onClick = (): void => {
    const decision = decidePromptEnhanceClick({ state, text: options.input, target })
    if (decision === 'cancel') return cancel()
    if (!options.editable) return
    if (decision === 'empty') return dispatch({ type: 'blocked', notice: { kind: 'empty' } })
    if (target.kind === 'unsupported') {
      return dispatch({ type: 'blocked', notice: { kind: 'unsupported', agentLabel: target.agentLabel } })
    }
    const requestId = newRequestId()
    const source = options.input
    dispatch({ type: 'started', requestId, source, label: target.label })
    const selection = target.providerId ? { providerId: target.providerId, model: target.model } : {}
    void window.kunGui.optimizePrompt({ text: source, requestId, ...selection })
      .catch((error: unknown) => ({
        ok: false as const, code: 'failed' as const, message: error instanceof Error ? error.message : String(error)
      }))
      .then((result) => {
        if (stateRef.current.running?.requestId !== requestId) return
        // The draft is read-only while running; another surface (dictation, a slash command) may still replace it.
        if (result.ok && inputRef.current !== source) return dispatch({ type: 'cancelled' })
        if (result.ok) replaceDraft(result.text)
        dispatch({ type: 'resolved', requestId, result })
      })
  }

  const onUndo = (): void => {
    const undo = stateRef.current.undo
    if (!undo) return
    replaceDraft(undo.original)
    dispatch({ type: 'undone' })
  }

  const onDismiss = useCallback((): void => dispatch({ type: 'dismissed' }), [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (state.running && event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return true
    }
    if (isPromptEnhanceUndoShortcut(event, state, options.input)) {
      event.preventDefault()
      onUndo()
      return true
    }
    return false
  }

  useEffect(() => {
    dispatch({ type: 'draft-changed', input: options.input })
  }, [options.input])

  useEffect(() => {
    if (state.notice?.kind !== 'empty') return
    const timer = window.setTimeout(() => dispatch({ type: 'dismissed' }), EMPTY_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [state.notice])

  // Switching threads (or unmounting) abandons the rewrite of the old draft.
  useEffect(() => () => {
    cancel()
    dispatch({ type: 'reset' })
  }, [options.activeThreadId, cancel])

  return { visible, editable: options.editable, running: state.running !== null, state, target, onClick, onUndo, onDismiss, handleKeyDown }
}
