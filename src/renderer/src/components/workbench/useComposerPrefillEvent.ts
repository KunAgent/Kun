import { useChatStore } from '../../store/chat-store'
import { FIRST_TASK_PROMPT_EVENT, takeFirstTaskPrompt } from '../../product-analytics/first-task-prompt'
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { COMPOSER_PREFILL_EVENT, type ComposerPrefillDetail } from '../../artifacts/composer-prefill'

/** Lets pages outside the conversation (the Artifacts "New" tiles) put a starter prompt in the composer. */
export function useComposerPrefillEvent(setInput: Dispatch<SetStateAction<string>>): void {
  useEffect(() => {
    const onPrefill = (event: Event): void => {
      const text = (event as CustomEvent<ComposerPrefillDetail>).detail?.text
      if (typeof text === 'string' && text.trim()) setInput(text)
    }
    const firstTask = () => {
      const text = takeFirstTaskPrompt(useChatStore.getState().activeThreadId)
      if (text) setInput(previous => previous.trim() ? previous : text)
    }
    window.addEventListener(FIRST_TASK_PROMPT_EVENT, firstTask)
    firstTask()
    window.addEventListener(COMPOSER_PREFILL_EVENT, onPrefill)
    return () => { window.removeEventListener(COMPOSER_PREFILL_EVENT, onPrefill); window.removeEventListener(FIRST_TASK_PROMPT_EVENT, firstTask) }
  }, [setInput])
}
